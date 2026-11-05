import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import { isPlayableGame } from "../shared/games";
import {
  type Avatar,
  type ChatMessage,
  type ClientMessage,
  type ColorAction,
  type ErrorCode,
  type GameAction,
  isRoomCode,
  MAX_CHAT_LEN,
  MAX_NAME_LEN,
  type Player,
  PROTOCOL_VERSION,
  type Role,
  type ServerMessage,
  type UnoAction,
  type YiyuAction,
  type YiyuSettings,
} from "../shared/protocol";
import { ColorGame } from "./games/color";
import { DrawGame } from "./games/draw";
import { UnoGame } from "./games/uno";
import { YiyuGame } from "./games/yiyu";
import type { RoomManager, RoomRecord } from "./rooms";

interface Conn {
  id: string;
  ws: WebSocket;
  roomCode?: string;
  playerId?: string;
  alive: boolean;
  rateCount: number;
  rateResetAt: number;
  lastChatAt: number;
}

const RATE_LIMIT_PER_SEC = 40;
const CHAT_COOLDOWN_MS = 600;
const RECONNECT_GRACE_MS = 90_000;
/** 单帧上限：拍颜色的照片是 base64，360px JPEG 大约 20–60 KB，留足余量 */
const MAX_FRAME_CHARS = 512 * 1024;

const roleSchema = z.enum(["screen", "player", "spectator"]);
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LEN);
const avatarShape = z.object({
  text: z.string().trim().min(1).max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const createSchema = z.object({
  name: nameSchema,
  role: roleSchema,
  gameId: z.string().trim().max(32).optional(),
  avatar: avatarShape.optional(),
});
const joinSchema = z.object({
  code: z.string().trim().toUpperCase().refine(isRoomCode, "invalid room code"),
  name: nameSchema.optional(),
  role: roleSchema.optional(),
  token: z.string().length(32).optional(),
  avatar: avatarShape.optional(),
});
const readySchema = z.object({ ready: z.boolean() });
const profileSchema = z.object({
  name: nameSchema.optional(),
  avatar: avatarShape.optional(),
});
const chatSchema = z.object({ text: z.string().trim().min(1).max(MAX_CHAT_LEN) });
const pingSchema = z.object({ t: z.number() });
const selectGameSchema = z.object({ gameId: z.string().trim().min(1).max(32) });
const settingsSchema = z.object({
  settings: z.object({
    targetScore: z.number().int().min(3).max(20),
    roundSeconds: z.number().int().min(15).max(180),
  }),
});
const gameActionSchema = z.object({
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("correct") }),
    z.object({ type: z.literal("skip") }),
    z.object({ type: z.literal("guess"), text: z.string().trim().min(1).max(24) }),
    z.object({
      type: z.literal("play"),
      cardId: z.string().min(1).max(16),
      color: z.enum(["red", "yellow", "green", "blue"]).optional(),
    }),
    z.object({ type: z.literal("draw") }),
    z.object({ type: z.literal("pass") }),
    z.object({
      type: z.literal("stroke"),
      strokeId: z.string().min(1).max(24),
      points: z
        .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
        .min(1)
        .max(200),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      width: z.number().min(1).max(24),
      start: z.boolean(),
    }),
    z.object({ type: z.literal("clear") }),
    z.object({
      type: z.literal("shoot"),
      rgb: z.object({
        r: z.number().min(0).max(255),
        g: z.number().min(0).max(255),
        b: z.number().min(0).max(255),
      }),
      photo: z.string().min(32).max(320_000),
    }),
  ]),
});

type Parsed = { kind: "ok"; msg: ClientMessage } | { kind: "invalid" } | { kind: "unknown" };

function parseClientMessage(raw: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof data !== "object" || data === null) return { kind: "invalid" };
  const msg = data as Record<string, unknown>;
  if (msg.v !== 1 || typeof msg.type !== "string") return { kind: "invalid" };

  const base = { v: 1 as const, id: typeof msg.id === "string" ? msg.id : undefined };

  switch (msg.type) {
    case "room.create": {
      const parsed = createSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "room.create", data: parsed.data } };
    }
    case "room.join": {
      const parsed = joinSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "room.join", data: parsed.data } };
    }
    case "room.leave":
      return { kind: "ok", msg: { ...base, type: "room.leave", data: {} } };
    case "player.ready": {
      const parsed = readySchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "player.ready", data: parsed.data } };
    }
    case "player.update": {
      const parsed = profileSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "player.update", data: parsed.data } };
    }
    case "chat.send": {
      const parsed = chatSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "chat.send", data: parsed.data } };
    }
    case "game.select": {
      const parsed = selectGameSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "game.select", data: parsed.data } };
    }
    case "game.settings": {
      const parsed = settingsSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "game.settings", data: parsed.data } };
    }
    case "game.start":
      return { kind: "ok", msg: { ...base, type: "game.start", data: {} } };
    case "game.action": {
      const parsed = gameActionSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return {
        kind: "ok",
        msg: { ...base, type: "game.action", data: { action: parsed.data.action as GameAction } },
      };
    }
    case "game.back":
      return { kind: "ok", msg: { ...base, type: "game.back", data: {} } };
    case "ping": {
      const parsed = pingSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "ping", data: parsed.data } };
    }
    default:
      return { kind: "unknown" };
  }
}

