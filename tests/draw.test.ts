import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawGame } from "../server/games/draw";
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

function start(playerCount = 3, customWords?: string[]) {
  const players = makePlayers(playerCount).filter((player) => player.id !== HOST_ID);
  return new DrawGame(
    players,
    { hostId: HOST_ID, roundSeconds: 60, roundsPerPlayer: 1, customWords },
    0,
  );
}

function guessersOf(game: DrawGame): { id: string; name: string }[] {
  return game
    .viewFor(HOST_ID)
    .scores.filter((item) => !item.isDrawer)
    .map((item) => ({ id: item.id, name: item.name }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("你画我猜", () => {
  it("只有画手能看到词，大屏与其他人看不到", () => {
    const game = start();
    const view = game.viewFor(HOST_ID);
    expect(view.phase).toBe("draw");
    expect(view.word).toBeUndefined();

    const drawer = view.drawerId;
    expect(typeof game.viewFor(drawer).word).toBe("string");
    for (const player of guessersOf(game)) {
      expect(game.viewFor(player.id).word).toBeUndefined();
    }
  });

  it("只有画手能提交笔迹，且增量会累积", () => {
    const game = start();
    const drawer = game.viewFor(HOST_ID).drawerId;
    const other = guessersOf(game)[0]!;

    expect(
      game.stroke(other.id, {
        type: "stroke",
        strokeId: "s1",
        points: [{ x: 0.5, y: 0.5 }],
        color: "#111827",
        width: 6,
        start: true,
      }),
    ).toBeNull();

    const delta = game.stroke(drawer, {
      type: "stroke",
      strokeId: "s1",
      points: [{ x: 0.5, y: 0.5 }],
      color: "#111827",
      width: 6,
      start: true,
    });
    expect(delta).not.toBeNull();
    expect(game.viewFor(HOST_ID).strokes).toHaveLength(1);

    game.stroke(drawer, {
      type: "stroke",
      strokeId: "s1",
      points: [{ x: 0.6, y: 0.6 }],
      color: "#111827",
      width: 6,
      start: false,
    });
    expect(game.viewFor(HOST_ID).strokes[0]?.points).toHaveLength(2);
    expect(game.viewFor(other.id).strokes).toHaveLength(1);
  });

  it("清空只对画手生效", () => {
    const game = start();
    const drawer = game.viewFor(HOST_ID).drawerId;
    const other = guessersOf(game)[0]!;
    game.stroke(drawer, {
      type: "stroke",
      strokeId: "s1",
      points: [{ x: 0.2, y: 0.2 }],
      color: "#111827",
      width: 6,
      start: true,
    });

    expect(game.clear(other.id)).toBe(false);
    expect(game.clear(drawer)).toBe(true);
    expect(game.viewFor(HOST_ID).strokes).toHaveLength(0);
  });

  it("首位猜对后本轮继续，按 5 / 3 / 1 分计分，全员猜对时画手 0 分", () => {
    const game = start(5);
    const drawer = game.viewFor(HOST_ID).drawerId;
    const guessers = guessersOf(game).slice(0, 3);
    const word = game.viewFor(drawer).word!;

    expect(game.guess(guessers[0]!.id, word, 1000)).toBe(true);
    const afterFirst = game.viewFor(HOST_ID);
    expect(afterFirst.phase).toBe("draw");
    expect(afterFirst.correctGuessers.map((item) => item.playerId)).toEqual([guessers[0]!.id]);
    expect(afterFirst.guesses[0]).toMatchObject({ ok: true, points: 5 });
    expect(afterFirst.scores.find((item) => item.id === guessers[0]!.id)?.score).toBe(5);
    // 还有 1 人没猜对，画手暂时 +1
    expect(afterFirst.scores.find((item) => item.id === drawer)?.score).toBe(1);

    // 同一人重复答对不重复得分
    expect(game.guess(guessers[0]!.id, word, 1500)).toBe(false);

    expect(game.guess(guessers[1]!.id, word, 2000)).toBe(true);
    expect(game.viewFor(HOST_ID).phase).toBe("draw");
    expect(game.guess(guessers[2]!.id, word, 3000)).toBe(true);

    const revealed = game.viewFor(HOST_ID);
    expect(revealed.phase).toBe("reveal");
    expect(revealed.word).toBe(word);
    expect(revealed.result?.allCorrect).toBe(true);
    expect(revealed.result?.drawerPoints).toBe(0);
    expect(revealed.result?.guessers.map((item) => item.points)).toEqual([5, 3, 1]);
    expect(revealed.scores.find((item) => item.id === guessers[0]!.id)?.score).toBe(5);
    expect(revealed.scores.find((item) => item.id === guessers[1]!.id)?.score).toBe(3);
    expect(revealed.scores.find((item) => item.id === guessers[2]!.id)?.score).toBe(1);
    expect(revealed.scores.find((item) => item.id === drawer)?.score).toBe(0);
    // 猜对者记自己答对的时间，画手记整轮时长
    expect(revealed.scores.find((item) => item.id === guessers[0]!.id)?.timeMs).toBe(1000);
    expect(revealed.scores.find((item) => item.id === drawer)?.timeMs).toBe(60_000);
  });

  it("超时结束：已猜对者保留得分，画手按猜对人数 +1", () => {
    const game = start(5);
    const drawer = game.viewFor(HOST_ID).drawerId;
    const guessers = guessersOf(game).slice(0, 3);
    const word = game.viewFor(drawer).word!;
    const deadline = game.viewFor(HOST_ID).deadline;

    expect(game.guess(guessers[0]!.id, word, 1000)).toBe(true);
    expect(game.guess(guessers[1]!.id, word, 2000)).toBe(true);
    expect(game.tick(deadline)).toBe(true);

    const revealed = game.viewFor(HOST_ID);
    expect(revealed.phase).toBe("reveal");
    expect(revealed.result?.allCorrect).toBe(false);
    expect(revealed.result?.drawerPoints).toBe(2);
    expect(revealed.result?.guessers.map((item) => item.points)).toEqual([5, 3]);
    expect(revealed.scores.find((item) => item.id === drawer)?.score).toBe(2);
    expect(revealed.scores.find((item) => item.id === guessers[0]!.id)?.score).toBe(5);
    expect(revealed.scores.find((item) => item.id === guessers[1]!.id)?.score).toBe(3);
    expect(revealed.scores.find((item) => item.id === guessers[2]!.id)?.score).toBe(0);
    // 没猜对的人记整轮用时
    expect(revealed.scores.find((item) => item.id === guessers[2]!.id)?.timeMs).toBe(60_000);
  });

  it("猜错会进入猜测记录，画手不能猜自己的词", () => {
    const game = start();
    const drawer = game.viewFor(HOST_ID).drawerId;
    const guesser = guessersOf(game)[0]!;
    const word = game.viewFor(drawer).word!;

    expect(game.guess(guesser.id, "完全不对", 500)).toBe(true);
    expect(game.viewFor(HOST_ID).guesses[0]).toMatchObject({ ok: false });
    expect(game.guess(drawer, word, 1000)).toBe(false);
    expect(game.viewFor(HOST_ID).scores.find((item) => item.id === guesser.id)?.score).toBe(0);
  });

  it("开局时离线玩家不进入本局、不占轮次", () => {
    const players = makePlayers(4);
    const offline = players.find((player) => player.id === "p4")!;
    offline.connected = false;
    const game = new DrawGame(
      players.filter((player) => player.id !== HOST_ID),
      { hostId: HOST_ID, roundSeconds: 60, roundsPerPlayer: 1 },
      0,
    );

    const view = game.viewFor(HOST_ID);
    expect(view.scores.map((item) => item.id)).not.toContain(offline.id);
    expect(view.totalRounds).toBe(2);
    expect(guessersOf(game).map((player) => player.id)).not.toContain(offline.id);
  });

  it("自定义词追加进内置词池", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const game = start(3, ["自定义甲", "自定义乙"]);
    const drawer = game.viewFor(HOST_ID).drawerId;
    expect(game.viewFor(drawer).word).toBe("自定义乙");
  });

  it("同分时累计用时少的获胜", () => {
    const game = start(3);

    const first = game.viewFor(HOST_ID);
    const drawer1 = first.drawerId;
    const guesser1 = guessersOf(game).find((player) => player.id !== drawer1)!;
    const word1 = game.viewFor(drawer1).word!;
    expect(game.guess(guesser1.id, word1, 5000)).toBe(true);

    game.tick(first.deadline + 4500);

    const second = game.viewFor(HOST_ID);
    expect(second.round).toBe(2);
    const drawer2 = second.drawerId;
    const guesser2 = guessersOf(game).find((player) => player.id !== drawer2)!;
    const word2 = game.viewFor(drawer2).word!;
    expect(game.guess(guesser2.id, word2, second.deadline - 57_000)).toBe(true);

    game.tick(second.deadline + 4500);
    const ended = game.viewFor(HOST_ID);
    expect(ended.phase).toBe("ended");
    expect(game.winnerId).toBe(guesser2.id);
  });

  it("超时进入揭晓，轮次走完会结束", () => {
    const game = start();
    const total = game.viewFor(HOST_ID).totalRounds;
    expect(total).toBe(2);

    for (let round = 0; round < total; round++) {
      const view = game.viewFor(HOST_ID);
      expect(game.tick(view.deadline)).toBe(true);
      const reveal = game.viewFor(HOST_ID);
      expect(reveal.phase).toBe("reveal");
      game.tick(view.deadline + 4500);
    }
    expect(game.viewFor(HOST_ID).phase).toBe("ended");
  });
});
