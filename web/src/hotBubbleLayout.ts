import type { HotCorpusItem } from "./api";

export type HotTagSize = "xs" | "sm" | "md" | "lg" | "xl";

export type HotTagNode = {
  item: HotCorpusItem;
  scoreRatio: number;
  sizeClass: HotTagSize;
  rank: number;
};

export type HotTagLayoutNode = HotTagNode & {
  x: number;
  y: number;
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

type PillBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type PlacedTag = PillBox & HotTagNode;

function sizeClassForRatio(scoreRatio: number): HotTagSize {
  if (scoreRatio >= 0.82) return "xl";
  if (scoreRatio >= 0.62) return "lg";
  if (scoreRatio >= 0.42) return "md";
  if (scoreRatio >= 0.22) return "sm";
  return "xs";
}

function isCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function estimatePillBox(node: HotTagNode, containerWidth: number): { w: number; h: number } {
  const fontPx = { xs: 12.5, sm: 13.8, md: 15.4, lg: 17.3, xl: 19.5 };
  const pad = { xs: [11, 6], sm: [13, 7], md: [15, 9], lg: [18, 11], xl: [22, 13] };
  const [px, py] = pad[node.sizeClass];
  const rankExtra = node.rank <= 3 ? 28 : 0;
  const scoreExtra = String(node.item.score).length * 9 + 32;
  const charWidth = fontPx[node.sizeClass] * (isCjk(node.item.keywords) ? 1.02 : 0.62);
  const textWidth = node.item.keywords.length * charWidth;
  const maxW = Math.min(containerWidth * 0.58, 300);
  const w = Math.min(maxW, px * 2 + rankExtra + textWidth + scoreExtra) * 1.06;
  const h = (py * 2 + fontPx[node.sizeClass] * 1.32) * 1.04;
  return { w, h };
}

function boxesOverlap(a: PillBox, b: PillBox, gap: number): boolean {
  return (
    a.x - a.w / 2 - gap < b.x + b.w / 2 &&
    a.x + a.w / 2 + gap > b.x - b.w / 2 &&
    a.y - a.h / 2 - gap < b.y + b.h / 2 &&
    a.y + a.h / 2 + gap > b.y - b.h / 2
  );
}

function separatePair(
  a: PillBox,
  b: PillBox,
  gap: number,
  fixA: boolean,
  fixB: boolean,
  pushStrength = 0.44,
): boolean {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    dx = 1;
    dy = 0;
  }
  const dist = Math.hypot(dx, dy);
  const need = Math.max((a.w + b.w) / 2 + gap, (a.h + b.h) / 2 + gap);
  if (dist >= need) return false;

  const push = (need - dist) * pushStrength;
  const ux = dx / dist;
  const uy = dy / dist;

  if (fixA && !fixB) {
    b.x += ux * push;
    b.y += uy * push;
  } else if (fixB && !fixA) {
    a.x -= ux * push;
    a.y -= uy * push;
  } else if (!fixA && !fixB) {
    a.x -= ux * push * 0.5;
    a.y -= uy * push * 0.5;
    b.x += ux * push * 0.5;
    b.y += uy * push * 0.5;
  }

  return !fixA || !fixB;
}

function inflatedBox(node: PlacedTag): PillBox {
  return {
    x: node.x,
    y: node.y,
    w: node.w * 1.04,
    h: node.h * 1.06,
  };
}

function resolveOverlaps(nodes: PlacedTag[], gap: number, cx: number, cy: number): void {
  for (let iter = 0; iter < 10; iter += 1) {
    let adjusted = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!boxesOverlap(a, b, gap)) continue;
        if (separatePair(a, b, gap, i === 0, j === 0, 0.5)) {
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }

  nodes[0].x = cx;
  nodes[0].y = cy;
}

function polishRemainingOverlaps(nodes: PlacedTag[], gap: number, cx: number, cy: number): void {
  for (let iter = 0; iter < 14; iter += 1) {
    let adjusted = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!boxesOverlap(inflatedBox(a), inflatedBox(b), gap)) continue;
        if (separatePair(a, b, gap, i === 0, j === 0, 0.72)) {
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }

  nodes[0].x = cx;
  nodes[0].y = cy;
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

export function layoutHotTags(
  items: HotCorpusItem[],
  width: number,
): { nodes: HotTagLayoutNode[]; height: number } {
  const ranked = rankHotItems(items);
  if (!ranked.length) {
    return { nodes: [], height: 280 };
  }

  const isNarrow = width <= 560;
  const layoutGap = isNarrow ? 4 : 5;
  const resolveGap = isNarrow ? 3 : 4;
  const polishGap = isNarrow ? 4 : 5;
  const edge = layoutGap + 2;
  const cx = width / 2;
  const cy = 0;
  const compact = isNarrow ? 0.83 : 0.86;
  const placed: PlacedTag[] = [];

  ranked.forEach((node, index) => {
    const { w, h } = estimatePillBox(node, width);

    if (index === 0) {
      placed.push({ ...node, x: cx, y: cy, w, h });
      return;
    }

    let angle = (index - 1) * GOLDEN_ANGLE;
    let radius = Math.max(w, h) * 0.36;
    let x = cx + radius * Math.cos(angle);
    let y = cy + radius * Math.sin(angle);

    for (let attempt = 0; attempt < 1200; attempt += 1) {
      const candidate: PillBox = { x, y, w, h };
      const collides = placed.some((other) => boxesOverlap(candidate, other, layoutGap));
      const inBounds = x - w / 2 >= edge && x + w / 2 <= width - edge;
      if (!collides && inBounds) {
        placed.push({ ...node, x, y, w, h });
        return;
      }
      angle += GOLDEN_ANGLE * 0.26;
      radius += isNarrow ? 1.15 : 1.32;
      x = cx + radius * Math.cos(angle);
      y = cy + radius * Math.sin(angle);
    }

    placed.push({ ...node, x: cx, y: cy + radius, w, h });
  });

  const compacted: PlacedTag[] = placed.map(({ w, h, x, y, ...node }) => ({
    ...node,
    x: cx + (x - cx) * compact,
    y: cy + (y - cy) * compact,
    w,
    h,
  }));

  resolveOverlaps(compacted, resolveGap, cx, cy);
  polishRemainingOverlaps(compacted, polishGap, cx, cy);

  const padY = isNarrow ? 12 : 14;
  const minY = Math.min(...compacted.map((node) => node.y - node.h / 2)) - padY;
  const maxY = Math.max(...compacted.map((node) => node.y + node.h / 2)) + padY;
  const height = Math.max(isNarrow ? 258 : 296, maxY - minY);
  const shiftY = height / 2 - (minY + maxY) / 2;

  const nodes = compacted.map(({ w, h, ...node }) => ({
    ...node,
    y: node.y + shiftY,
  }));

  return { nodes, height };
}