export class Hub {
  private readonly conns = new Map<string, Conn>();
  private readonly removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly rooms: RoomManager,
    private readonly buildId: string,
  ) {}

  attach(ws: WebSocket): void {
    const conn: Conn = {
      id: randomUUID(),
      ws,
      alive: true,
      rateCount: 0,
      rateResetAt: 0,
      lastChatAt: 0,
    };
    this.conns.set(conn.id, conn);

    this.send(conn, {
      v: 1,
      type: "welcome",
      data: {
        clientId: conn.id,
        protocol: PROTOCOL_VERSION,
        serverTime: Date.now(),
        buildId: this.buildId,
      },
    });

    ws.on("message", (raw) => {
      try {
        this.onMessage(conn, raw.toString());
      } catch (error) {
        console.error("[ws] message handler failed:", error);
        this.fail(conn, "INTERNAL", "服务端处理消息失败");
      }
    });
    ws.on("close", () => this.onClose(conn));
    ws.on("error", () => undefined);
    ws.on("pong", () => {
      conn.alive = true;
    });
  }

  /** 心跳：定期 ping，连续一轮没有 pong 就断开 */
  sweep(): void {
    for (const conn of this.conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
  }

  /** 推进所有进行中的游戏（倒计时、揭晓后进入下一回合） */
  tickGames(now = Date.now()): void {
    for (const record of this.rooms.all()) {
      let changed = false;
      if (record.game?.tick(now)) changed = true;
      if (record.color?.tick(now)) changed = true;
      if (record.draw?.tick(now)) changed = true;
      if (!changed) continue;
      record.version += 1;
      this.broadcast(record.room.code);
    }
  }

  private onMessage(conn: Conn, raw: string): void {
    if (raw.length > MAX_FRAME_CHARS) {
      this.fail(conn, "PROTOCOL_ERROR", "消息过大");
      return;
    }

    const now = Date.now();
    if (now > conn.rateResetAt) {
      conn.rateCount = 0;
      conn.rateResetAt = now + 1000;
    }
    if (++conn.rateCount > RATE_LIMIT_PER_SEC) {
      this.replyError(conn, "RATE_LIMITED", "操作太频繁了");
      return;
    }

    const parsed = parseClientMessage(raw);
    if (parsed.kind === "unknown") return;
    if (parsed.kind === "invalid") {
      this.fail(conn, "PROTOCOL_ERROR", "无法解析的消息");
      return;
    }

    switch (parsed.msg.type) {
      case "room.create":
        return void this.createRoom(
          conn,
          parsed.msg.data.name,
          parsed.msg.data.role,
          parsed.msg.data.gameId,
          parsed.msg.data.avatar,
        );
      case "room.join":
        return void this.joinRoom(conn, parsed.msg.data);
      case "room.leave":
        return void this.leaveRoom(conn);
      case "player.ready":
        return void this.setReady(conn, parsed.msg.data.ready);
      case "player.update":
        return void this.setProfile(conn, parsed.msg.data);
      case "chat.send":
        return void this.chat(conn, parsed.msg.data.text);
      case "game.select":
        return void this.selectGame(conn, parsed.msg.data.gameId);
      case "game.settings":
        return void this.setSettings(conn, parsed.msg.data.settings);
      case "game.start":
        return void this.startGame(conn);
      case "game.action":
        return void this.gameAction(conn, parsed.msg.data.action);
      case "game.back":
        return void this.backToLobby(conn);
      case "ping":
        return void this.send(conn, {
          v: 1,
          type: "pong",
          data: { t: parsed.msg.data.t, serverTime: Date.now() },
        });
    }
  }

  private createRoom(conn: Conn, name: string, role: Role, gameId?: string, avatar?: Avatar): void {
    if (conn.roomCode) {
      this.replyError(conn, "BAD_PHASE", "你已经在一个房间里了");
      return;
    }
    const initialGame = gameId && isPlayableGame(gameId) ? gameId : null;
    const { record, player, token } = this.rooms.create(name, role, initialGame, avatar);
    this.bind(conn, record.room.code, player.id);
    this.send(conn, {
      v: 1,
      type: "room.created",
      data: { room: record.room, you: player, token },
    });
    this.broadcast(record.room.code);
  }

  private joinRoom(
    conn: Conn,
    data: { code: string; name?: string; role?: Role; token?: string; avatar?: Avatar },
  ): void {
    if (conn.roomCode) {
      this.replyError(conn, "BAD_PHASE", "你已经在一个房间里了");
      return;
    }

    const result = data.token
      ? this.rooms.reconnect(data.code, data.token)
      : this.rooms.join(data.code, data.name ?? "", data.role ?? "player", data.avatar);

    if (!result.ok) {
      this.replyError(conn, result.error, this.joinErrorMessage(result.error));
      return;
    }

    // 同一玩家在别处重连：先解绑旧连接，避免它触发掉线
    for (const other of this.conns.values()) {
      if (other !== conn && other.roomCode === data.code && other.playerId === result.player.id) {
        other.playerId = undefined;
        other.roomCode = undefined;
        try {
          other.ws.close(4001, "replaced");
        } catch {
          /* ignore */
        }
      }
    }

    this.bind(conn, data.code, result.player.id);
    this.clearRemovalTimer(data.code, result.player.id);
    result.record.game?.setConnected(result.player.id, true);
    result.record.uno?.setConnected(result.player.id, true);
    result.record.color?.setConnected(result.player.id, true);
    result.record.draw?.setConnected(result.player.id, true);
    this.send(conn, this.stateFor(result.record, result.player));
    this.broadcast(data.code);
  }

  private leaveRoom(conn: Conn): void {
    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;
    conn.roomCode = undefined;
    conn.playerId = undefined;
    this.clearRemovalTimer(roomCode, playerId);
    const record = this.rooms.get(roomCode);
    record?.game?.setConnected(playerId, false);
    record?.uno?.setConnected(playerId, false);
    record?.color?.setConnected(playerId, false);
    record?.draw?.setConnected(playerId, false);
    this.rooms.removePlayer(roomCode, playerId);
    this.broadcast(roomCode);
  }

  private setReady(conn: Conn, ready: boolean): void {
    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;
    if (!this.rooms.setReady(roomCode, playerId, ready)) return;
    this.broadcast(roomCode);
  }

  private setProfile(conn: Conn, data: { name?: string; avatar?: Avatar }): void {
    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;
    const record = this.rooms.get(roomCode);
    const player = record?.room.players.find((item) => item.id === playerId);
    if (!record || !player) return;

    if (data.name) {
      const name = data.name.trim().slice(0, MAX_NAME_LEN);
      const taken = record.room.players.some(
        (item) => item.id !== player.id && item.name.toLowerCase() === name.toLowerCase(),
      );
      if (name && !taken) player.name = name;
    }

    if (data.avatar) {
      const text = [...data.avatar.text.trim()].slice(0, 2).join("");
      if (text) {
        player.avatar = { text, color: data.avatar.color.toLowerCase() };
      }
    }

    record.version += 1;
    record.lastActiveAt = Date.now();
    this.broadcast(roomCode);
  }

  private chat(conn: Conn, text: string): void {
    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;

    const now = Date.now();
    if (now - conn.lastChatAt < CHAT_COOLDOWN_MS) {
      this.replyError(conn, "RATE_LIMITED", "说慢一点");
      return;
    }
    conn.lastChatAt = now;

    const record = this.rooms.get(roomCode);
    const player = record?.room.players.find((p) => p.id === playerId);
    if (!record || !player) return;

    const message: ChatMessage = {
      id: randomUUID(),
      from: player.id,
      name: player.name,
      text: text.slice(0, MAX_CHAT_LEN),
      ts: now,
    };
    this.broadcastRaw(roomCode, { v: 1, type: "chat.message", data: message });
    this.rooms.touch(roomCode);
  }

  private selectGame(conn: Conn, gameId: string): void {
    const record = this.roomOf(conn);
    if (!record) {
      this.replyError(conn, "ROOM_NOT_FOUND", "房间已失效，请重新创建");
      return;
    }
    if (!this.isHost(conn, record)) return;
    if (record.room.phase !== "lobby") {
      this.replyError(conn, "BAD_PHASE", "游戏进行中不能换游戏");
      return;
    }
    if (!isPlayableGame(gameId)) {
      this.replyError(conn, "BAD_PHASE", "这个游戏还没开放");
      return;
    }
    record.gameId = gameId;
    record.version += 1;
    this.broadcast(record.room.code);
  }

  private setSettings(conn: Conn, settings: YiyuSettings): void {
    const record = this.roomOf(conn);
    if (!record) {
      this.replyError(conn, "ROOM_NOT_FOUND", "房间已失效，请重新创建");
      return;
    }
    if (!this.isHost(conn, record)) return;
    if (record.room.phase !== "lobby") {
      this.replyError(conn, "BAD_PHASE", "开局后不能再改规则");
      return;
    }
    this.rooms.setSettings(record.room.code, settings);
    this.broadcast(record.room.code);
  }

  private startGame(conn: Conn): void {
    const record = this.roomOf(conn);
    if (!record) {
      this.replyError(conn, "ROOM_NOT_FOUND", "房间已失效，请重新创建");
      return;
    }
    if (!this.isHost(conn, record)) return;

    if (record.room.phase === "playing") {
      this.replyError(conn, "BAD_PHASE", "游戏已经开始了");
      return;
    }
    if (!record.gameId || !isPlayableGame(record.gameId)) {
      this.replyError(conn, "BAD_PHASE", "先选一个游戏");
      return;
    }

    // 房主是大屏 / 主持人，不参赛；队伍只由手机玩家组成
    const participants = record.room.players.filter((player) => player.id !== record.room.hostId);
    const connected = participants.filter((player) => player.connected);
    if (connected.length < 2) {
      this.replyError(conn, "BAD_PHASE", "至少需要 2 名玩家（房主是大屏，不参赛）");
      return;
    }
    const notReady = connected.filter((player) => !player.ready);
    if (notReady.length > 0) {
      this.replyError(conn, "BAD_PHASE", `还有 ${notReady.length} 人没准备`);
      return;
    }

    if (record.gameId === "uno") {
      record.uno = new UnoGame(participants, Date.now());
      record.game = null;
      record.color = null;
      record.draw = null;
    } else if (record.gameId === "color") {
      record.color = new ColorGame(
        record.room.players,
        {
          hostId: record.room.hostId,
          rounds: 3,
          shootSeconds: 40,
        },
        Date.now(),
      );
      record.game = null;
      record.uno = null;
      record.draw = null;
    } else if (record.gameId === "draw") {
      record.draw = new DrawGame(
        record.room.players,
        { hostId: record.room.hostId, roundSeconds: 80, roundsPerPlayer: 1 },
        Date.now(),
      );
      record.game = null;
      record.uno = null;
      record.color = null;
    } else {
      record.game = new YiyuGame(
        record.room.players,
        { ...record.settings, hostId: record.room.hostId },
        Date.now(),
      );
      record.uno = null;
      record.color = null;
      record.draw = null;
    }
    record.room.phase = "playing";
    record.version += 1;
    this.broadcast(record.room.code);
  }

  private gameAction(conn: Conn, action: GameAction): void {
    const record = this.roomOf(conn);
    if (record?.room.phase !== "playing" || !conn.playerId) return;

    const now = Date.now();
    let changed = false;
    if (record.game) {
      changed = record.game.action(conn.playerId, action as YiyuAction, now);
    } else if (record.uno) {
      changed = record.uno.action(conn.playerId, action as UnoAction, now);
    } else if (record.color) {
      changed = record.color.action(conn.playerId, action as ColorAction, now);
    } else if (record.draw) {
      if (action.type === "stroke") {
        const delta = record.draw.stroke(conn.playerId, action);
        if (delta) {
          this.sendToHost(record.room.code, { v: 1, type: "draw.delta", data: delta });
        }
        return;
      }
      if (action.type === "clear") {
        if (record.draw.clear(conn.playerId)) {
          this.sendToHost(record.room.code, { v: 1, type: "draw.clear", data: {} });
        }
        return;
      }
      if (action.type === "guess") {
        changed = record.draw.guess(conn.playerId, action.text, now);
      }
    }

    if (changed) {
      record.version += 1;
      this.broadcast(record.room.code);
    }
  }

  private backToLobby(conn: Conn): void {
    const record = this.roomOf(conn);
    if (!record) return;
    if (!this.isHost(conn, record)) return;
    if (record.room.phase === "lobby") return;

    record.room.phase = "lobby";
    record.game = null;
    record.uno = null;
    record.color = null;
    record.draw = null;
    for (const player of record.room.players) player.ready = false;
    record.version += 1;
    this.broadcast(record.room.code);
  }

  private onClose(conn: Conn): void {
    this.conns.delete(conn.id);

    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;

    const record = this.rooms.get(roomCode);
    const player = record?.room.players.find((p) => p.id === playerId);
    if (!record || !player) return;

    player.connected = false;
    record.game?.setConnected(playerId, false);
    record.uno?.setConnected(playerId, false);
    record.color?.setConnected(playerId, false);
    record.draw?.setConnected(playerId, false);
    record.version += 1;
    this.broadcast(roomCode);
    this.scheduleRemoval(roomCode, playerId);
  }

  private scheduleRemoval(code: string, playerId: string): void {
    const key = `${code}:${playerId}`;
    this.clearRemovalTimer(code, playerId);

    const timer = setTimeout(() => {
      this.removalTimers.delete(key);
      const record = this.rooms.get(code);
      const player = record?.room.players.find((p) => p.id === playerId);
      if (!record || !player || player.connected) return;
      this.rooms.removePlayer(code, playerId);
      this.broadcast(code);
    }, RECONNECT_GRACE_MS);

    (timer as { unref?: () => void }).unref?.();
    this.removalTimers.set(key, timer);
  }

  private clearRemovalTimer(code: string, playerId: string): void {
    const key = `${code}:${playerId}`;
    const timer = this.removalTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.removalTimers.delete(key);
    }
  }

  private roomOf(conn: Conn): RoomRecord | undefined {
    return conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
  }

  private isHost(conn: Conn, record: RoomRecord): boolean {
    if (record.room.hostId === conn.playerId) return true;
    this.replyError(conn, "NOT_HOST", "只有房主能做这个操作");
    return false;
  }

  private bind(conn: Conn, code: string, playerId: string): void {
    conn.roomCode = code;
    conn.playerId = playerId;
  }

  private stateFor(record: RoomRecord, player: Player): ServerMessage {
    return {
      v: 1,
      type: "room.state",
      data: {
        room: {
          ...record.room,
          players: record.room.players.map((p) => ({ ...p })),
        },
        you: { ...player },
        version: record.version,
        token: record.tokens.get(player.id) ?? "",
        serverTime: Date.now(),
        gameId: record.gameId,
        settings: { ...record.settings },
        game: record.game?.viewFor(player.id) ?? null,
        uno: record.uno?.viewFor(player.id) ?? null,
        color: record.color?.viewFor(player.id) ?? null,
        draw: record.draw?.viewFor(player.id) ?? null,
      },
    };
  }

  private sendToHost(code: string, message: ServerMessage): void {
    const record = this.rooms.get(code);
    if (!record) return;
    for (const conn of this.conns.values()) {
      if (conn.roomCode === code && conn.playerId === record.room.hostId) {
        this.send(conn, message);
      }
    }
  }

  private broadcast(code: string): void {
    const record = this.rooms.get(code);
    if (!record) return;

    for (const conn of this.conns.values()) {
      if (conn.roomCode !== code || !conn.playerId) continue;
      const player = record.room.players.find((p) => p.id === conn.playerId);
      if (!player) continue;
      this.send(conn, this.stateFor(record, player));
    }
  }

  private broadcastRaw(code: string, message: ServerMessage): void {
    for (const conn of this.conns.values()) {
      if (conn.roomCode !== code) continue;
      this.send(conn, message);
    }
  }

  private send(conn: Conn, message: ServerMessage): void {
    if (conn.ws.readyState !== 1) return;
    try {
      conn.ws.send(JSON.stringify(message));
    } catch {
      /* ignore */
    }
  }

  private replyError(conn: Conn, code: ErrorCode, message: string): void {
    this.send(conn, { v: 1, type: "error", data: { code, message } });
  }

  private fail(conn: Conn, code: ErrorCode, message: string): void {
    this.send(conn, { v: 1, type: "error", data: { code, message, fatal: true } });
    try {
      conn.ws.close(4000, code);
    } catch {
      /* ignore */
    }
  }

  private joinErrorMessage(code: string): string {
    switch (code) {
      case "ROOM_NOT_FOUND":
        return "房间不存在，或已经结束";
      case "ROOM_FULL":
        return "房间人满了";
      case "NAME_TAKEN":
        return "这个昵称已经有人用了";
      case "BAD_TOKEN":
        return "身份已失效，请重新加入";
      case "BAD_PHASE":
        return "游戏已经开始，暂时不能加入";
      default:
        return "加入失败";
    }
  }
}
