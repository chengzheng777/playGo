import { randomBytes } from "node:crypto";
import { defaultAvatar } from "../shared/avatars";
import {
  DEFAULT_DRAW_SETTINGS,
  DEFAULT_SETTINGS,
  type DrawSettings,
  MAX_DRAW_WORD_LEN,
  MAX_DRAW_WORDS,
  MAX_PLAYERS,
  type Player,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN,
  type Role,
  type Room,
  type RoomPreview,
  type RoomSeatView,
  type RoomSummary,
  type YiyuSettings,
} from "../shared/protocol";
import type { ColorGame } from "./games/color";
import type { DrawGame } from "./games/draw";
import type { UnoGame } from "./games/uno";
import type { YiyuGame } from "./games/yiyu";

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
  drawSettings: DrawSettings;
  /** 进行中的游戏实例 */
  game: YiyuGame | null;
  uno: UnoGame | null;
  color: ColorGame | null;
  draw: DrawGame | null;
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

/** 自定义词去空白、去重、限长限量；忽略大小写 */
export function sanitizeWords(words: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of words) {
    const word = raw.trim().slice(0, MAX_DRAW_WORD_LEN);
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(word);
    if (result.length >= MAX_DRAW_WORDS) break;
  }
  return result;
}

/** 桌面座位只分给参赛者和未参赛房主大屏；观战大屏不占座位号 */
function usedSeatNumbers(players: Player[]): Set<number> {
  const used = new Set<number>();
  for (const player of players) {
    if (player.role === "spectator") continue;
    if (player.seat >= 0 && player.seat < MAX_PLAYERS) used.add(player.seat);
  }
  return used;
}

