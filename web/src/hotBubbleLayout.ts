import * as d3 from "d3";
import type { HotCorpusItem } from "./api";

export type HotBubbleLayoutNode = {
  item: HotCorpusItem;
  x: number;
  y: number;
  r: number;
  scoreRatio: number;
};

type HotPackDatum = {
  item?: HotCorpusItem;
  value: number;
  children?: HotPackDatum[];
};

export function layoutHotBubbles(
  items: HotCorpusItem[],
  width: number,
): { nodes: HotBubbleLayoutNode[]; width: number; height: number } {
  const isNarrow = width <= 560;
  const packPad = isNarrow ? 10 : 14;
  const baseHeight = isNarrow ? Math.max(300, width * 0.75) : Math.max(340, Math.min(480, width * 0.5));
  const maxScore = Math.max(...items.map((item) => item.score), 1);

  const rootData: HotPackDatum = {
    value: 0,
    children: items.map((item) => ({
      item,
      value: Math.max(4, Math.sqrt(item.score) + 6),
    })),
  };

  const pack = d3
    .pack<HotPackDatum>()
    .size([width - packPad * 2, baseHeight - packPad * 2])
    .padding(isNarrow ? 5 : 8);
  const root = pack(d3.hierarchy(rootData).sum((d) => d.value));
  const nodes = root.leaves().map((node) => ({
    item: node.data.item!,
    x: node.x + packPad,
    y: node.y + packPad,
    r: node.r,
    scoreRatio: node.data.item!.score / maxScore,
  }));
  const maxBottom = d3.max(nodes, (d) => d.y + d.r) ?? baseHeight;
  const height = Math.max(baseHeight, maxBottom + packPad);
  return { nodes, width, height };
}

export function hotBubbleLabel(keywords: string, radius: number): string {
  const maxChars = radius < 26 ? 2 : radius < 38 ? 4 : radius < 52 ? 7 : 12;
  const text = keywords.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function hotBubbleFontSize(radius: number): number {
  return Math.max(10, Math.min(15, radius * 0.38));
}

export function hotBubbleFill(scoreRatio: number): string {
  const t = Math.max(0.12, Math.min(1, scoreRatio));
  const start = d3.rgb(255, 220, 190);
  const end = d3.rgb(254, 125, 55);
  return d3.interpolateRgb(start, end)(t);
}
