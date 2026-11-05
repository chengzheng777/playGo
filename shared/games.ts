/**
 * 游戏目录：前后端共用。
 * 只描述「有哪些游戏、能不能玩」，具体规则在服务端 game 模块里。
 */

export type GameId = "yiyu" | "color" | "draw" | "undercover" | "uno";

export interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  players: string;
  emoji: string;
  accent: string;
  available: boolean;
}

export const GAME_CATALOG: readonly GameMeta[] = [
  {
    id: "yiyu",
    name: "一愚惊人",
    tagline: "一人比划，全队猜词",
    players: "2–8 人 · 分队对抗",
    emoji: "🎭",
    accent: "#8b5cf6",
    available: true,
  },
  {
    id: "color",
    name: "拍颜色",
    tagline: "拍出最接近的颜色",
    players: "2–8 人 · 相机",
    emoji: "🎨",
    accent: "#fb7185",
    available: true,
  },
  {
    id: "draw",
    name: "你画我猜",
    tagline: "画得越烂，猜得越欢",
    players: "2–8 人",
    emoji: "🖌️",
    accent: "#38bdf8",
    available: false,
  },
  {
    id: "undercover",
    name: "谁是卧底",
    tagline: "找出拿到不同词的那个人",
    players: "4–8 人",
    emoji: "🕵️",
    accent: "#fb7185",
    available: false,
  },
  {
    id: "uno",
    name: "一起 UNO",
    tagline: "经典卡牌，友谊终结者",
    players: "2–8 人",
    emoji: "🃏",
    accent: "#fbbf24",
    available: true,
  },
];

export function getGameMeta(id: string): GameMeta | undefined {
  return GAME_CATALOG.find((game) => game.id === id);
}

export function isPlayableGame(id: string): boolean {
  const meta = getGameMeta(id);
  return meta?.available === true;
}
