import type {
  ColorAction,
  ColorResultView,
  ColorTarget,
  ColorView,
  Player,
} from "../../shared/protocol";

const PALETTE: ColorTarget[] = [
  { name: "珊瑚橙", hex: "#FF7F50" },
  { name: "薄荷绿", hex: "#3EB489" },
  { name: "天空蓝", hex: "#87CEEB" },
  { name: "樱花粉", hex: "#FFB7C5" },
  { name: "柠檬黄", hex: "#F4D03F" },
  { name: "葡萄紫", hex: "#8B5CF6" },
  { name: "番茄红", hex: "#E63946" },
  { name: "青柠绿", hex: "#A3E635" },
  { name: "深海蓝", hex: "#1E3A8A" },
  { name: "奶油白", hex: "#F5F0E1" },
];

const RANK_POINTS = [100, 80, 60, 50, 40, 30, 20, 10];

export interface ColorOptions {
  hostId: string;
  rounds?: number;
  shootSeconds?: number;
}

interface Entry {
  id: string;
  name: string;
  avatar: Player["avatar"];
  connected: boolean;
  score: number;
  submission?: { rgb: { r: number; g: number; b: number }; photo: string };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
}

function rgbToLab(rgb: { r: number; g: number; b: number }): {
  l: number;
  a: number;
  b: number;
} {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return Math.sqrt((la.l - lb.l) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2);
}

/**
 * 拍颜色：每轮给一个目标颜色，玩家拍一张照片，
 * 取照片中心区域的平均色，与目标色在 Lab 空间里的距离越近排名越高。
 */
export class ColorGame {
  readonly gameId = "color" as const;
  phase: "shoot" | "reveal" | "ended" = "shoot";
  round = 0;
  target: ColorTarget = PALETTE[0];
  deadline = 0;
  winnerId?: string;

  private readonly players: Entry[] = [];
  private readonly hostId: string;
  private readonly totalRounds: number;
  private readonly shootMs: number;
  private results: ColorResultView[] = [];
  private revealUntil = 0;
  private eventSeq = 0;
  private lastEvent: { id: number; text: string } | null = null;
  private usedTargets: string[] = [];

  constructor(players: Player[], options: ColorOptions, now: number) {
    this.hostId = options.hostId;
    this.totalRounds = options.rounds ?? 3;
    this.shootMs = (options.shootSeconds ?? 40) * 1000;

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

    this.startRound(now);
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.players.find((item) => item.id === playerId);
    if (player) player.connected = connected;
  }

  action(playerId: string, action: ColorAction, now: number): boolean {
    if (this.phase !== "shoot") return false;
    const player = this.players.find((item) => item.id === playerId);
    if (!player || player.submission) return false;
    if (!action.photo.startsWith("data:image/") || action.photo.length > 320_000) return false;

    const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
    player.submission = {
      rgb: {
        r: clamp(action.rgb.r),
        g: clamp(action.rgb.g),
        b: clamp(action.rgb.b),
      },
      photo: action.photo,
    };
    this.emit(`${player.name} 拍好了`);

    const connected = this.players.filter((item) => item.connected);
    if (connected.length > 0 && connected.every((item) => item.submission)) {
      this.resolve(now);
    }
    return true;
  }

  tick(now: number): boolean {
    if (this.phase === "shoot" && now >= this.deadline) {
      this.resolve(now);
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

  viewFor(playerId: string): ColorView {
    const isHost = playerId === this.hostId;
    return {
      gameId: "color",
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      target: { ...this.target },
      deadline: this.deadline,
      players: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        avatar: { ...player.avatar },
        submitted: Boolean(player.submission),
        score: player.score,
        connected: player.connected,
      })),
      results:
        this.phase === "shoot"
          ? []
          : this.results.map((result) => ({
              ...result,
              photo: isHost ? result.photo : undefined,
            })),
      winnerId: this.winnerId,
      lastEvent: this.lastEvent,
    };
  }

  private startRound(now: number): void {
    this.round += 1;
    this.phase = "shoot";
    this.results = [];
    this.deadline = now + this.shootMs;

    for (const player of this.players) player.submission = undefined;

    const pool = PALETTE.filter((target) => !this.usedTargets.includes(target.name));
    const choices = pool.length > 0 ? pool : PALETTE;
    this.target = choices[Math.floor(Math.random() * choices.length)];
    this.usedTargets.push(this.target.name);
    if (this.usedTargets.length >= PALETTE.length) this.usedTargets = [];

    this.emit(`第 ${this.round} 轮：拍出「${this.target.name}」`);
  }

  private resolve(now: number): void {
    const targetRgb = hexToRgb(this.target.hex);
    const entries = this.players
      .filter((player) => player.submission)
      .map((player) => ({
        player,
        distance: deltaE(player.submission!.rgb, targetRgb),
      }))
      .sort((a, b) => a.distance - b.distance);

    this.results = entries.map((entry, index) => {
      const points = RANK_POINTS[index] ?? 0;
      entry.player.score += points;
      return {
        playerId: entry.player.id,
        name: entry.player.name,
        rgb: entry.player.submission!.rgb,
        distance: Math.round(entry.distance * 10) / 10,
        points,
        photo: entry.player.submission!.photo,
      };
    });

    this.phase = "reveal";
    this.revealUntil = now + 9000;
    this.emit(
      entries.length > 0
        ? `${entries[0].player.name} 最接近「${this.target.name}」`
        : "这一轮没有人提交",
    );
  }

  private finish(): void {
    this.phase = "ended";
    const best = [...this.players].sort((a, b) => b.score - a.score)[0];
    this.winnerId = best?.id;
    this.emit(best ? `${best.name} 总分最高，获胜！` : "本局结束");
  }

  private emit(text: string): void {
    this.eventSeq += 1;
    this.lastEvent = { id: this.eventSeq, text };
  }
}
