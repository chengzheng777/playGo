import { randomBytes } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN,
  type Player,
  type Role,
  type Room,
  type RoomSummary,
  type YiyuSettings,
} from "../shared/protocol";
import type { YiyuGame } from "./games/yiyu";
import { defaultAvatar } from "../shared/avatars";

export interface RoomRecord {
  room: Room;
  version: number;
  /** playerId -> 重连 token */
  tokens: Map<string, string>;
  lastActiveAt: number;
  /** 房主选中的游戏 */
  gameId: string | null;
  /** 房主配置的规则 */
  settings: YiyuSettings;
  /** 进行中的游戏实例 */
  game: YiyuGame | null;
}

export type JoinError = "ROOM_NOT_FOUND" | "ROOM_FULL" | "NAME_TAKEN" | "BAD_TOKEN" | "BAD_PHASE";

export type JoinResult =
  | { ok: true; record: RoomRecord; player: Player; token: string; reconnected: boolean }
  | { ok: false; error: JoinError };

function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

function newToken(): string {
  return randomBytes(16).toString("hex");
}

function firstFreeSeat(players: Player[]): number {
  const used = new Set(players.map((p) => p.seat));
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!used.has(i)) return i;
  }
  return players.length;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();

  get(code: string): RoomRecord | undefined {
    return this.rooms.get(code);
  }

  all(): IterableIterator<RoomRecord> {
    return this.rooms.values();
  }

  /** 大厅房间列表：只暴露公开信息，按创建时间倒序 */
  list(limit = 30): RoomSummary[] {
    return [...this.rooms.values()]
      .map((record) => ({
        code: record.room.code,
        hostName:
          record.room.players.find((player) => player.id === record.room.hostId)?.name ?? "房主",
        gameId: record.gameId,
        players: record.room.players.length,
        online: record.room.players.filter((player) => player.connected).length,
        capacity: record.room.maxPlayers,
        phase: record.room.phase,
        createdAt: record.room.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  get size(): number {
    return this.rooms.size;
  }

  create(
    name: string,
    role: Role,
    gameId: string | null = null,
  ): { record: RoomRecord; player: Player; token: string } {
    const code = this.uniqueCode();
    const player: Player = {
      id: shortId("p"),
      name: name.trim().slice(0, 16),
      avatar: defaultAvatar(name),
      role,
      seat: 0,
      ready: false,
      connected: true,
      joinedAt: Date.now(),
    };
    const room: Room = {
      code,
      hostId: player.id,
      phase: "lobby",
      players: [player],
      createdAt: Date.now(),
      maxPlayers: MAX_PLAYERS,
    };
    const token = newToken();
    const record: RoomRecord = {
      room,
      version: 1,
      tokens: new Map([[player.id, token]]),
      lastActiveAt: Date.now(),
      gameId,
      settings: { ...DEFAULT_SETTINGS },
      game: null,
    };
    this.rooms.set(code, record);
    return { record, player, token };
  }

  join(code: string, name: string, role: Role): JoinResult {
    const record = this.rooms.get(code);
    if (!record) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (record.room.phase !== "lobby") return { ok: false, error: "BAD_PHASE" };
    if (record.room.players.length >= record.room.maxPlayers) return { ok: false, error: "ROOM_FULL" };

    const trimmed = name.trim().slice(0, 16);
    if (!trimmed) return { ok: false, error: "NAME_TAKEN" };
    if (record.room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: "NAME_TAKEN" };
    }

    const player: Player = {
      id: shortId("p"),
      name: trimmed,
      avatar: defaultAvatar(trimmed),
      role,
      seat: firstFreeSeat(record.room.players),
      ready: false,
      connected: true,
      joinedAt: Date.now(),
    };
    const token = newToken();
    record.tokens.set(player.id, token);
    record.room.players.push(player);
    record.version += 1;
    record.lastActiveAt = Date.now();

    return { ok: true, record, player, token, reconnected: false };
  }

  reconnect(code: string, token: string): JoinResult {
    const record = this.rooms.get(code);
    if (!record) return { ok: false, error: "ROOM_NOT_FOUND" };

    for (const [playerId, playerToken] of record.tokens) {
      if (playerToken !== token) continue;
      const player = record.room.players.find((p) => p.id === playerId);
      if (!player) break;
      player.connected = true;
      record.version += 1;
      record.lastActiveAt = Date.now();
      return { ok: true, record, player, token, reconnected: true };
    }
    return { ok: false, error: "BAD_TOKEN" };
  }

  removePlayer(code: string, playerId: string): void {
    const record = this.rooms.get(code);
    if (!record) return;

    const index = record.room.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;

    record.room.players.splice(index, 1);
    record.tokens.delete(playerId);

    if (record.room.players.length === 0) {
      this.rooms.delete(code);
      return;
    }

    if (record.room.hostId === playerId) {
      const next = record.room.players.find((p) => p.connected) ?? record.room.players[0];
      record.room.hostId = next.id;
    }

    record.version += 1;
    record.lastActiveAt = Date.now();
  }

  setReady(code: string, playerId: string, ready: boolean): Player | undefined {
    const record = this.rooms.get(code);
    const player = record?.room.players.find((p) => p.id === playerId);
    if (!record || !player) return undefined;
    if (player.ready === ready) return player;
    player.ready = ready;
    record.version += 1;
    record.lastActiveAt = Date.now();
    return player;
  }

  setSettings(code: string, settings: YiyuSettings): boolean {
    const record = this.rooms.get(code);
    if (!record) return false;
    record.settings = { ...settings };
    record.version += 1;
    record.lastActiveAt = Date.now();
    return true;
  }

  setAvatar(code: string, playerId: string, avatar: { text: string; color: string }): Player | undefined {
    const record = this.rooms.get(code);
    const player = record?.room.players.find((p) => p.id === playerId);
    if (!record || !player) return undefined;
    player.avatar = avatar;
    record.version += 1;
    record.lastActiveAt = Date.now();
    return player;
  }

  touch(code: string): void {
    const record = this.rooms.get(code);
    if (record) record.lastActiveAt = Date.now();
  }

  /** 清理长时间无人的房间（保留时间要长于掉线重连宽限期） */
  sweepEmpty(maxIdleMs = 120_000): void {
    const now = Date.now();
    for (const [code, record] of this.rooms) {
      const hasConnected = record.room.players.some((p) => p.connected);
      if (!hasConnected && now - record.lastActiveAt > maxIdleMs) {
        this.rooms.delete(code);
      }
    }
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      const bytes = randomBytes(ROOM_CODE_LEN);
      let code = "";
      for (let i = 0; i < ROOM_CODE_LEN; i++) {
        code += ROOM_CODE_ALPHABET[bytes[i]! % ROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("无法生成唯一房间码");
  }
}
