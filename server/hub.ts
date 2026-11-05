import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  MAX_CHAT_LEN,
  MAX_NAME_LEN,
  PROTOCOL_VERSION,
  isRoomCode,
  type ChatMessage,
  type ClientMessage,
  type ErrorCode,
  type Player,
  type Role,
  type ServerMessage,
} from "../shared/protocol";
import { RoomManager, type RoomRecord } from "./rooms";

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

const roleSchema = z.enum(["screen", "player", "spectator"]);
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LEN);

const createSchema = z.object({ name: nameSchema, role: roleSchema });
const joinSchema = z.object({
  code: z.string().trim().toUpperCase().refine(isRoomCode, "invalid room code"),
  name: nameSchema.optional(),
  role: roleSchema.optional(),
  token: z.string().length(32).optional(),
});
const readySchema = z.object({ ready: z.boolean() });
const chatSchema = z.object({ text: z.string().trim().min(1).max(MAX_CHAT_LEN) });
const pingSchema = z.object({ t: z.number() });

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
    case "chat.send": {
      const parsed = chatSchema.safeParse(msg.data);
      if (!parsed.success) return { kind: "invalid" };
      return { kind: "ok", msg: { ...base, type: "chat.send", data: parsed.data } };
    }
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

  constructor(private readonly rooms: RoomManager) {}

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
      data: { clientId: conn.id, protocol: PROTOCOL_VERSION, serverTime: Date.now() },
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

  private onMessage(conn: Conn, raw: string): void {
    if (raw.length > 64 * 1024) {
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
        return this.createRoom(conn, parsed.msg.data.name, parsed.msg.data.role);
      case "room.join":
        return this.joinRoom(conn, parsed.msg.data);
      case "room.leave":
        return this.leaveRoom(conn);
      case "player.ready":
        return this.setReady(conn, parsed.msg.data.ready);
      case "chat.send":
        return this.chat(conn, parsed.msg.data.text);
      case "ping":
        return this.send(conn, {
          v: 1,
          type: "pong",
          data: { t: parsed.msg.data.t, serverTime: Date.now() },
        });
    }
  }

  private createRoom(conn: Conn, name: string, role: Role): void {
    if (conn.roomCode) {
      this.replyError(conn, "BAD_PHASE", "你已经在一个房间里了");
      return;
    }
    const { record, player, token } = this.rooms.create(name, role);
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
    data: { code: string; name?: string; role?: Role; token?: string },
  ): void {
    if (conn.roomCode) {
      this.replyError(conn, "BAD_PHASE", "你已经在一个房间里了");
      return;
    }

    const result = data.token
      ? this.rooms.reconnect(data.code, data.token)
      : this.rooms.join(data.code, data.name ?? "", data.role ?? "player");

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
    this.send(conn, this.stateFor(result.record, result.player));
    this.broadcast(data.code);
  }

  private leaveRoom(conn: Conn): void {
    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;
    conn.roomCode = undefined;
    conn.playerId = undefined;
    this.clearRemovalTimer(roomCode, playerId);
    this.rooms.removePlayer(roomCode, playerId);
    this.broadcast(roomCode);
  }

  private setReady(conn: Conn, ready: boolean): void {
    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;
    if (!this.rooms.setReady(roomCode, playerId, ready)) return;
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

  private onClose(conn: Conn): void {
    this.conns.delete(conn.id);

    const { roomCode, playerId } = conn;
    if (!roomCode || !playerId) return;

    const record = this.rooms.get(roomCode);
    const player = record?.room.players.find((p) => p.id === playerId);
    if (!record || !player) return;

    player.connected = false;
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
      },
    };
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
