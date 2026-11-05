/**
 * 一愚惊人规则引擎的单元冒烟测试（不需要起服务）。
 *
 *   pnpm engine
 *
 * 规则设定：房主 = 大屏 / 主持人，不参赛；手机玩家分队。
 */
import type { Player, YiyuView } from "../shared/protocol";
import { defaultAvatar } from "../shared/avatars";
import { YiyuGame } from "../server/games/yiyu";

const HOST_ID = "p1";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `玩家${index + 1}`,
    avatar: defaultAvatar(`玩家${index + 1}`),
    role: index === 0 ? "screen" : "player",
    seat: index,
    ready: true,
    connected: true,
    joinedAt: 0,
  }));
}

const players = makePlayers(4);

function options(targetScore: number, roundSeconds: number) {
  return { targetScore, roundSeconds, hostId: HOST_ID };
}

function view(game: YiyuGame, playerId: string): YiyuView {
  return game.viewFor(playerId);
}

function describerOf(game: YiyuGame): string | null {
  return view(game, HOST_ID).turn?.describerId ?? null;
}

// --- 基础权限 ---
console.log("\n基础流程");
const g1 = new YiyuGame(players, options(3, 10), 1000);
check("开局处于 turn", g1.phase === "turn");
check("第一回合", g1.round === 1);

const d1 = describerOf(g1);
check("大屏能看到词", typeof view(g1, HOST_ID).turn?.word === "string");
check(
  "手机玩家都看不到词",
  players.slice(1).every((player) => view(g1, player.id).turn?.word === undefined),
);

const other = players.find((player) => player.id !== d1 && player.id !== HOST_ID)!;
check("非描述者玩家不能计分", g1.action(other.id, { type: "correct" }, 1200) === false);
check("描述者可以计分", d1 !== null && g1.action(d1, { type: "correct" }, 1500) === true);
check("揭晓后所有人可见词", typeof view(g1, other.id).turn?.word === "string");
check("得分 +1", view(g1, HOST_ID).teams.some((team) => team.score === 1));
check("揭晓后进入下一回合", g1.tick(1500 + 1900) === true);
check("回合数递增", g1.round === 2);
check("大屏也能代为计分", g1.action(HOST_ID, { type: "correct" }, 4000) === true);
check("第二回合得分", view(g1, HOST_ID).teams.reduce((sum, team) => sum + team.score, 0) === 2);

// --- 超时 ---
console.log("\n超时");
const g2 = new YiyuGame(players, options(3, 5), 0);
check("时间未到不结算", g2.tick(4999) === false);
check("时间到自动结算", g2.tick(5000) === true);
check("超时进入揭晓", g2.phase === "reveal");
check("超时结果为 timeout", view(g2, HOST_ID).turn?.result === "timeout");
check("超时不加分", view(g2, HOST_ID).teams.every((team) => team.score === 0));

// --- 获胜 ---
console.log("\n获胜");
const g3 = new YiyuGame(players, options(2, 100), 0);
let clock = 0;
for (let round = 0; round < 20 && g3.phase !== "ended"; round++) {
  clock += 100;
  g3.action(HOST_ID, { type: "correct" }, clock);
  clock += 2000;
  g3.tick(clock);
}
check("达到目标分结束", g3.phase === "ended");
const finished = view(g3, HOST_ID);
check("有获胜队伍", finished.winnerTeam === "A" || finished.winnerTeam === "B");
check("获胜队伍分数达标", finished.teams.some((team) => team.score >= 2));

// --- 抢答 ---
console.log("\n抢答");
let rushGame: YiyuGame | null = null;
for (let attempt = 0; attempt < 300 && !rushGame; attempt++) {
  const candidate = new YiyuGame(players, options(9, 30), 0);
  if (view(candidate, HOST_ID).turn?.mode === "rush") rushGame = candidate;
}
check("能随机到抢答模式", rushGame !== null);

if (rushGame) {
  const describer = describerOf(rushGame);
  const guesser = players.find(
    (player) => player.id !== describer && player.id !== HOST_ID,
  )!;
  const word = view(rushGame, HOST_ID).turn?.word ?? "";

  check(
    "大屏不能抢答",
    rushGame.action(HOST_ID, { type: "guess", text: word }, 100) === false,
  );
  check(
    "描述者不能自己抢答",
    rushGame.action(describer!, { type: "guess", text: word }, 100) === false,
  );
  check(
    "普通玩家可以猜",
    rushGame.action(guesser.id, { type: "guess", text: "明显不对" }, 200) === true,
  );
  const afterWrong = view(rushGame, HOST_ID);
  check("猜测列表包含错误项", afterWrong.turn?.guesses.some((item) => !item.ok) === true);
  check("猜错不加分", afterWrong.teams.every((team) => team.score === 0));

  check(
    "猜对结算",
    rushGame.action(guesser.id, { type: "guess", text: word }, 300) === true,
  );
  check("抢答后离开 turn", rushGame.phase !== "turn");
  const afterRight = view(rushGame, HOST_ID);
  check("抢答者所在队伍得分", afterRight.teams.some((team) => team.score === 1));
}

// --- 掉线 ---
console.log("\n掉线处理");
const g4 = new YiyuGame(players, options(9, 60), 0);
const firstDescriber = describerOf(g4)!;
g4.setConnected(firstDescriber, false);
const team = view(g4, HOST_ID).teams.find((item) =>
  item.members.some((member) => member.id === firstDescriber),
)!;
check(
  "掉线状态同步到视图",
  team.members.find((member) => member.id === firstDescriber)?.connected === false,
);
check(
  "大屏不在任何队伍里",
  view(g4, HOST_ID).teams.every((item) =>
    item.members.every((member) => member.id !== HOST_ID),
  ),
);

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
