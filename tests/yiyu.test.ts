import { describe, expect, it } from "vitest";
import { YiyuGame } from "../server/games/yiyu";
import { defaultAvatar } from "../shared/avatars";
import type { Player } from "../shared/protocol";

const HOST_ID = "p1";

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

function describerOf(game: YiyuGame): string | null {
  return game.viewFor(HOST_ID).turn?.describerId ?? null;
}

describe("一愚惊人", () => {
  it("开局只有大屏能看到词", () => {
    const game = new YiyuGame(players, options(3, 10), 1000);
    expect(game.phase).toBe("turn");
    expect(game.round).toBe(1);
    expect(typeof game.viewFor(HOST_ID).turn?.word).toBe("string");
    for (const player of players.slice(1)) {
      expect(game.viewFor(player.id).turn?.word).toBeUndefined();
    }
  });

  it("只有描述者和大屏能计分", () => {
    const game = new YiyuGame(players, options(3, 10), 1000);
    const describer = describerOf(game);
    expect(describer).not.toBeNull();

    const other = players.find((player) => player.id !== describer && player.id !== HOST_ID);
    expect(other).toBeDefined();
    expect(game.action(other!.id, { type: "correct" }, 1200)).toBe(false);
    expect(game.action(describer!, { type: "correct" }, 1500)).toBe(true);
    expect(game.phase).toBe("reveal");
    expect(game.viewFor(HOST_ID).teams.some((team) => team.score === 1)).toBe(true);

    expect(game.tick(1500 + 1900)).toBe(true);
    expect(game.round).toBe(2);
    expect(game.action(HOST_ID, { type: "correct" }, 4000)).toBe(true);
    const total = game.viewFor(HOST_ID).teams.reduce((sum, team) => sum + team.score, 0);
    expect(total).toBe(2);
  });

  it("超时后进入揭晓且不加分", () => {
    const game = new YiyuGame(players, options(3, 5), 0);
    expect(game.tick(4999)).toBe(false);
    expect(game.tick(5000)).toBe(true);
    expect(game.phase).toBe("reveal");
    expect(game.viewFor(HOST_ID).turn?.result).toBe("timeout");
    expect(game.viewFor(HOST_ID).teams.every((team) => team.score === 0)).toBe(true);
  });

  it("达到目标分后结束并产生胜者", () => {
    const game = new YiyuGame(players, options(2, 100), 0);
    let clock = 0;
    for (let round = 0; round < 20 && game.phase !== "ended"; round++) {
      clock += 100;
      game.action(HOST_ID, { type: "correct" }, clock);
      clock += 2000;
      game.tick(clock);
    }
    expect(game.phase).toBe("ended");
    const view = game.viewFor(HOST_ID);
    expect(["A", "B"]).toContain(view.winnerTeam);
    expect(view.teams.some((team) => team.score >= 2)).toBe(true);
  });

  it("抢答只有参赛且非描述者的玩家能提交", () => {
    let game: YiyuGame | null = null;
    for (let attempt = 0; attempt < 300 && !game; attempt++) {
      const candidate = new YiyuGame(players, options(9, 30), 0);
      if (candidate.viewFor(HOST_ID).turn?.mode === "rush") game = candidate;
    }
    expect(game).not.toBeNull();
    if (!game) return;

    const describer = describerOf(game);
    const guesser = players.find((player) => player.id !== describer && player.id !== HOST_ID);
    const word = game.viewFor(HOST_ID).turn?.word ?? "";

    expect(game.action(HOST_ID, { type: "guess", text: word }, 100)).toBe(false);
    expect(game.action(describer!, { type: "guess", text: word }, 100)).toBe(false);
    expect(game.action(guesser!.id, { type: "guess", text: "明显不对" }, 200)).toBe(true);
    expect(game.viewFor(HOST_ID).turn?.guesses.some((item) => !item.ok)).toBe(true);
    expect(game.viewFor(HOST_ID).teams.every((team) => team.score === 0)).toBe(true);

    expect(game.action(guesser!.id, { type: "guess", text: word }, 300)).toBe(true);
    expect(game.phase).not.toBe("turn");
    expect(game.viewFor(HOST_ID).teams.some((team) => team.score === 1)).toBe(true);
  });

  it("掉线状态会同步到视图，且大屏不参赛", () => {
    const game = new YiyuGame(players, options(9, 60), 0);
    const describer = describerOf(game)!;
    game.setConnected(describer, false);
    const view = game.viewFor(HOST_ID);
    expect(
      view.teams.some((team) =>
        team.members.some((member) => member.id === describer && !member.connected),
      ),
    ).toBe(true);
    expect(view.teams.every((team) => team.members.every((member) => member.id !== HOST_ID))).toBe(
      true,
    );
  });
});