/** 从期望座位开始顺时针找空位；没有空位返回 -1 */
export function pickSeat(players: Player[], preferred?: number): number {
  const used = usedSeatNumbers(players);
  const start =
    preferred !== undefined &&
    Number.isInteger(preferred) &&
    preferred >= 0 &&
    preferred < MAX_PLAYERS
      ? preferred
      : 0;
  for (let offset = 0; offset < MAX_PLAYERS; offset++) {
    const seat = (start + offset) % MAX_PLAYERS;
    if (!used.has(seat)) return seat;
  }
  return -1;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();

  get(code: string): RoomRecord | undefined {
    return this.rooms.get(code);
  }

  all(): IterableIterator<RoomRecord> {
    return this.rooms.values();
  }

  /** 大厅房间列表：只暴露公开信息，按创建时间倒序；没人在线的房间不展示 */
  list(limit = 30): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((record) => record.room.players.some((player) => player.connected))
      .map((record) => {
        const participants = record.room.players.filter((player) => player.role !== "spectator");
        return {
          code: record.room.code,
          hostName:
            record.room.players.find((player) => player.id === record.room.hostId)?.name ?? "房主",
          gameId: record.gameId,
          players: participants.length,
          online: participants.filter((player) => player.connected).length,
          capacity: record.room.maxPlayers,
          phase: record.room.phase,
          createdAt: record.room.createdAt,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  get size(): number {
    return this.rooms.size;
  }

  /**
   * 入座页的公开房态：只含昵称、头像、角色、在线状态。
   * 不返回玩家 id、token、准备状态和游戏数据。
   */
  preview(code: string): RoomPreview | null {
    const record = this.rooms.get(code);
    if (!record) return null;

    const { room, gameId } = record;
    const seats: (RoomSeatView | null)[] = new Array(room.maxPlayers).fill(null);
    for (const player of room.players) {
      if (player.role === "spectator") continue;
      if (player.seat < 0 || player.seat >= seats.length) continue;
      seats[player.seat] = {
        seat: player.seat,
        role: player.role,
        name: player.name,
        avatar: { ...player.avatar },
        connected: player.connected,
      };
    }

    const host = room.players.find((player) => player.id === room.hostId);
    const hostSeat = host && host.seat >= 0 && host.seat < room.maxPlayers ? host.seat : -1;
    return {
      code: room.code,
      phase: room.phase,
      maxPlayers: room.maxPlayers,
      hostPlays: room.hostPlays,
      hostSeat,
      host: {
        name: host?.name ?? "房主",
        avatar: host ? { ...host.avatar } : defaultAvatar("房主"),
      },
      gameId,
      seats,
    };
  }

  create(
    name: string,
    role: Role,
    gameId: string | null = null,
    avatar?: { text: string; color: string },
  ): { record: RoomRecord; player: Player; token: string } {
    const code = this.uniqueCode();
    const player: Player = {
      id: shortId("p"),
      name: name.trim().slice(0, 16),
      avatar: avatar ?? defaultAvatar(name),
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
      hostPlays: false,
    };
    const token = newToken();
    const record: RoomRecord = {
      room,
      version: 1,
      tokens: new Map([[player.id, token]]),
      lastActiveAt: Date.now(),
      gameId,
      settings: { ...DEFAULT_SETTINGS },
      drawSettings: { ...DEFAULT_DRAW_SETTINGS, customWords: [] },
      game: null,
      uno: null,
      color: null,
      draw: null,
    };
    this.rooms.set(code, record);
    return { record, player, token };
  }

  join(
    code: string,
    name: string,
    role: Role,
    avatar?: { text: string; color: string },
    options: { seat?: number; ready?: boolean } = {},
  ): JoinResult {
    const record = this.rooms.get(code);
    if (!record) return { ok: false, error: "ROOM_NOT_FOUND" };
    // 观战大屏可以随时加入；普通玩家仍只允许大厅加入
    if (role !== "spectator" && record.room.phase !== "lobby") {
      return { ok: false, error: "BAD_PHASE" };
    }
    const participants = record.room.players.filter((player) => player.role !== "spectator");
    if (role !== "spectator" && participants.length >= record.room.maxPlayers) {
      return { ok: false, error: "ROOM_FULL" };
    }

    const trimmed = name.trim().slice(0, 16);
    if (!trimmed) return { ok: false, error: "NAME_TAKEN" };
    // 大屏可以重名，方便多开；普通玩家仍保持昵称唯一
    if (
      role !== "spectator" &&
      record.room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    ) {
      return { ok: false, error: "NAME_TAKEN" };
    }

    // 观战大屏不占桌面座位，排到玩家列表最后
    const seat = role === "spectator" ? MAX_PLAYERS : pickSeat(record.room.players, options.seat);
    if (role !== "spectator" && seat < 0) {
      return { ok: false, error: "ROOM_FULL" };
    }

    const player: Player = {
      id: shortId("p"),
      name: trimmed,
      avatar: avatar ?? defaultAvatar(trimmed),
      role,
      seat,
      // 入座页坐下即准备；只有参赛玩家能 ready
      ready: role === "player" && options.ready === true,
      connected: true,
      joinedAt: Date.now(),
    };
    // 观战大屏不参与准备；房主参赛由 room.hostplays 统一设置 ready
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
      const next =
        record.room.players.find((p) => p.connected && p.role === "player") ??
        record.room.players.find((p) => p.connected) ??
        record.room.players[0];
      record.room.hostId = next.id;
      if (next.role === "spectator") {
        next.role = "screen";
        // 被提升为大屏的观战者原本没有桌面座位，补一个空位
        if (next.seat < 0 || next.seat >= record.room.maxPlayers) {
          const seat = pickSeat(record.room.players);
          if (seat >= 0) next.seat = seat;
        }
        record.room.hostPlays = false;
      } else {
        record.room.hostPlays = next.role === "player";
      }
    }

    record.version += 1;
    record.lastActiveAt = Date.now();
  }

  setReady(code: string, playerId: string, ready: boolean): Player | undefined {
    const record = this.rooms.get(code);
    const player = record?.room.players.find((p) => p.id === playerId);
    if (!record || !player) return undefined;
    // 只有参赛者能准备；大屏和未参赛房主忽略
    if (player.role !== "player") return player;
    if (player.ready === ready) return player;
    player.ready = ready;
    record.version += 1;
    record.lastActiveAt = Date.now();
    return player;
  }

  /** 房主切换是否参赛；参赛时自动 ready，退出时取消 ready */
  setHostPlays(code: string, enabled: boolean): boolean {
    const record = this.rooms.get(code);
    if (!record) return false;
    const host = record.room.players.find((player) => player.id === record.room.hostId);
    if (!host) return false;
    record.room.hostPlays = enabled;
    host.role = enabled ? "player" : "screen";
    host.ready = enabled;
    record.version += 1;
    record.lastActiveAt = Date.now();
    return true;
  }

  setSettings(code: string, settings: YiyuSettings): boolean {
    const record = this.rooms.get(code);
    if (!record) return false;
    record.settings = { ...settings };
    record.version += 1;
    record.lastActiveAt = Date.now();
    return true;
  }

  setDrawSettings(code: string, settings: DrawSettings): boolean {
    const record = this.rooms.get(code);
    if (!record) return false;
    record.drawSettings = {
      roundsPerPlayer: Math.min(3, Math.max(1, settings.roundsPerPlayer)),
      roundSeconds: Math.min(180, Math.max(30, settings.roundSeconds)),
      customWords: sanitizeWords(settings.customWords),
    };
    record.version += 1;
    record.lastActiveAt = Date.now();
    return true;
  }

  setAvatar(
    code: string,
    playerId: string,
    avatar: { text: string; color: string },
  ): Player | undefined {
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

  /** 清理长时间无人的房间（保留一点重连宽限，但不让幽灵房间留在列表里） */
  sweepEmpty(maxIdleMs = 30_000): void {
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
        code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("无法生成唯一房间码");
  }
}
