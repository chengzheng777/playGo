import { describe, expect, it } from "vitest";
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

const participants = makePlayers(3).filter((player) => player.id !== HOST_ID);

function start() {
  return new DrawGame(participants, { hostId: HOST_ID, roundSeconds: 60, roundsPerPlayer: 1 }, 0);
}

describe("你画我猜", () => {
  it("只有画手能看到词，大屏与其他人看不到", () => {
    const game = start();
    const view = game.viewFor(HOST_ID);
    expect(view.phase).toBe("draw");
    expect(view.word).toBeUndefined();

    const drawer = view.drawerId;
    expect(typeof game.viewFor(drawer).word).toBe("string");
    for (const player of participants.filter((item) => item.id !== drawer)) {
      expect(game.viewFor(player.id).word).toBeUndefined();
    }
  });

  it("只有画手能提交笔迹，且增量会累积", () => {
    const game = start();
    const drawer = game.viewFor(HOST_ID).drawerId;
    const other = participants.find((player) => player.id !== drawer)!;

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
    expect(game.viewFor(participants[0]!.id).strokes).toHaveLength(1);
  });

  it("清空只对画手生效", () => {
    const game = start();
    const drawer = game.viewFor(HOST_ID).drawerId;
    const other = participants.find((player) => player.id !== drawer)!;
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

  it("猜对后加并进入揭晓", () => {
    const game = start();
    const view = game.viewFor(HOST_ID);
    const drawer = view.drawerId;
    const guesser = participants.find((player) => player.id !== drawer)!;
    const word = game.viewFor(drawer).word!;

    expect(game.guess(guesser.id, "完全不对", 1000)).toBe(false);
    expect(game.guess(drawer, word, 1000)).toBe(false);
    expect(game.guess(guesser.id, word, 1000)).toBe(true);

    const revealed = game.viewFor(HOST_ID);
    expect(revealed.phase).toBe("reveal");
    expect(revealed.result?.guesserName).toBe(guesser.name);
    expect(revealed.word).toBe(word);
    expect(revealed.scores.find((item) => item.id === guesser.id)?.score).toBe(10);
    expect(revealed.scores.find((item) => item.id === drawer)?.score).toBe(5);
  });

  it("超时进入揭晓，轮次走完会结束", () => {
    const game = start();
    const total = game.viewFor(HOST_ID).totalRounds;
    expect(total).toBe(participants.length);

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
