import { describe, expect, it } from "vitest";
import { sanitizeWords } from "../server/rooms";
import { MAX_DRAW_WORD_LEN, MAX_DRAW_WORDS } from "../shared/protocol";

describe("你画我猜自定义词库", () => {
  it("去首尾空白、忽略大小写去重、按单字上限截断", () => {
    expect(sanitizeWords([" 苹果 ", "苹果", "BANANA", "banana", "", "x".repeat(30)])).toEqual([
      "苹果",
      "BANANA",
      "x".repeat(MAX_DRAW_WORD_LEN),
    ]);
  });

  it("最多保留上限数量", () => {
    const words = Array.from({ length: MAX_DRAW_WORDS + 5 }, (_, index) => `词${index}`);
    expect(sanitizeWords(words)).toHaveLength(MAX_DRAW_WORDS);
  });
});
