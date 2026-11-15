import { describe, expect, it } from "vitest";
import type { RoomSeatView } from "../shared/protocol";
import {
  buildChairSpots,
  CHAIR_RADIUS,
  cameraView,
  chairNearPoint,
  chairSeatIndices,
  nearestEmptyChair,
  ROOM,
  resolveMovement,
  STAND_RADIUS,
  TABLE_RADIUS,
} from "../src/scene/layout";

function seat(seatNumber: number, role: RoomSeatView["role"], name: string): RoomSeatView {
  return {
    seat: seatNumber,
    role,
    name,
    avatar: { text: name.slice(0, 1), color: "#3ee08f" },
    connected: true,
  };
}

function seatsWithHostScreen(): (RoomSeatView | null)[] {
  return [seat(0, "screen", "房主"), null, null, null, null, null, null, null];
}

describe("入座场景布局", () => {
  it("房主大屏位不摆椅子，其余座位均匀分布", () => {
    const seats = seatsWithHostScreen();
    seats[3] = seat(3, "player", "小明");
    expect(chairSeatIndices(seats)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const spots = buildChairSpots(seats);
    expect(spots).toHaveLength(7);
    expect(spots.map((spot) => spot.seat)).not.toContain(0);
    expect(spots.find((spot) => spot.seat === 3)?.occupied).toBe(true);
    for (const spot of spots) {
      expect(Math.hypot(spot.x, spot.z)).toBeCloseTo(CHAIR_RADIUS, 5);
      expect(Math.hypot(spot.standX, spot.standZ)).toBeCloseTo(STAND_RADIUS, 5);
      expect(spot.standX).toBeGreaterThan(ROOM.minX);
      expect(spot.standX).toBeLessThan(ROOM.maxX);
      expect(spot.standZ).toBeGreaterThan(ROOM.minZ);
      expect(spot.standZ).toBeLessThan(ROOM.maxZ);
    }
  });

  it("房主参赛时多一把椅子", () => {
    const seats = seatsWithHostScreen();
    seats[0] = seat(0, "player", "房主");
    expect(buildChairSpots(seats)).toHaveLength(8);
  });

  it("优先找最近的空椅，已坐的椅子跳过", () => {
    const seats = seatsWithHostScreen();
    seats[1] = seat(1, "player", "已坐");
    const spots = buildChairSpots(seats);
    const nearest = nearestEmptyChair({ x: spots[0].standX + 0.2, z: spots[0].standZ }, spots);
    expect(nearest?.seat).not.toBe(1);
  });

  it("点椅子附近能选中椅子，点远处不会误选", () => {
    const spots = buildChairSpots(seatsWithHostScreen());
    const target = spots[2];
    expect(chairNearPoint({ x: target.x, z: target.z }, spots)?.seat).toBe(target.seat);
    expect(chairNearPoint({ x: 0, z: 0 }, spots)).toBeNull();
  });

  it("移动会被墙和圆桌挡住，不会穿模", () => {
    const spots = buildChairSpots(seatsWithHostScreen());
    const colliders = [{ x: 0, z: 0, radius: TABLE_RADIUS }];
    const blocked = resolveMovement({ x: 0, z: 3 }, { x: 0, z: -3 }, colliders);
    expect(Math.hypot(blocked.x, blocked.z)).toBeGreaterThanOrEqual(TABLE_RADIUS + 0.2);

    const outside = resolveMovement({ x: 5, z: 4 }, { x: 3, z: 3 }, colliders);
    expect(outside.x).toBeLessThanOrEqual(ROOM.maxX);
    expect(outside.z).toBeLessThanOrEqual(ROOM.maxZ);
    expect(spots.length).toBeGreaterThan(0);
  });

  it("相机取景竖屏更高、宽屏不压扁高度", () => {
    const portrait = cameraView(0.6);
    expect(portrait.height).toBeGreaterThan(portrait.width);
    const wide = cameraView(2);
    expect(wide.height).toBeCloseTo(11.2, 5);
    expect(wide.width).toBeGreaterThan(16);
    expect(wide.width).toBeGreaterThan(wide.height);
  });
});
