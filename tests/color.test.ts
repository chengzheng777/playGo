import { describe, expect, it } from "vitest";
import { ColorGame } from "../server/games/color";
import { defaultAvatar } from "../shared/avatars";
import type { Player } from "../shared/protocol";

const HOST_ID = "p1";
const PHOTO = `data:image/jpeg;base64,${"A".repeat(64)}`;

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

const participants = makePlayers(4).filter((player) => player.id !== HOST_ID);

function targetRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

describe("拍颜色", () => {
  it("开局给出目标色与 3 轮配置", () => {
    const game = new ColorGame(participants, { hostId: HOST_ID, rounds: 3, shootSeconds: 40 }, 0);
    const view = game.viewFor(HOST_ID);
    expect(view.phase).toBe("shoot");
    expect(view.totalRounds).toBe(3);
    expect(view.target.hex).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("全部提交后提前揭晓，命中目标色得 100 分", () => {
    const game = new ColorGame(participants, { hostId: HOST_ID, rounds: 3, shootSeconds: 40 }, 0);
    const hex = game.viewFor(HOST_ID).target.hex;
    const exact = targetRgb(hex);

    game.action(participants[0]!.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1000);
    game.action(
      participants[1]!.id,
      { type: "shoot", rgb: { r: 0, g: 0, b: 0 }, photo: PHOTO },
      1100,
    );
    game.action(
      participants[2]!.id,
      { type: "shoot", rgb: { r: 255, g: 255, b: 255 }, photo: PHOTO },
      1200,
    );

    const view = game.viewFor(HOST_ID);
    expect(view.phase).toBe("reveal");
    expect(view.results[0]?.playerId).toBe(participants[0]!.id);
    expect(view.results[0]?.points).toBe(100);
  });

  it("得分按 100 − 色差连续计算，保留一位小数", () => {
    const game = new ColorGame(participants, { hostId: HOST_ID, rounds: 3, shootSeconds: 40 }, 0);
    const exact = targetRgb(game.viewFor(HOST_ID).target.hex);
    const near = {
      r: Math.min(255, exact.r + 6),
      g: Math.min(255, exact.g + 4),
      b: Math.max(0, exact.b - 5),
    };

    game.action(participants[0]!.id, { type: "shoot", rgb: near, photo: PHOTO }, 1000);
    game.action(participants[1]!.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1100);
    game.action(participants[2]!.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1200);

    const results = game.viewFor(HOST_ID).results;
    const nearResult = results.find((result) => result.playerId === participants[0]!.id)!;
    expect(nearResult.points).toBeGreaterThan(0);
    expect(nearResult.points).toBeLessThan(100);
    expect(Math.round(nearResult.points * 10)).toBeCloseTo(nearResult.points * 10, 6);
  });

  it("照片只发给大屏，玩家只看得到颜色和分数", () => {
    const game = new ColorGame(participants, { hostId: HOST_ID, rounds: 3, shootSeconds: 40 }, 0);
    const exact = targetRgb(game.viewFor(HOST_ID).target.hex);
    for (const [index, player] of participants.entries()) {
      game.action(player.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1000 + index * 100);
    }

    const hostView = game.viewFor(HOST_ID);
    expect(hostView.results.every((result) => typeof result.photo === "string")).toBe(true);
    const playerView = game.viewFor(participants[0]!.id);
    expect(playerView.results.every((result) => result.photo === undefined)).toBe(true);
  });

  it("未提交不得分，轮次结束后可进入下一轮或结束", () => {
    const game = new ColorGame(participants, { hostId: HOST_ID, rounds: 2, shootSeconds: 10 }, 0);
    const exact = targetRgb(game.viewFor(HOST_ID).target.hex);
    game.action(participants[0]!.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1000);
    game.action(participants[1]!.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1100);
    game.action(participants[2]!.id, { type: "shoot", rgb: exact, photo: PHOTO }, 1200);

    const view = game.viewFor(HOST_ID);
    expect(view.players.find((player) => player.id === participants[2]!.id)?.submitted).toBe(true);

    expect(game.tick(1200 + 9000)).toBe(true);
    expect(game.round).toBe(2);

    const exact2 = targetRgb(game.viewFor(HOST_ID).target.hex);
    for (const [index, player] of participants.entries()) {
      game.action(player.id, { type: "shoot", rgb: exact2, photo: PHOTO }, 20000 + index * 100);
    }
    expect(game.tick(20400 + 9000)).toBe(true);
    expect(game.phase).toBe("ended");
    expect(typeof game.winnerId).toBe("string");
  });
});
