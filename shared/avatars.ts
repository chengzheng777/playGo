import type { Avatar } from "./protocol";

export const AVATAR_COLORS = [
  "#3ee08f",
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
];

export const AVATAR_EMOJIS = [
  "🦊",
  "🐼",
  "🐸",
  "🐯",
  "🦁",
  "🐨",
  "🐷",
  "🐙",
  "🦄",
  "🐳",
  "🦉",
  "🐝",
  "🌵",
  "🍉",
  "🍕",
  "🎈",
  "🎮",
  "🚀",
  "⚡",
  "🌈",
  "👻",
  "🤖",
  "🍀",
  "🔥",
];

/** 默认头像：昵称首字 + 由昵称派生的颜色，同一个人每次进来颜色一致 */
export function defaultAvatar(name: string): Avatar {
  const chars = [...name.trim()];
  const first = (chars[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const char of chars) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100003;
  }
  return {
    text: first,
    color: AVATAR_COLORS[hash % AVATAR_COLORS.length],
  };
}
