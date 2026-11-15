import { describe, expect, it } from "vitest";
import type { RoomSeatView } from "../shared/protocol";
import { buildChairSpots, isNearSeat, seatCenter, seatStand } from "../src/scene/layout";

const screen: RoomSeatView = {
  seat: 0,
  role: "screen",
  name: "房主",
  avatar: { text: "房", color: "#ffd166" },
  connected: true,
};
const player: RoomSeatView = {
  seat: 1,
  role: "player",
  name: "小明",
  avatar: { text: "明", color: "#38bdf8" },
  connected: true,
};

describe("大厅像素房坐着判定", () => {
  it("房主大屏位不生成椅子，玩家座位有中心点", () => {
    const seats: (RoomSeatView | null)[] = new Array(8).fill(null);
    seats[0] = screen;
    seats[1] = player;
    const spots = buildChairSpots(seats);
    expect(spots.some((spot) => spot.seat === 0)).toBe(false);
    const spot = spots.find((item) => item.seat === 1);
    expect(spot).toBeDefined();
    if (!spot) return;
    const center = seatCenter(spot);
    expect(center.x).toBeCloseTo(spot.x * 0.94, 5);
    expect(center.z).toBeCloseTo(spot.z * 0.94, 5);
  });

  it("站在椅子旁算坐下，走到房间中间不算", () => {
    const seats: (RoomSeatView | null)[] = new Array(8).fill(null);
    seats[0] = screen;
    const spot = buildChairSpots(seats)[0];
    expect(spot).toBeDefined();
    if (!spot) return;
    const center = seatCenter(spot);
    const stand = seatStand(spot);
    expect(isNearSeat(center.x, center.z, spot)).toBe(true);
    expect(isNearSeat(stand.x, stand.z, spot)).toBe(true);
    expect(isNearSeat(0, 0, spot)).toBe(false);
  });
});
