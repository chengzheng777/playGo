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

export interface Avatar {
  /** 1–2 个字符，或一个 emoji */
  text: string;
  /** #rrggbb */
  color: string;
}

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
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

/** 大厅房间列表里的一条，不含玩家隐私字段 */
export interface RoomSummary {
  code: string;
  hostName: string;
  gameId: string | null;
  players: number;
  online: number;
  capacity: number;
  phase: Phase;
  createdAt: number;
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
  gameId: string | null;
  settings: YiyuSettings;
  game: YiyuView | null;
  uno: UnoView | null;
  color: ColorView | null;
  draw: DrawView | null;
}

/** 房主可改的规则，开局时生效 */
export interface YiyuSettings {
  /** 先到多少分获胜 */
  targetScore: number;
  /** 每回合多少秒 */
  roundSeconds: number;
}

export const DEFAULT_SETTINGS: YiyuSettings = { targetScore: 8, roundSeconds: 60 };

export type YiyuMode = "talk" | "act" | "lip" | "rush";
export type YiyuTeamId = "A" | "B";
export type YiyuPhase = "turn" | "reveal" | "ended";
export type YiyuResult = "correct" | "skip" | "timeout";

export interface YiyuMember {
  id: string;
  name: string;
  avatar: Avatar;
  connected: boolean;
}

export interface YiyuTeam {
  id: YiyuTeamId;
  name: string;
  score: number;
  members: YiyuMember[];
}

export interface YiyuGuess {
  playerId: string;
  name: string;
  text: string;
  ok: boolean;
}

export interface YiyuTurn {
  teamId: YiyuTeamId;
  describerId: string;
  describerName: string;
  mode: YiyuMode;
  /** 服务端时间戳，客户端用 serverTime 校准 */
  deadline: number;
  /** 只有描述者与揭晓之后才有值 */
  word?: string;
  guesses: YiyuGuess[];
  result?: YiyuResult;
  winnerName?: string;
}

export interface YiyuEvent {
  id: number;
  kind: "turn" | "correct" | "skip" | "timeout" | "win";
  text: string;
}

export interface YiyuView {
  gameId: "yiyu";
  phase: YiyuPhase;
  round: number;
  targetScore: number;
  roundSeconds: number;
  teams: YiyuTeam[];
  turn: YiyuTurn | null;
  winnerTeam?: YiyuTeamId;
  lastEvent: YiyuEvent | null;
}

export type YiyuAction = { type: "correct" } | { type: "skip" } | { type: "guess"; text: string };

export type UnoColor = "red" | "yellow" | "green" | "blue";
export type UnoCardColor = UnoColor | "wild";
export type UnoKind = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface UnoCard {
  id: string;
  color: UnoCardColor;
  kind: UnoKind;
  value?: number;
}

export interface UnoPlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  handCount: number;
  connected: boolean;
}

export interface UnoView {
  gameId: "uno";
  phase: "turn" | "ended";
  players: UnoPlayerView[];
  turnPlayerId: string;
  direction: 1 | -1;
  currentColor: UnoColor;
  discardTop: UnoCard;
  drawCount: number;
  hand: UnoCard[];
  playableIds: string[];
  mustDraw: boolean;
  winnerId?: string;
  lastEvent: { id: number; text: string } | null;
}

export type UnoAction =
  | { type: "play"; cardId: string; color?: UnoColor }
  | { type: "draw" }
  | { type: "pass" };

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawStroke {
  id: string;
  color: string;
  width: number;
  points: DrawPoint[];
}

export interface DrawPlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  connected: boolean;
  isDrawer: boolean;
}

export interface DrawView {
  gameId: "draw";
  phase: "draw" | "reveal" | "ended";
  round: number;
  totalRounds: number;
  drawerId: string;
  drawerName: string;
  deadline: number;
  word?: string;
  scores: DrawPlayerView[];
  strokes: DrawStroke[];
  result?: { word: string; guesserName?: string; points?: number };
  lastEvent: { id: number; text: string } | null;
}

export type DrawAction =
  | {
      type: "stroke";
      strokeId: string;
      points: DrawPoint[];
      color: string;
      width: number;
      start: boolean;
    }
  | { type: "clear" };

export interface ColorTarget {
  hex: string;
  name: string;
}

export interface ColorPlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  submitted: boolean;
  score: number;
  connected: boolean;
}

export interface ColorResultView {
  playerId: string;
  name: string;
  rgb: { r: number; g: number; b: number };
  distance: number;
  points: number;
  photo?: string;
}

export interface ColorView {
  gameId: "color";
  phase: "shoot" | "reveal" | "ended";
  round: number;
  totalRounds: number;
  target: ColorTarget;
  deadline: number;
  players: ColorPlayerView[];
  results: ColorResultView[];
  winnerId?: string;
  lastEvent: { id: number; text: string } | null;
}

export type ColorAction = {
  type: "shoot";
  rgb: { r: number; g: number; b: number };
  photo: string;
};

export type GameAction = YiyuAction | UnoAction | ColorAction | DrawAction;

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
  | (Envelope & {
      type: "room.create";
      data: { name: string; role: Role; gameId?: string; avatar?: Avatar };
    })
  | (Envelope & {
      type: "room.join";
      data: { code: string; name?: string; role?: Role; token?: string; avatar?: Avatar };
    })
  | (Envelope & { type: "room.leave"; data: Record<string, never> })
  | (Envelope & { type: "player.ready"; data: { ready: boolean } })
  | (Envelope & { type: "player.update"; data: { name?: string; avatar?: Avatar } })
  | (Envelope & { type: "chat.send"; data: { text: string } })
  | (Envelope & { type: "game.select"; data: { gameId: string } })
  | (Envelope & { type: "game.settings"; data: { settings: YiyuSettings } })
  | (Envelope & { type: "game.start"; data: Record<string, never> })
  | (Envelope & { type: "game.action"; data: { action: GameAction } })
  | (Envelope & { type: "game.back"; data: Record<string, never> })
  | (Envelope & { type: "ping"; data: { t: number } });

export type ServerMessage =
  | {
      v: 1;
      type: "welcome";
      data: { clientId: string; protocol: number; serverTime: number; buildId: string };
    }
  | { v: 1; type: "room.created"; data: { room: Room; you: Player; token: string } }
  | { v: 1; type: "room.state"; data: RoomStatePayload }
  | { v: 1; type: "chat.message"; data: ChatMessage }
  | {
      v: 1;
      type: "draw.delta";
      data: {
        strokeId: string;
        points: DrawPoint[];
        color: string;
        width: number;
        start: boolean;
      };
    }
  | { v: 1; type: "draw.clear"; data: Record<string, never> }
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
