/**
 * 一愚惊人规则引擎的单元冒烟测试（不需要起服务）。
 *
 *   pnpm engine
 */
import type { Player, YiyuView } from "../shared/protocol";
import { YiyuGame } from "../server/games/yiyu";

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
    role: index === 0 ? "screen" : "player",
    seat: index,
    ready: true,
    connected: true,
    joinedAt: 0,
  }));
}

function view(game: YiyuGame, playerId: string): YiyuView {
  return game.viewFor(playerId);
}

function findDescriber(game: YiyuGame, players: Player[]): string | null {
  for (const player of players) {
    if (view(game, player.id).turn?.word) return player.id;
  }
  return null;
}

const players = makePlayers(4);

// --- 基础流程 ---
console.log("\n基础流程");
const g1 = new YiyuGame(players, { targetScore: 3, roundSeconds: 10 }, 1000);
check("开局处于 turn", g1.phase === "turn");
check("第一回合", g1.round === 1);

const describer1 = findDescriber(g1, players);
check("只有描述者能看到词", describer1 !== null);

const other1 = players.find((player) => player.id !== describer1)!;
check(
  "非描述者不能判定答对",
  g1.action(other1.id, { type: "correct" }, 1500) === false,
);
check(
  "描述者可以判定答对",
  describer1 !== null && g1.action(describer1, { type: "correct" }, 1500) === true,
);
check("答对后进入揭晓", g1.phase === "reveal");

const revealView = view(g1, other1.id);
check("揭晓时所有人可见词", typeof revealView.turn?.word === "string");
check("得分 +1", revealView.teams.some((team) => team.score === 1));
check("揭晓后进入下一回合", g1.tick(1500 + 1900) === true);
check("回合数递增", g1.round === 2);

// --- 超时 ---
console.log("\n超时");
const g2 = new YiyuGame(players, { targetScore: 3, roundSeconds: 5 }, 0);
check("时间未到不结算", g2.tick(4999) === false);
check("时间到自动结算", g2.tick(5000) === true);
check("超时进入揭晓", g2.phase === "reveal");
check("超时结果为 timeout", view(g2, players[0]!.id).turn?.result === "timeout");
check("超时不加分", view(g2, players[0]!.id).teams.every((team) => team.score === 0));

// --- 获胜 ---
console.log("\n获胜");
const g3 = new YiyuGame(players, { targetScore: 2, roundSeconds: 100 }, 0);
let clock = 0;
for (let round = 0; round < 20 && g3.phase !== "ended"; round++) {
  const describer = findDescriber(g3, players);
  if (!describer) break;
  clock += 100;
  g3.action(describer, { type: "correct" }, clock);
  clock += 2000;
  g3.tick(clock);
}
check("达到目标分结束", g3.phase === "ended");
const finished = view(g3, players[0]!.id);
check("有获胜队伍", finished.winnerTeam === "A" || finished.winnerTeam === "B");
check("获胜队伍分数达标", finished.teams.some((team) => team.score >= 2));

// --- 抢答 ---
console.log("\n抢答");
let rushGame: YiyuGame | null = null;
for (let attempt = 0; attempt < 300 && !rushGame; attempt++) {
  const candidate = new YiyuGame(players, { targetScore: 9, roundSeconds: 30 }, 0);
  if (view(candidate, players[0]!.id).turn?.mode === "rush") rushGame = candidate;
}
check("能随机到抢答模式", rushGame !== null);

if (rushGame) {
  const describer = findDescriber(rushGame, players);
  const guesser = players.find((player) => player.id !== describer)!;
  const word = view(rushGame, describer!).turn?.word ?? "";

  check(
    "描述者不能自己抢答",
    rushGame.action(describer!, { type: "guess", text: word }, 100) === false,
  );
  check(
    "猜错也记录",
    rushGame.action(guesser.id, { type: "guess", text: "明显不对" }, 200) === true,
  );
  const afterWrong = view(rushGame, guesser.id);
  check("猜测列表包含错误项", afterWrong.turn?.guesses.some((item) => !item.ok) === true);
  check("猜错不加分", afterWrong.teams.every((team) => team.score === 0));

  check(
    "猜对结算",
    rushGame.action(guesser.id, { type: "guess", text: word }, 300) === true,
  );
  check("抢答后离开 turn", rushGame.phase !== "turn");
  const afterRight = view(rushGame, guesser.id);
  check("抢答者所在队伍得分", afterRight.teams.some((team) => team.score === 1));
}

// --- 断线重选描述者 ---
console.log("\n掉线处理");
const g4 = new YiyuGame(players, { targetScore: 9, roundSeconds: 60 }, 0);
const firstDescriber = findDescriber(g4, players)!;
g4.setConnected(firstDescriber, false);
const teamOfFirst = view(g4, firstDescriber).teams.find((team) =>
  team.members.some((member) => member.id === firstDescriber),
)!;
check("掉线后仍记录成员", teamOfFirst.members.some((member) => member.id === firstDescriber));

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
