import type { RoomSeatView } from "../../shared/protocol";

export interface Point {
  x: number;
  z: number;
}

export interface ChairSpot {
  seat: number;
  angle: number;
  /** 椅子中心 */
  x: number;
  z: number;
  /** 玩家坐下前站的位置 */
  standX: number;
  standZ: number;
  occupied: boolean;
}

export interface Collider extends Point {
  radius: number;
}

export const TABLE_RADIUS = 2.05;
export const TABLE_TOP_Y = 1.0;
export const CHAIR_RADIUS = 2.9;
export const CHAIR_SEAT_Y = 0.62;
export const STAND_RADIUS = 3.72;
export const PLAYER_RADIUS = 0.24;
export const ENTRY: Point = { x: 0, z: 3.95 };

export const ROOM = {
  minX: -5.4,
  maxX: 5.4,
  minZ: -4.4,
  maxZ: 4.4,
};

/** 桌面上的椅子：空位和已坐玩家；房主大屏位不摆椅子 */
export function chairSeatIndices(seats: (RoomSeatView | null)[]): number[] {
  return seats.flatMap((seat, index) => (seat?.role === "screen" ? [] : [index]));
}

/** 按座位数均匀摆椅子；返回椅子中心与站立点 */
export function buildChairSpots(seats: (RoomSeatView | null)[]): ChairSpot[] {
  const indices = chairSeatIndices(seats);
  const count = Math.max(1, indices.length);
  return indices.map((seat, rank) => {
    const angle = -Math.PI / 2 + (rank / count) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      seat,
      angle,
      x: cos * CHAIR_RADIUS,
      z: sin * CHAIR_RADIUS,
      standX: cos * STAND_RADIUS,
      standZ: sin * STAND_RADIUS,
      occupied: seats[seat]?.role === "player",
    };
  });
}

export function emptyChairs(spots: ChairSpot[]): ChairSpot[] {
  return spots.filter((spot) => !spot.occupied);
}

/** 椅子中心：小人坐下时靠近这个点 */
export function seatCenter(spot: ChairSpot): Point {
  return { x: spot.x * 0.94, z: spot.z * 0.94 };
}

/** 椅子外侧的站立点 */
export function seatStand(spot: ChairSpot): Point {
  return { x: spot.standX, z: spot.standZ };
}

/** 是否在椅子旁（大厅里站到旁边就自动坐下） */
export const SEATED_DISTANCE = 1.1;

export function isNearSeat(x: number, z: number, spot: ChairSpot): boolean {
  const center = seatCenter(spot);
  return Math.hypot(x - center.x, z - center.z) <= SEATED_DISTANCE;
}

export function nearestEmptyChair(
  point: Point,
  spots: ChairSpot[],
  maxDistance = Number.POSITIVE_INFINITY,
): ChairSpot | null {
  let best: ChairSpot | null = null;
  let bestDistance = maxDistance;
  for (const spot of spots) {
    if (spot.occupied) continue;
    const distance = Math.hypot(point.x - spot.standX, point.z - spot.standZ);
    if (distance <= bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

/** 点击位置附近是否有椅子（用于点椅子走过去） */
export function chairNearPoint(
  point: Point,
  spots: ChairSpot[],
  maxDistance = 0.95,
): ChairSpot | null {
  let best: ChairSpot | null = null;
  let bestDistance = maxDistance;
  for (const spot of spots) {
    const distance = Math.hypot(point.x - spot.x, point.z - spot.z);
    if (distance <= bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

export function buildColliders(spots: ChairSpot[]): Collider[] {
  const colliders: Collider[] = [{ x: 0, z: 0, radius: TABLE_RADIUS }];
  for (const spot of spots) {
    colliders.push({ x: spot.x, z: spot.z, radius: 0.3 });
  }
  return colliders;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 2D 平面上的移动与碰撞：先限制在房间内，再从圆桌/椅子里推出来。
 * 推到边界外时再夹一次，保证不会穿墙。
 */
export function resolveMovement(
  from: Point,
  delta: Point,
  colliders: Collider[],
  bounds = ROOM,
): Point {
  let x = from.x + delta.x;
  let z = from.z + delta.z;

  x = clamp(x, bounds.minX + PLAYER_RADIUS, bounds.maxX - PLAYER_RADIUS);
  z = clamp(z, bounds.minZ + PLAYER_RADIUS, bounds.maxZ - PLAYER_RADIUS);

  for (const collider of colliders) {
    const dx = x - collider.x;
    const dz = z - collider.z;
    const minDistance = collider.radius + PLAYER_RADIUS;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= minDistance * minDistance) continue;
    const distance = Math.sqrt(distanceSq);
    if (distance < 1e-5) {
      // 正好在圆心：朝房间外侧推
      x = collider.x;
      z = collider.z + minDistance;
    } else {
      x = collider.x + (dx / distance) * minDistance;
      z = collider.z + (dz / distance) * minDistance;
    }
  }

  return {
    x: clamp(x, bounds.minX + PLAYER_RADIUS, bounds.maxX - PLAYER_RADIUS),
    z: clamp(z, bounds.minZ + PLAYER_RADIUS, bounds.maxZ - PLAYER_RADIUS),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * 2.5D 固定机位的取景。高度固定，保证桌子和房间上下不被裁掉；
 * 超宽屏只增加可见宽度，不反过来压扁高度。
 */
export function cameraView(aspect: number): { width: number; height: number } {
  const safeAspect = clamp(aspect, 0.5, 3);
  const height = 11.2;
  return { width: height * safeAspect, height };
}
