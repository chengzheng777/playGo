/**
 * M0 冒烟测试：直接对着已启动的服务跑一遍协议。
 *
 *   pnpm dev          # 另开一个终端
 *   node scripts/smoke.mjs
 *
 * 环境变量 BASE 可改地址，默认 http://localhost:8787
 */
import WebSocket from "ws";

const BASE = process.env.BASE ?? "http://localhost:8787";
const WS_URL = `${BASE.replace(/^http/, "ws")}/ws`;

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.messages = [];
    this.waiters = [];
  }

  async connect() {
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const waiter = this.waiters.find((w) => w.predicate(message));
      if (waiter) {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        waiter.resolve(message);
        return;
      }
      this.messages.push(message);
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return this.next((m) => m.type === "welcome");
  }

  next(predicate, timeout = 4000) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) {
      const [message] = this.messages.splice(index, 1);
      return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`${this.label}: 等待消息超时`));
      }, timeout);
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  send(type, data) {
    this.ws.send(JSON.stringify({ v: 1, type, data, ts: Date.now() }));
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log(`\n对着 ${BASE} 跑 M0 冒烟测试\n`);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("健康检查", health.ok === true);

  const networks = await fetch(`${BASE}/api/networks`).then((r) => r.json());
  check("网卡枚举返回端口", typeof networks.port === "number");

  const qr = await fetch(`${BASE}/api/qr?text=${encodeURIComponent("http://192.168.1.2:8787/j/ABCD")}`);
  const qrBody = await qr.text();
  check("二维码接口返回 SVG", qr.ok && qrBody.includes("<svg"));

  const host = new Client("房主");
  await host.connect();
  host.send("room.create", { name: "Alice", role: "screen" });
  const created = await host.next((m) => m.type === "room.created");
  const code = created.data.room.code;
  const hostToken = created.data.token;
  check("创建房间返回 4 位房间码", /^[23456789A-HJ-NP-Z]{4}$/.test(code), code);
  check("房主拿到 token", typeof hostToken === "string" && hostToken.length === 32);

  const guest = new Client("玩家B");
  await guest.connect();
  guest.send("room.join", { code, name: "Bob", role: "player" });
  const guestState = await guest.next((m) => m.type === "room.state");
  check("玩家加入并拿到身份", guestState.data.you.name === "Bob");
  check("玩家角色为 player", guestState.data.you.role === "player");

  const hostSeesTwo = await host.next(
    (m) => m.type === "room.state" && m.data.room.players.length === 2,
  );
  check("房主看到新玩家", hostSeesTwo.data.room.players.length === 2);

  guest.send("chat.send", { text: "hello playGo" });
  const [hostChat, guestChat] = await Promise.all([
    host.next((m) => m.type === "chat.message"),
    guest.next((m) => m.type === "chat.message"),
  ]);
  check("聊天广播到所有人", hostChat.data.text === "hello playGo" && guestChat.data.text === "hello playGo");

  guest.close();
  const offline = await host.next(
    (m) => m.type === "room.state" && m.data.room.players.some((p) => !p.connected),
  );
  check("断线标记为掉线", offline.data.room.players.some((p) => !p.connected));

  const guest2 = new Client("玩家B-重连");
  await guest2.connect();
  guest2.send("room.join", { code, token: guestState.data.token });
  const resumed = await guest2.next((m) => m.type === "room.state");
  check("重连带回原身份", resumed.data.you.name === "Bob" && resumed.data.you.connected);
  check("重连不新增座位", resumed.data.room.players.length === 2);

  guest2.send("player.ready", { ready: true });
  const readyState = await host.next(
    (m) => m.type === "room.state" && m.data.room.players.some((p) => p.ready),
  );
  check("准备状态同步", readyState.data.room.players.some((p) => p.ready));

  const stranger = new Client("陌生人");
  await stranger.connect();
  stranger.send("room.join", { code: "ZZZZ", name: "Nobody", role: "player" });
  const notFound = await stranger.next((m) => m.type === "error");
  check("不存在的房间被拒绝", notFound.data.code === "ROOM_NOT_FOUND");

  stranger.send("room.join", { code, name: "Bob", role: "player" });
  const duplicate = await stranger.next((m) => m.type === "error");
  check("重名被拒绝", duplicate.data.code === "NAME_TAKEN");

  host.close();
  guest2.close();
  stranger.close();

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
