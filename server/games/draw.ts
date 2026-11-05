import type { DrawAction, DrawPoint, DrawStroke, DrawView, Player } from "../../shared/protocol";
import { DRAW_WORDS } from "./draw-words";

export interface DrawOptions {
  hostId: string;
  roundSeconds?: number;
  roundsPerPlayer?: number;
}

export interface DrawDelta {
  strokeId: string;
  points: DrawPoint[];
  color: string;
  width: number;
  start: boolean;
}

interface Entry {
  id: string;
  name: string;
  avatar: Player["avatar"];
  connected: boolean;
  score: number;
}

const MAX_POINTS = 6000;

function normalize(text: string): string {
  return text.replace(/[\s，。！？、,.!?：:；;“”"'（）()]/g, "").toLowerCase();
}

/**
 * 你画我猜：轮流由一名玩家在手机上画，笔迹实时同步到大屏，
 * 其他人在手机上打字猜词。猜对：猜的人 +10，画的人 +5。
 */
export class DrawGame {
  readonly gameId = "draw" as const;
  phase: "draw" | "reveal" | "ended" = "draw";
  round = 0;
  drawerId = "";
  drawerName = "";
  deadline = 0;
  winnerId?: string;

  private readonly players: Entry[] = [];
  private readonly totalRounds: number;
  private readonly roundMs: number;
  private readonly strokes: DrawStroke[] = [];
  private word = "";
  private revealUntil = 0;
  private pointCount = 0;
  private result?: { word: string; guesserName?: string; points?: number };
  private eventSeq = 0;
  private lastEvent: { id: number; text: string } | null = null;
  private readonly used = new Set<string>();

  constructor(players: Player[], options: DrawOptions, now: number) {
    this.roundMs = (options.roundSeconds ?? 80) * 1000;

    [...players]
      .filter((player) => player.id !== options.hostId)
      .sort((a, b) => a.seat - b.seat)
      .forEach((player) => {
        this.players.push({
          id: player.id,
          name: player.name,
          avatar: { ...player.avatar },
          connected: player.connected,
          score: 0,
        });
      });

    this.totalRounds = Math.max(1, this.players.length * (options.roundsPerPlayer ?? 1));
    this.startRound(now);
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.players.find((item) => item.id === playerId);
    if (player) player.connected = connected;
  }

  /** 返回需要转发给大屏的增量；不合法或非当前画手返回 null */
  stroke(playerId: string, action: Extract<DrawAction, { type: "stroke" }>): DrawDelta | null {
    if (this.phase !== "draw" || playerId !== this.drawerId) return null;
    const points = action.points
      .slice(0, 200)
      .filter(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= 0 &&
          point.x <= 1 &&
          point.y >= 0 &&
          point.y <= 1,
      )
      .map((point) => ({
        x: Math.round(point.x * 1000) / 1000,
        y: Math.round(point.y * 1000) / 1000,
      }));
    if (points.length === 0) return null;
    if (!/^#[0-9a-fA-F]{6}$/.test(action.color)) return null;

    const width = Math.min(24, Math.max(1, action.width));
    const strokeId = action.strokeId.slice(0, 24);

    if (action.start) {
      this.strokes.push({ id: strokeId, color: action.color, width, points });
      this.pointCount += points.length;
    } else {
      const stroke = this.strokes.find((item) => item.id === strokeId);
      if (!stroke) return null;
      if (this.pointCount >= MAX_POINTS) return null;
      stroke.points.push(...points);
      this.pointCount += points.length;
    }

    return {
      strokeId,
      points,
      color: action.color,
      width,
      start: action.start,
    };
  }

  clear(playerId: string): boolean {
    if (this.phase !== "draw" || playerId !== this.drawerId) return false;
    this.strokes.length = 0;
    this.pointCount = 0;
    return true;
  }

  guess(playerId: string, text: string, now: number): boolean {
    if (this.phase !== "draw") return false;
    if (playerId === this.drawerId) return false;
    const player = this.players.find((item) => item.id === playerId);
    if (!player) return false;
    if (normalize(text) !== normalize(this.word)) return false;

    const drawer = this.players.find((item) => item.id === this.drawerId);
    player.score += 10;
    if (drawer) drawer.score += 5;

    this.result = { word: this.word, guesserName: player.name, points: 10 };
    this.phase = "reveal";
    this.revealUntil = now + 4500;
    this.emit(`${player.name} 猜对了，答案是「${this.word}」`);
    return true;
  }

  tick(now: number): boolean {
    if (this.phase === "draw" && now >= this.deadline) {
      this.result = { word: this.word };
      this.phase = "reveal";
      this.revealUntil = now + 4500;
      this.emit(`时间到，答案是「${this.word}」`);
      return true;
    }
    if (this.phase === "reveal" && now >= this.revealUntil) {
      if (this.round >= this.totalRounds) {
        this.finish();
      } else {
        this.startRound(now);
      }
      return true;
    }
    return false;
  }

  viewFor(playerId: string): DrawView {
    const isDrawer = playerId === this.drawerId;
    const showWord = this.phase !== "draw" || isDrawer;

    return {
      gameId: "draw",
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      drawerId: this.drawerId,
      drawerName: this.drawerName,
      deadline: this.deadline,
      word: showWord ? this.word : undefined,
      scores: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        avatar: { ...player.avatar },
        score: player.score,
        connected: player.connected,
        isDrawer: player.id === this.drawerId,
      })),
      strokes: this.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      })),
      result: this.phase === "draw" ? undefined : this.result,
      lastEvent: this.lastEvent,
    };
  }

  private startRound(now: number): void {
    this.round += 1;
    const drawer = this.players[(this.round - 1) % this.players.length];
    this.drawerId = drawer?.id ?? "";
    this.drawerName = drawer?.name ?? "";

    if (this.used.size >= DRAW_WORDS.length) this.used.clear();
    const pool = DRAW_WORDS.filter((word) => !this.used.has(word));
    this.word = pool[Math.floor(Math.random() * pool.length)] ?? "太阳";
    this.used.add(this.word);

    this.strokes.length = 0;
    this.pointCount = 0;
    this.result = undefined;
    this.phase = "draw";
    this.deadline = now + this.roundMs;
    this.emit(`第 ${this.round} 轮：${this.drawerName} 来画`);
  }

  private finish(): void {
    this.phase = "ended";
    const best = [...this.players].sort((a, b) => b.score - a.score)[0];
    this.winnerId = best?.id;
    this.emit(best ? `${best.name} 获胜！` : "本局结束");
  }

  private emit(text: string): void {
    this.eventSeq += 1;
    this.lastEvent = { id: this.eventSeq, text };
  }
}
