/**
 * 前后端共享的协议常量与类型。
 * 不依赖任何运行时，浏览器与 Node 均可导入。
 */

export const PROTOCOL_VERSION = 1;

export const MAX_PLAYERS = 8;
export const MAX_NAME_LEN = 16;
export const MAX_CHAT_LEN = 200;

/** 去掉了 0 O 1 I，避免手输与念读混淆 */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LEN = 4;

export type Role = "screen" | "player" | "spectator";
export type Phase = "lobby" | "playing" | "ended";

export interface Player {
  id: string;
  name: string;
  role: Role;
  seat: number;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface Room {
  code: string;
  hostId: string;
  phase: Phase;
  players: Player[];
  createdAt: number;
  maxPlayers: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
}

export interface RoomStatePayload {
  room: Room;
  you: Player;
  version: number;
  token: string;
  serverTime: number;
}

export type ErrorCode =
  | "PROTOCOL_ERROR"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NAME_TAKEN"
  | "BAD_TOKEN"
  | "BAD_PHASE"
  | "NOT_HOST"
  | "RATE_LIMITED"
  | "REPLACED"
  | "INTERNAL";

export interface Envelope {
  v: 1;
  id?: string;
  ts?: number;
}

export type ClientMessage =
  | (Envelope & { type: "room.create"; data: { name: string; role: Role } })
  | (Envelope & {
      type: "room.join";
      data: { code: string; name?: string; role?: Role; token?: string };
    })
  | (Envelope & { type: "room.leave"; data: Record<string, never> })
  | (Envelope & { type: "player.ready"; data: { ready: boolean } })
  | (Envelope & { type: "chat.send"; data: { text: string } })
  | (Envelope & { type: "ping"; data: { t: number } });

export type ServerMessage =
  | { v: 1; type: "welcome"; data: { clientId: string; protocol: number; serverTime: number } }
  | { v: 1; type: "room.created"; data: { room: Room; you: Player; token: string } }
  | { v: 1; type: "room.state"; data: RoomStatePayload }
  | { v: 1; type: "chat.message"; data: ChatMessage }
  | { v: 1; type: "pong"; data: { t: number; serverTime: number } }
  | { v: 1; type: "ack"; data: { id: string } }
  | { v: 1; type: "error"; data: { code: ErrorCode; message: string; fatal?: boolean } };

export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LEN) return false;
  for (const ch of value) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
