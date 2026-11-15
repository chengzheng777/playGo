import type { Player } from "../../shared/protocol";

export interface LobbyMotion {
  x: number;
  z: number;
  facing: number;
}

/**
 * 大厅像素房的位置流。高频移动不写进 AppState，
 * 避免整页大厅跟着重渲染；场景订阅这里的数据。
 */
class LobbyMotionStore {
  private positions = new Map<string, LobbyMotion>();
  private listeners = new Set<() => void>();

  set(playerId: string, motion: LobbyMotion): void {
    const previous = this.positions.get(playerId);
    if (
      previous &&
      previous.x === motion.x &&
      previous.z === motion.z &&
      previous.facing === motion.facing
    ) {
      return;
    }
    this.positions.set(playerId, motion);
    this.notify();
  }

  /** 用房间全量状态里的位置重置；没走过的人没有位置，由场景按座位给默认站位 */
  seed(players: Player[]): void {
    const next = new Map<string, LobbyMotion>();
    for (const player of players) {
      if (typeof player.x !== "number" || typeof player.z !== "number") continue;
      next.set(player.id, { x: player.x, z: player.z, facing: player.facing ?? 0 });
    }
    this.positions = next;
    this.notify();
  }

  get(playerId: string): LobbyMotion | undefined {
    return this.positions.get(playerId);
  }

  values(): ReadonlyMap<string, LobbyMotion> {
    return this.positions;
  }

  clear(): void {
    if (this.positions.size === 0) return;
    this.positions = new Map();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const lobbyMotion = new LobbyMotionStore();
