import type { HotCorpusItem } from "./api";

export type HotTagSize = "xs" | "sm" | "md" | "lg" | "xl";

export type HotTagNode = {
  item: HotCorpusItem;
  scoreRatio: number;
  sizeClass: HotTagSize;
  rank: number;
};

function sizeClassForRatio(scoreRatio: number): HotTagSize {
  if (scoreRatio >= 0.82) return "xl";
  if (scoreRatio >= 0.62) return "lg";
  if (scoreRatio >= 0.42) return "md";
  if (scoreRatio >= 0.22) return "sm";
  return "xs";
}

export function rankHotItems(items: HotCorpusItem[]): HotTagNode[] {
  const sorted = [...items].sort((a, b) => b.score - a.score || a.keywords.localeCompare(b.keywords, "zh"));
  const maxScore = Math.max(...sorted.map((item) => item.score), 1);
  return sorted.map((item, index) => {
    const scoreRatio = item.score / maxScore;
    return {
      item,
      scoreRatio,
      sizeClass: sizeClassForRatio(scoreRatio),
      rank: index + 1,
    };
  });
}
