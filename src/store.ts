import { useSyncExternalStore } from "react";
import type {
  ChatMessage,
  ClientMessage,
  ErrorCode,
  Player,
  Room,
  ServerMessage,
} from "../shared/protocol";

const NAME_KEY = "playgo:name";
const TOKEN_PREFIX = "playgo:token:";
const MAX_CHAT_HISTORY = 100;

export type View = "home" | "join" | "lobby";
export type ConnState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface AppState {
  view: View;
  joinCode: string;
  conn: ConnState;
  room: Room | null;
  you: Player | null;
  version: number;
  chat: ChatMessage[];
  error: string | null;
  busy: boolean;
  nickname: string;
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function readToken(code: string): string | null {
  try {
    return localStorage.getItem(TOKEN_PREFIX + code);
  } catch {
    return null;
  }
}

function readRoute(): { view: View; code: string } {
  const match = /^\/([jr])\/([A-Za-z0-9]{4})$/.exec(location.pathname);
  if (!match) return { view: "home", code: "" };
  return { view: match[1] === "j" ? "join" : "lobby", code: match[2]!.toUpperCase() };
}

class Store {
  private state: AppState;
  private readonly listeners = new Set<() => void>();

  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private session: { code: string; token: string } | null = null;
  private attempts = 0;
  private reconnectTimer: number | undefined;
  private closedByUs = false;

  constructor() {
    const route = readRoute();
    const nickname = readName();
    const base: AppState = {
      view: "home",
      joinCode: route.code,
      conn: "idle",
      room: null,
      you: null,
      version: 0,
      chat: [],
      error: null,
      busy: false,
      nickname,
    };

    if (route.view === "join") {
      this.state = { ...base, view: "join" };
    } else if (route.view === "lobby") {
      const token = readToken(route.code);
      if (token) {
        this.session = { code: route.code, token };
        this.state = { ...base, view: "lobby", conn: "connecting" };
        queueMicrotask(() => this.openSocket(true));
      } else {
        this.state = { ...base, view: "join" };
      }
    } else {
      this.state = base;
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this.socket && this.session) {
        this.openSocket(true);
      }
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): AppState => this.state;

  readonly clearError = (): void => {
    if (this.state.error !== null) this.set({ error: null });
  };

  createRoom(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || this.state.busy) return;
    this.rememberName(trimmed);
    this.closedByUs = false;
    this.set({ busy: true, error: null });
    this.send({ v: 1, type: "room.create", data: { name: trimmed, role: "screen" } });
    this.openSocket(false);
  }

  joinRoom(code: string, name: string): void {
    const trimmed = name.trim();
    const roomCode = code.trim().toUpperCase();
    if (!trimmed || !roomCode || this.state.busy) return;
    this.rememberName(trimmed);
    this.closedByUs = false;
    this.set({ busy: true, error: null, joinCode: roomCode });
    this.send({ v: 1, type: "room.join", data: { code: roomCode, name: trimmed, role: "player" } });
    this.openSocket(false);
  }

  toggleReady(): void {
    const you = this.state.you;
    if (!you) return;
    this.send({ v: 1, type: "player.ready", data: { ready: !you.ready } });
  }

  sendChat(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.send({ v: 1, type: "chat.send", data: { text: trimmed } });
  }

  leave(): void {
    this.closedByUs = true;
    this.send({ v: 1, type: "room.leave", data: {} });
    this.socket?.close();
    this.socket = null;

    if (this.session) {
      try {
        localStorage.removeItem(TOKEN_PREFIX + this.session.code);
      } catch {
        /* ignore */
      }
    }
    this.session = null;
    this.queue = [];
    this.attempts = 0;
    window.clearTimeout(this.reconnectTimer);

    this.set({
      view: "home",
      room: null,
      you: null,
      chat: [],
      conn: "idle",
      busy: false,
      error: null,
      joinCode: "",
    });
    history.replaceState(null, "", "/");
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private rememberName(name: string): void {
    this.set({ nickname: name });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  }

  private applySession(code: string, token: string): void {
    if (!token) return;
    this.session = { code, token };
    try {
      localStorage.setItem(TOKEN_PREFIX + code, token);
    } catch {
      /* ignore */
    }
  }

  private openSocket(resume: boolean): void {
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${scheme}://${location.host}/ws`);
    } catch {
      this.set({ conn: "closed", busy: false, error: "无法建立连接" });
      return;
    }

    this.socket = socket;
    this.set({ conn: resume ? "reconnecting" : "connecting" });

    socket.onopen = () => {
      this.attempts = 0;
      this.set({ conn: "open" });
      this.flush();
      if (resume) this.resumeSession();
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(message);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onSocketClosed();
    };

    socket.onerror = () => {
      /* close 事件会跟着来，统一在那里处理 */
    };
  }

  private resumeSession(): void {
    if (!this.session) return;
    this.send({
      v: 1,
      type: "room.join",
      data: { code: this.session.code, token: this.session.token },
    });
  }

  private onSocketClosed(): void {
    if (this.closedByUs) {
      this.set({ conn: "closed" });
      return;
    }
    if (this.session) {
      this.scheduleReconnect();
      return;
    }
    this.set({
      conn: "closed",
      busy: false,
      error: this.state.busy ? "连不上本地服务，确认服务已经启动" : null,
    });
  }

  private scheduleReconnect(): void {
    if (this.attempts >= 12) {
      this.set({ conn: "closed", error: "连接已断开，请刷新页面重试" });
      return;
    }
    const delay = Math.min(10_000, 400 * 2 ** this.attempts);
    this.attempts += 1;
    this.set({ conn: "reconnecting" });
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.openSocket(true), delay);
  }

  private send(message: ClientMessage): void {
    const payload = JSON.stringify({ ...message, v: 1, ts: Date.now() });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else {
      this.queue.push(message);
    }
  }

  private flush(): void {
    const pending = this.queue;
    this.queue = [];
    for (const message of pending) this.send(message);
  }

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
      case "pong":
      case "ack":
        return;

      case "room.created": {
        const { room, you, token } = message.data;
        this.applySession(room.code, token);
        this.set({
          view: "lobby",
          room,
          you,
          version: 1,
          busy: false,
          conn: "open",
          error: null,
        });
        history.replaceState(null, "", `/r/${room.code}`);
        return;
      }

      case "room.state": {
        const { room, you, version, token } = message.data;
        this.applySession(room.code, token);
        const wasLobby = this.state.view === "lobby";
        this.set({
          view: "lobby",
          room,
          you,
          version,
          busy: false,
          conn: "open",
        });
        if (!wasLobby) history.replaceState(null, "", `/r/${room.code}`);
        return;
      }

      case "chat.message": {
        this.set({ chat: [...this.state.chat, message.data].slice(-MAX_CHAT_HISTORY) });
        return;
      }

      case "error": {
        this.onError(message.data.code, message.data.message);
        return;
      }
    }
  }

  private onError(code: ErrorCode, text: string): void {
    const sessionGone = code === "ROOM_NOT_FOUND" || code === "BAD_TOKEN";

    if (sessionGone && this.state.view === "lobby") {
      this.session = null;
      this.queue = [];
      this.set({
        view: "home",
        room: null,
        you: null,
        chat: [],
        busy: false,
        conn: "closed",
        error: `${text}，请重新创建房间`,
      });
      history.replaceState(null, "", "/");
      return;
    }

    if (sessionGone) {
      this.session = null;
    }
    this.set({ busy: false, error: text });
  }
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
