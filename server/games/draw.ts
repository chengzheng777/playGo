import type {
  DrawAction,
  DrawGuesserView,
  DrawGuessView,
  DrawPoint,
  DrawResultView,
  DrawStroke,
  DrawView,
  Player,
} from "../../shared/protocol";
import { DRAW_WORDS } from "./draw-words";

export interface DrawOptions {
  hostId: string;
  roundSeconds?: number;
  roundsPerPlayer?: number;
  /** 房主添加的词，追加到内置词库 */
  customWords?: string[];
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
  timeMs: number;
}

const MAX_POINTS = 6000;
/** 多人抢答按猜对顺序计分：第 1 位 5 分、第 2 位 3 分、之后 1 分 */
const RANK_POINTS = [5, 3] as const;

function normalize(text: string): string {
  return text.replace(/[\s，。！？、,.!?：:；;“”"'（）()]/g, "").toLowerCase();
}

/** 内置词 + 自定义词，去重后作为同一词池 */
function buildWordPool(customWords: string[] = []): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of [...DRAW_WORDS, ...customWords]) {
    const word = raw.trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words;
}

function pointsForRank(index: number): number {
  return RANK_POINTS[index] ?? 1;
}

/**
 * 你画我猜：轮流由一名玩家在手机上画，笔迹实时同步到大屏，
 * 其他人在手机上打字猜词。
 *
 * 一轮允许多人先后猜对，按顺序 5 / 3 / 1 分；所有人猜对或超时才结束。
 * 画手每有一人猜对 +1，全员猜对时本轮 0 分。
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
  private readonly wordPool: string[];
  private readonly strokes: DrawStroke[] = [];
  private word = "";
  private revealUntil = 0;
  private pointCount = 0;
  private result?: DrawResultView;
  private eventSeq = 0;
  private lastEvent: { id: number; text: string } | null = null;
  private readonly used = new Set<string>();
  private startedAt = 0;
  private guesses: DrawGuessView[] = [];
  private roundCorrect: DrawGuesserView[] = [];

  constructor(players: Player[], options: DrawOptions, now: number) {
    this.roundMs = (options.roundSeconds ?? 80) * 1000;
    this.wordPool = buildWordPool(options.customWords);

    // 只纳入在线玩家：离线玩家不占画手轮次
    [...players]
      .filter((player) => player.id !== options.hostId && player.connected)
      .sort((a, b) => a.seat - b.seat)
      .forEach((player) => {
        this.players.push({
          id: player.id,
          name: player.name,
          avatar: { ...player.avatar },
          connected: player.connected,
          score: 0,
          timeMs: 0,
        });
      });

    this.totalRounds = Math.max(1, this.players.length * (options.roundsPerPlayer ?? 1));
    this.startRound(now);
  }

  get guesserCount(): number {
    return Math.max(0, this.players.length - 1);
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
    if (now >= this.deadline) return false;
    if (playerId === this.drawerId) return false;
    const player = this.players.find((item) => item.id === playerId);
    if (!player) return false;
    // 同一轮已经猜对的人不再重复得分
    if (this.roundCorrect.some((item) => item.playerId === playerId)) return false;

    const answer = normalize(text) === normalize(this.word);
    if (!answer) {
      this.pushGuess({ name: player.name, text: text.slice(0, 24), ok: false });
      return true;
    }

    const points = pointsForRank(this.roundCorrect.length);
    player.score += points;
    player.timeMs += Math.max(0, now - this.startedAt);
    this.roundCorrect.push({ playerId: player.id, name: player.name, points });
    this.pushGuess({ name: player.name, text: text.slice(0, 24), ok: true, points });
    // 画手每有一人猜对先 +1；若最终全员猜对，会在 finishRound 里退回
    const drawer = this.players.find((item) => item.id === this.drawerId);
    if (drawer) drawer.score += 1;

    if (this.roundCorrect.length >= this.guesserCount) {
      this.finishRound(now, true);
    } else {
      this.emit(
        `${player.name} 猜对了（+${points}），还剩 ${this.guesserCount - this.roundCorrect.length} 人`,
      );
    }
    return true;
  }

  tick(now: number): boolean {
    if (this.phase === "draw" && now >= this.deadline) {
      this.finishRound(now, false);
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
        timeMs: player.timeMs,
        connected: player.connected,
        isDrawer: player.id === this.drawerId,
      })),
      strokes: this.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      })),
      guesses: this.guesses.map((guess) => ({ ...guess })),
      guesserCount: this.guesserCount,
      correctGuessers: this.roundCorrect.map((guesser) => ({ ...guesser })),
      result: this.phase === "draw" ? undefined : this.result,
      lastEvent: this.lastEvent,
    };
  }

  private pushGuess(guess: DrawGuessView): void {
    this.guesses.push(guess);
    if (this.guesses.length > 8) this.guesses.shift();
  }

  private startRound(now: number): void {
    this.round += 1;
    const drawer =
      this.players.length > 0 ? this.players[(this.round - 1) % this.players.length] : undefined;
    this.drawerId = drawer?.id ?? "";
    this.drawerName = drawer?.name ?? "";

    if (this.used.size >= this.wordPool.length) this.used.clear();
    const pool = this.wordPool.filter((word) => !this.used.has(word));
    this.word = pool[Math.floor(Math.random() * pool.length)] ?? "太阳";
    this.used.add(this.word);

    this.strokes.length = 0;
    this.pointCount = 0;
    this.guesses = [];
    this.roundCorrect = [];
    this.result = undefined;
    this.phase = "draw";
    this.startedAt = now;
    this.deadline = now + this.roundMs;
    this.emit(`第 ${this.round} 轮：${this.drawerName} 来画`);
  }

  /**
   * 结束本轮。allCorrect 为 true 时所有猜词者都已答对，画手不加分；
   * 否则（超时）画手按本轮猜对人数 +1。
   */
  private finishRound(now: number, allCorrect: boolean): void {
    const correctIds = new Set(this.roundCorrect.map((item) => item.playerId));
    for (const player of this.players) {
      if (!correctIds.has(player.id)) player.timeMs += this.roundMs;
    }

    const drawer = this.players.find((item) => item.id === this.drawerId);
    const drawerPoints = allCorrect ? 0 : this.roundCorrect.length;
    // 猜对时已经每人 +1；全员猜对时把本轮加过的分退回
    if (drawer && allCorrect) drawer.score -= this.roundCorrect.length;

    this.result = {
      word: this.word,
      guessers: this.roundCorrect.map((item) => ({ ...item })),
      allCorrect,
      drawerPoints,
    };
    this.phase = "reveal";
    this.revealUntil = now + 4500;

    if (allCorrect) {
      this.emit(`全员猜对！答案是「${this.word}」`);
    } else if (this.roundCorrect.length > 0) {
      this.emit(`本轮结束，${this.roundCorrect.length} 人猜对，答案是「${this.word}」`);
    } else {
      this.emit(`时间到，答案是「${this.word}」`);
    }
  }

  private finish(): void {
    this.phase = "ended";
    // 同分时用时少的获胜
    const best = [...this.players].sort((a, b) => b.score - a.score || a.timeMs - b.timeMs)[0];
    this.winnerId = best?.id;
    this.emit(best ? `${best.name} 获胜！` : "本局结束");
  }

  private emit(text: string): void {
    this.eventSeq += 1;
    this.lastEvent = { id: this.eventSeq, text };
  }
}
