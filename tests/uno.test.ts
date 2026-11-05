import { describe, expect, it } from "vitest";
import { UnoGame } from "../server/games/uno";
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
const participants = players.filter((player) => player.id !== HOST_ID);

describe("一起 UNO", () => {
  it("每人 7 张，并给出弃牌堆顶与回合玩家", () => {
    const game = new UnoGame(participants, 0);
    const view = game.viewFor(participants[0]!.id);
    expect(view.hand).toHaveLength(7);
    expect(view.discardTop).toBeDefined();
    expect(view.turnPlayerId.length).toBeGreaterThan(0);
  });

  it("非当前玩家不能行动", () => {
    const game = new UnoGame(participants, 0);
    const turnId = game.viewFor(participants[0]!.id).turnPlayerId;
    const other = participants.find((player) => player.id !== turnId)!;
    expect(game.action(other.id, { type: "draw" }, 0)).toBe(false);
  });

  it("出牌后手牌减少", () => {
    const game = new UnoGame(participants, 0);
    const view = game.viewFor(participants[0]!.id);
    const turnId = view.turnPlayerId;
    const cardId = game.viewFor(turnId).playableIds[0];
    expect(cardId).toBeDefined();
    expect(game.action(turnId, { type: "play", cardId: cardId!, color: "red" }, 0)).toBe(true);
    expect(game.viewFor(turnId).hand).toHaveLength(6);
  });

  it("摸牌后要么可出、要么轮转", () => {
    const game = new UnoGame(participants, 0);
    const turnId = game.viewFor(participants[0]!.id).turnPlayerId;
    const before = game.viewFor(turnId).hand.length;
    expect(game.action(turnId, { type: "draw" }, 0)).toBe(true);
    const after = game.viewFor(turnId);
    const drew = after.hand.length === before + 1;
    const moved = after.turnPlayerId !== turnId;
    expect(drew && (after.mustDraw || moved)).toBe(true);
  });

  it("能一路打到有人出完并产生胜者", () => {
    const game = new UnoGame(participants, 0);
    let guard = 0;
    while (game.phase !== "ended" && guard < 800) {
      guard += 1;
      const current = game.viewFor(participants[0]!.id).turnPlayerId;
      const view = game.viewFor(current);
      const cardId = view.playableIds[0];
      if (cardId) {
        game.action(current, { type: "play", cardId, color: "red" }, 0);
      } else {
        game.action(current, { type: "draw" }, 0);
        const after = game.viewFor(current);
        if (after.mustDraw && after.playableIds[0]) {
          game.action(current, { type: "play", cardId: after.playableIds[0], color: "red" }, 0);
        }
      }
    }
    expect(game.phase).toBe("ended");
    expect(typeof game.winnerId).toBe("string");
  });
});
