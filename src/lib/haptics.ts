const KEY = "playgo:haptics";

let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== "off";
} catch {
  /* ignore */
}

export function isHapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(KEY, value ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function buzz(pattern: number | number[]): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 桌面 / iOS 不支持，静默降级 */
  }
}

/**
 * 震动节奏参考 Switch 的 HD 震动：短促、有层次，而不是一直嗡嗡响。
 * 最后一次震动要晚于动画，才有「打到手上」的感觉。
 */
export const haptics = {
  tick: () => buzz(8),
  turn: () => buzz(14),
  correct: () => buzz([18, 28, 45]),
  timeout: () => buzz([90, 50, 90]),
  win: () => buzz([30, 50, 30, 50, 140]),
  wrong: () => buzz([40, 40]),
};
