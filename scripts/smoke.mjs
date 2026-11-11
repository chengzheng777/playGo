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

  const qr = await fetch(
    `${BASE}/api/qr?text=${encodeURIComponent("http://192.168.1.2:8787/j/ABCD")}`,
  );
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

  const createdState = await host.next((m) => m.type === "room.state" && m.data.room.code === code);
  check("建房时带上所选游戏", createdState.data.gameId === "yiyu");

  const list1 = await fetch(`${BASE}/api/rooms`).then((r) => r.json());
  const listed = list1.rooms.find((room) => room.code === code);
  check("房间出现在大厅列表", listed?.phase === "lobby" && listed.players === 1);

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
  check(
    "聊天广播到所有人",
    hostChat.data.text === "hello playGo" && guestChat.data.text === "hello playGo",
  );

  guest.close();
  const offline = await host.next(
    (m) => m.type === "room.state" && m.data.room.players.some((p) => !p.connected),
  );
  check(
    "断线标记为掉线",
    offline.data.room.players.some((p) => !p.connected),
  );

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
  check(
    "准备状态同步",
    readyState.data.room.players.some((p) => p.ready),
  );

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
  const settingsDenied = await guest2.next((m) => m.type === "error" && m.data.code === "NOT_HOST");
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

  carol.send("player.update", { avatar: { text: "🦊", color: "#38bdf8" } });
  const avatarState = await host.next(
    (m) =>
      m.type === "room.state" &&
      m.data.room.players.some((p) => p.name === "Carol" && p.avatar.text === "🦊"),
  );
  check(
    "头像更新并广播",
    avatarState.data.room.players.find((p) => p.name === "Carol").avatar.color === "#38bdf8",
  );

  carol.send("player.ready", { ready: true });
  await host.next(
    (m) =>
      m.type === "room.state" && m.data.room.players.some((p) => p.name === "Carol" && p.ready),
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
  const list2 = await fetch(`${BASE}/api/rooms`).then((r) => r.json());
  check(
    "开局后列表标记游戏中",
    list2.rooms.find((room) => room.code === code)?.phase === "playing",
  );
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
  check(
    "手机玩家分成两队",
    hostStart.data.game.teams.every((team) => team.members.length === 1),
  );
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
  check(
    "大屏可以代为计分",
    reveal.data.game.teams.some((team) => team.score === 1),
  );
  check(
    "非描述者玩家计分被忽略",
    reveal.data.game.teams.reduce((sum, team) => sum + team.score, 0) === 1,
  );

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
      m.type === "room.state" && m.data.game?.turn?.result === "correct" && m.data.game.round === 2,
  );
  check(
    "描述者自己也能计分",
    reveal2.data.game.teams.reduce((sum, team) => sum + team.score, 0) === 2,
  );

  host.send("game.back", {});
  const backToLobby = await host.next(
    (m) => m.type === "room.state" && m.data.room.phase === "lobby",
  );
  check("结束游戏回到大厅", backToLobby.data.game === null);

  // ---- UNO ----
  console.log("\nUNO");
  guest2.send("player.ready", { ready: true });
  carol.send("player.ready", { ready: true });
  await host.next(
    (m) => m.type === "room.state" && m.data.room.players.filter((p) => p.ready).length >= 2,
  );

  host.send("game.select", { gameId: "uno" });
  await host.next((m) => m.type === "room.state" && m.data.gameId === "uno");

  host.send("game.start", {});
  const unoHost = await host.next((m) => m.type === "room.state" && m.data.uno?.phase === "turn");
  check("UNO 开局", unoHost.data.uno.players.length === 2);
  check(
    "UNO 每人 7 张",
    unoHost.data.uno.players.every((p) => p.handCount === 7),
  );
  check("大屏没有手牌", unoHost.data.uno.hand.length === 0);

  const bobUno = await guest2.next((m) => m.data.uno?.phase === "turn");
  check("手机能看到自己的手牌", bobUno.data.uno.hand.length === 7);

  const unoTurnId = unoHost.data.uno.turnPlayerId;
  const unoClient = unoTurnId === bobUno.data.you.id ? guest2 : carol;
  unoClient.send("game.action", { action: { type: "draw" } });
  await host.next(
    (m) => m.type === "room.state" && m.data.uno?.players.some((p) => p.handCount === 8),
  );
  check("UNO 摸牌生效", true);

  // ---- 拍颜色 ----
  console.log("\n拍颜色");
  host.send("game.back", {});
  await host.next((m) => m.type === "room.state" && m.data.room.phase === "lobby");

  guest2.send("player.ready", { ready: true });
  carol.send("player.ready", { ready: true });
  await host.next(
    (m) => m.type === "room.state" && m.data.room.players.filter((p) => p.ready).length >= 2,
  );

  host.send("game.select", { gameId: "color" });
  await host.next((m) => m.type === "room.state" && m.data.gameId === "color");
  host.send("game.start", {});

  const colorHost = await host.next(
    (m) => m.type === "room.state" && m.data.color?.phase === "shoot",
  );
  check("拍颜色开局", colorHost.data.color.totalRounds === 3);
  check("大屏拿到目标色", /^#[0-9A-F]{6}$/i.test(colorHost.data.color.target.hex));

  const bobColor = await guest2.next((m) => m.data.color?.phase === "shoot");
  check(
    "手机能看到自己的状态",
    bobColor.data.color.players.some((p) => p.id === bobColor.data.you.id),
  );

  guest2.send("game.action", {
    action: {
      type: "shoot",
      rgb: { r: 200, g: 120, b: 90 },
      photo: `data:image/jpeg;base64,${"A".repeat(64)}`,
    },
  });
  const shot = await host.next(
    (m) => m.type === "room.state" && m.data.color?.players.some((p) => p.submitted),
  );
  check(
    "提交照片后标记已拍",
    shot.data.color.players.some((p) => p.submitted),
  );

  // ---- 你画我猜 ----
  console.log("\n你画我猜");
  host.send("game.back", {});
  await host.next((m) => m.type === "room.state" && m.data.room.phase === "lobby");

  guest2.send("player.ready", { ready: true });
  carol.send("player.ready", { ready: true });
  await host.next(
    (m) => m.type === "room.state" && m.data.room.players.filter((p) => p.ready).length >= 2,
  );

  host.send("game.select", { gameId: "draw" });
  await host.next((m) => m.type === "room.state" && m.data.gameId === "draw");
  host.send("game.settings", {
    draw: {
      roundsPerPlayer: 2,
      roundSeconds: 60,
      customWords: ["自定义甲", "自定义乙"],
    },
  });
  const drawSettingsState = await host.next(
    (m) => m.type === "room.state" && m.data.drawSettings?.roundsPerPlayer === 2,
  );
  check(
    "你画我猜规则可设置",
    drawSettingsState?.data.drawSettings.roundSeconds === 60 &&
      drawSettingsState?.data.drawSettings.customWords.length === 2,
  );
  host.send("game.start", {});

  const drawHost = await host.next((m) => m.type === "room.state" && m.data.draw?.phase === "draw");
  check("你画我猜开局", drawHost.data.draw.totalRounds === 4);
  check("大屏在画图阶段看不到词", drawHost.data.draw.word === undefined);

  const bobDraw = await guest2.next((m) => m.data.draw?.phase === "draw");
  const carolDraw = await carol.next((m) => m.data.draw?.phase === "draw");
  const entries = [
    { client: guest2, view: bobDraw.data },
    { client: carol, view: carolDraw.data },
  ];
  const drawerEntry = entries.find((entry) => entry.view.draw.drawerId === entry.view.you.id);
  const drawOther = entries.find((entry) => entry !== drawerEntry);
  check("画手能看到词", typeof drawerEntry?.view.draw.word === "string");

  guest2.send("chat.send", { text: "对局里也能聊" });
  const drawChat = await host.next(
    (m) => m.type === "chat.message" && m.data.text === "对局里也能聊",
  );
  check("对局中聊天广播", drawChat.data.text === "对局里也能聊");

  drawerEntry?.client.send("game.action", {
    action: {
      type: "stroke",
      strokeId: "s1",
      points: [{ x: 0.5, y: 0.5 }],
      color: "#111827",
      width: 6,
      start: true,
    },
  });
  const delta = await host.next((m) => m.type === "draw.delta");
  check("笔迹实时转发给大屏", delta.data.points.length === 1);

  const drawWord = drawerEntry?.view.draw.word ?? "";
  drawOther?.client.send("game.action", { action: { type: "guess", text: "完全不搭" } });
  const drawWrong = await host.next(
    (m) => m.type === "room.state" && (m.data.draw?.guesses?.length ?? 0) > 0,
  );
  check("猜错也会同步给所有人", drawWrong.data.draw.guesses[0]?.ok === false);

  drawOther?.client.send("game.action", { action: { type: "guess", text: drawWord } });
  const drawReveal = await host.next(
    (m) => m.type === "room.state" && m.data.draw?.phase === "reveal",
  );
  check("猜对后揭晓答案", drawReveal.data.draw.result?.word === drawWord);
  check(
    "首位猜对按 5 分",
    drawReveal.data.draw.result?.guessers?.[0]?.points === 5 ||
      drawReveal.data.draw.scores.some((player) => player.score === 5),
  );
  check(
    "全员猜对画手 0 分",
    drawReveal.data.draw.result?.allCorrect === true &&
      drawReveal.data.draw.result?.drawerPoints === 0 &&
      drawReveal.data.draw.scores
        .filter((player) => player.isDrawer)
        .every((player) => player.score === 0),
  );

  host.send("player.kick", { playerId: bobDraw.data.you.id });
  const drawKickDenied = await host.next((m) => m.type === "error");
  check("游戏进行中不能踢人", drawKickDenied.data.code === "BAD_PHASE");

  // ---- 房主踢人 ----
  console.log("\n房间管理");
  const kickHost = new Client("踢人房主");
  await kickHost.connect();
  kickHost.send("room.create", { name: "KickHost", role: "screen" });
  const kickCreated = await kickHost.next((m) => m.type === "room.created");
  const kickCode = kickCreated.data.room.code;

  const kickA = new Client("未准备玩家");
  await kickA.connect();
  kickA.send("room.join", { code: kickCode, name: "KickA", role: "player" });
  const kickAState = await kickA.next(
    (m) => m.type === "room.state" && m.data.you.name === "KickA",
  );

  const kickB = new Client("准备玩家");
  await kickB.connect();
  kickB.send("room.join", { code: kickCode, name: "KickB", role: "player" });
  await kickB.next((m) => m.type === "room.state" && m.data.you.name === "KickB");
  kickB.send("player.ready", { ready: true });
  await kickHost.next(
    (m) =>
      m.type === "room.state" && m.data.room.players.some((p) => p.name === "KickB" && p.ready),
  );

  kickB.send("player.kick", { playerId: kickAState.data.you.id });
  const notHostKick = await kickB.next((m) => m.type === "error");
  check("非房主不能踢人", notHostKick.data.code === "NOT_HOST");

  kickHost.send("player.kick", { playerId: kickAState.data.you.id });
  const kicked = await kickA.next((m) => m.type === "error");
  check("被踢玩家收到 KICKED", kicked.data.code === "KICKED");
  const afterKick = await kickHost.next(
    (m) =>
      m.type === "room.state" &&
      m.data.room.players.length === 2 &&
      m.data.room.players.some((p) => p.name === "KickB"),
  );
  check(
    "踢人后玩家列表更新",
    afterKick.data.room.players.every((p) => p.name !== "KickA"),
  );

  const kickRejoin = new Client("被踢重连");
  await kickRejoin.connect();
  kickRejoin.send("room.join", {
    code: kickCode,
    name: "KickA",
    role: "player",
    token: kickAState.data.token,
  });
  const rejoinDenied = await kickRejoin.next((m) => m.type === "error");
  check("被踢后旧 token 失效", rejoinDenied.data.code === "BAD_TOKEN");

  kickHost.close();
  kickB.close();
  kickA.close();
  kickRejoin.close();

  host.close();
  guest2.close();
  carol.close();
  stranger.close();

  await new Promise((resolve) => setTimeout(resolve, 800));
  const list3 = await fetch(`${BASE}/api/rooms`).then((r) => r.json());
  check("全员离线后房间从列表消失", !list3.rooms.some((room) => room.code === code));

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
