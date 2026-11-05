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
  host.send("room.create", { name: "Alice", role: "screen", gameId: "yiyu" });
  const created = await host.next((m) => m.type === "room.created");
  const code = created.data.room.code;
  const hostToken = created.data.token;
  check("创建房间返回 4 位房间码", /^[23456789A-HJ-NP-Z]{4}$/.test(code), code);
  check("房主拿到 token", typeof hostToken === "string" && hostToken.length === 32);

  const createdState = await host.next(
    (m) => m.type === "room.state" && m.data.room.code === code,
  );
  check("建房时带上所选游戏", createdState.data.gameId === "yiyu");

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

  // ---- 游戏大厅 ----
  console.log("\n游戏大厅与一愚惊人");
  host.send("game.select", { gameId: "yiyu" });
  const selected = await host.next((m) => m.type === "room.state" && m.data.gameId === "yiyu");
  check("房主选择游戏后同步", selected.data.gameId === "yiyu");

  guest2.send("game.select", { gameId: "yiyu" });
  const notHost = await guest2.next((m) => m.type === "error" && m.data.code === "NOT_HOST");
  check("非房主不能选游戏", notHost.data.code === "NOT_HOST");

  host.send("game.settings", { settings: { targetScore: 5, roundSeconds: 45 } });
  const settingsState = await host.next(
    (m) => m.type === "room.state" && m.data.settings?.targetScore === 5,
  );
  check("房主修改规则并同步", settingsState.data.settings.roundSeconds === 45);

  guest2.send("game.settings", { settings: { targetScore: 9, roundSeconds: 30 } });
  const settingsDenied = await guest2.next(
    (m) => m.type === "error" && m.data.code === "NOT_HOST",
  );
  check("非房主不能改规则", settingsDenied.data.code === "NOT_HOST");

  // 只有 1 名手机玩家（房主不参赛）时不能开始
  host.send("game.start", {});
  const tooFew = await host.next((m) => m.type === "error" && m.data.code === "BAD_PHASE");
  check("只有 1 名手机玩家时不能开始", tooFew.data.message.includes("2 名"));

  const carol = new Client("玩家C");
  await carol.connect();
  carol.send("room.join", { code, name: "Carol", role: "player" });
  await carol.next((m) => m.type === "room.state" && m.data.you.name === "Carol");
  check("第三名玩家加入", true);

  carol.send("player.avatar", { avatar: { text: "🦊", color: "#38bdf8" } });
  const avatarState = await host.next(
    (m) =>
      m.type === "room.state" &&
      m.data.room.players.some((p) => p.name === "Carol" && p.avatar.text === "🦊"),
  );
  check("头像更新并广播", avatarState.data.room.players.find((p) => p.name === "Carol").avatar.color === "#38bdf8");

  carol.send("player.ready", { ready: true });
  await host.next(
    (m) =>
      m.type === "room.state" &&
      m.data.room.players.some((p) => p.name === "Carol" && p.ready),
  );

  host.send("game.start", {});
  const hostStart = await host.next(
    (m) => m.type === "room.state" && m.data.game?.phase === "turn",
  );
  const bobStart = await guest2.next(
    (m) => m.type === "room.state" && m.data.game?.phase === "turn",
  );
  const carolStart = await carol.next(
    (m) => m.type === "room.state" && m.data.game?.phase === "turn",
  );
  check("游戏开始", hostStart.data.room.phase === "playing");
  check(
    "规则按房主配置生效",
    hostStart.data.game.roundSeconds === 45 && hostStart.data.game.targetScore === 5,
  );
  check(
    "房主是大屏、不参赛",
    hostStart.data.game.teams.every((team) =>
      team.members.every((member) => member.id !== hostStart.data.you.id),
    ),
  );
  check("手机玩家分成两队", hostStart.data.game.teams.every((team) => team.members.length === 1));
  check("大屏能看到词", typeof hostStart.data.game.turn.word === "string");
  check("手机玩家看不到词", !bobStart.data.game.turn.word && !carolStart.data.game.turn.word);

  const playerStates = [
    { client: guest2, state: bobStart },
    { client: carol, state: carolStart },
  ];
  const describerId = hostStart.data.game.turn.describerId;
  const descEntry = playerStates.find((entry) => entry.state.data.you.id === describerId);
  const otherEntry = playerStates.find((entry) => entry !== descEntry);
  check("能找到描述者", descEntry !== undefined);

  otherEntry?.client.send("game.action", { action: { type: "correct" } });
  host.send("game.action", { action: { type: "correct" } });

  const reveal = await host.next(
    (m) => m.type === "room.state" && m.data.game?.turn?.result === "correct",
  );
  check("大屏可以代为计分", reveal.data.game.teams.some((team) => team.score === 1));
  check("非描述者玩家计分被忽略", reveal.data.game.teams.reduce((sum, team) => sum + team.score, 0) === 1);

  const nextRound = await host.next(
    (m) => m.type === "room.state" && m.data.game?.phase === "turn" && m.data.game.round === 2,
    6000,
  );
  check("揭晓后自动进入下一回合", nextRound.data.game.round === 2);

  const round2Describer = nextRound.data.game.turn.describerId;
  const round2Client = playerStates.find(
    (entry) => entry.state.data.you.id === round2Describer,
  )?.client;
  round2Client?.send("game.action", { action: { type: "correct" } });
  const reveal2 = await host.next(
    (m) =>
      m.type === "room.state" &&
      m.data.game?.turn?.result === "correct" &&
      m.data.game.round === 2,
  );
  check("描述者自己也能计分", reveal2.data.game.teams.reduce((sum, team) => sum + team.score, 0) === 2);

  host.send("game.back", {});
  const backToLobby = await host.next(
    (m) => m.type === "room.state" && m.data.room.phase === "lobby",
  );
  check("结束游戏回到大厅", backToLobby.data.game === null);

  host.close();
  guest2.close();
  carol.close();
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
