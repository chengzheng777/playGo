import { describe, expect, it } from "vitest";
import { RoomManager } from "../server/rooms";
import { MAX_PLAYERS } from "../shared/protocol";

type JoinExtra = { seat?: number; ready?: boolean };

function joinPlayer(
  manager: RoomManager,
  code: string,
  name: string,
  role: "player" | "screen" | "spectator" = "player",
  extra: JoinExtra = {},
) {
  const result = manager.join(code, name, role, undefined, extra);
  if (!result.ok) throw new Error(`join failed: ${result.error}`);
  return result;
}

describe("入座页公开房态", () => {
  it("返回按座位排列的公开信息，不含 id / token / 准备状态", () => {
    const manager = new RoomManager();
    const { record } = manager.create("房主", "screen");
    const preview = manager.preview(record.room.code);

    expect(preview).not.toBeNull();
    if (!preview) return;
    expect(preview.seats).toHaveLength(MAX_PLAYERS);
    expect(preview.hostSeat).toBe(0);
    expect(preview.host.name).toBe("房主");
    expect(preview.seats[0]).toMatchObject({ role: "screen", name: "房主", connected: true });
    expect(preview.seats.filter(Boolean)).toHaveLength(1);

    const json = JSON.stringify(preview);
    expect(json).not.toContain('"id"');
    expect(json).not.toContain("token");
    expect(json).not.toContain("joinedAt");
    expect(json).not.toContain("ready");
  });

  it("房间不存在时返回 null", () => {
    const manager = new RoomManager();
    expect(manager.preview("ZZZZ")).toBeNull();
  });
});

describe("入座座位分配", () => {
  it("空闲的期望座位会被采用，ready 原子生效", () => {
    const manager = new RoomManager();
    const { record } = manager.create("房主", "screen");
    const bob = joinPlayer(manager, record.room.code, "Bob", "player", {
      seat: 3,
      ready: true,
    });

    expect(bob.player.seat).toBe(3);
    expect(bob.player.ready).toBe(true);
    const preview = manager.preview(record.room.code);
    expect(preview?.seats[3]).toMatchObject({ name: "Bob", role: "player", connected: true });
  });

  it("期望座位被占时从该座位顺时针找空位", () => {
    const manager = new RoomManager();
    const { record } = manager.create("房主", "screen");
    joinPlayer(manager, record.room.code, "Bob", "player", { seat: 3 });
    const carol = joinPlayer(manager, record.room.code, "Carol", "player", { seat: 3 });

    expect(carol.player.seat).toBe(4);
  });

  it("观战大屏不占桌面座位，也不参与准备", () => {
    const manager = new RoomManager();
    const { record } = manager.create("房主", "screen");
    joinPlayer(manager, record.room.code, "Bob", "player", { seat: 3 });

    const screen = joinPlayer(manager, record.room.code, "观战", "spectator", { ready: true });
    expect(screen.player.seat).toBe(MAX_PLAYERS);
    expect(screen.player.ready).toBe(false);

    const preview = manager.preview(record.room.code);
    expect(preview?.seats.filter(Boolean)).toHaveLength(2);

    const carol = joinPlayer(manager, record.room.code, "Carol", "player", { seat: 1 });
    expect(carol.player.seat).toBe(1);
  });

  it("重连保持原座位与准备状态", () => {
    const manager = new RoomManager();
    const { record } = manager.create("房主", "screen");
    const bob = joinPlayer(manager, record.room.code, "Bob", "player", {
      seat: 5,
      ready: true,
    });

    const resumed = manager.reconnect(record.room.code, bob.token);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.player.seat).toBe(5);
    expect(resumed.player.ready).toBe(true);
  });

  it("参赛者坐满后拒绝加入", () => {
    const manager = new RoomManager();
    const { record } = manager.create("房主", "screen");
    for (let index = 0; index < MAX_PLAYERS - 1; index++) {
      joinPlayer(manager, record.room.code, `P${index}`);
    }

    const extra = manager.join(record.room.code, "Extra", "player");
    expect(extra.ok).toBe(false);
    if (extra.ok) return;
    expect(extra.error).toBe("ROOM_FULL");

    const preview = manager.preview(record.room.code);
    expect(preview?.seats.filter(Boolean)).toHaveLength(MAX_PLAYERS);
  });

  it("观战大屏被提升为房主时补一个桌面座位", () => {
    const manager = new RoomManager();
    const created = manager.create("房主", "screen");
    const screen = joinPlayer(manager, created.record.room.code, "旁观", "spectator");

    manager.removePlayer(created.record.room.code, created.player.id);

    const promoted = created.record.room.players.find((player) => player.id === screen.player.id);
    expect(promoted?.role).toBe("screen");
    expect(promoted?.seat).toBe(0);
  });
});
