import * as d3 from "d3";
import type { BubbleBot } from "./api";

type BubbleDatum = {
  bot?: BubbleBot;
  value: number;
  children?: BubbleDatum[];
};

type PackNode = d3.HierarchyCircularNode<BubbleDatum>;

const BUBBLE_POLL_MS = 60_000;

export class BubbleWall {
  private readonly section: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly empty: HTMLElement;
  private pollTimer: number | null = null;
  private started = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(section: HTMLElement) {
    this.section = section;
    this.canvasHost = section.querySelector<HTMLElement>("[data-bubble-canvas]")!;
    this.legend = section.querySelector<HTMLElement>("[data-bubble-legend]")!;
    this.empty = section.querySelector<HTMLElement>("[data-bubble-empty]")!;
  }

  observe(load: () => Promise<BubbleBot[]>): void {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (this.started) return;
        this.started = true;
        void this.refresh(load);
        this.pollTimer = window.setInterval(() => void this.refresh(load), BUBBLE_POLL_MS);
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(this.section);
  }

  private async refresh(load: () => Promise<BubbleBot[]>): Promise<void> {
    try {
      const bots = await load();
      this.render(bots);
    } catch (err) {
      this.empty.hidden = false;
      this.empty.textContent = `气泡数据加载失败：${err instanceof Error ? err.message : String(err)}`;
      this.canvasHost.innerHTML = "";
    }
  }

  private render(bots: BubbleBot[]): void {
    const onlineCount = bots.filter((bot) => bot.online).length;
    this.legend.textContent = `共 ${bots.length} 只 · 在线 ${onlineCount} 只 · 气泡大小反映活跃度`;

    if (!bots.length) {
      this.empty.hidden = false;
      this.empty.textContent =
        "暂无公开名册的牛牛。部署方可在 Pallas 控制台开启「社区名册公开」后出现在此（功能陆续接入）。";
      this.canvasHost.innerHTML = "";
      return;
    }

    this.empty.hidden = true;
    this.canvasHost.innerHTML = "";

    const width = this.canvasHost.clientWidth || 960;
    const isNarrow = width <= 560;
    const height = isNarrow ? Math.max(420, width * 0.95) : Math.max(520, Math.min(720, width * 0.62));

    const svg = d3
      .select(this.canvasHost)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "社区牛牛气泡墙");

    const rootData: BubbleDatum = {
      value: 0,
      children: bots.map((bot) => ({
        value: Math.max(1, Math.sqrt(bot.message_weight || 0) + 8),
        bot,
      })),
    };

    const pack = d3.pack<BubbleDatum>().size([width, height]).padding(isNarrow ? 3 : 6);
    const root = pack(d3.hierarchy(rootData).sum((d) => d.value)) as PackNode;

    const nodes = root.leaves();
    const node = svg
      .selectAll<SVGGElement, PackNode>("g.bubble-node")
      .data(nodes)
      .join("g")
      .attr("class", (d) => `bubble-node${d.data.bot?.online ? " bubble-node--online" : " bubble-node--offline"}`)
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    node
      .append("circle")
      .attr("r", (d) => d.r)
      .attr("class", "bubble-node__halo");

    node
      .append("clipPath")
      .attr("id", (_, i) => `clip-${i}`)
      .append("circle")
      .attr("r", (d) => Math.max(0, d.r - 3));

    node
      .append("image")
      .attr("href", (d) => d.data.bot?.avatar_url ?? "")
      .attr("width", (d) => (d.r - 3) * 2)
      .attr("height", (d) => (d.r - 3) * 2)
      .attr("x", (d) => -(d.r - 3))
      .attr("y", (d) => -(d.r - 3))
      .attr("clip-path", (_, i) => `url(#clip-${i})`);

    node
      .filter((d) => d.r >= (isNarrow ? 28 : 34))
      .append("text")
      .attr("class", "bubble-node__label")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.r + (isNarrow ? 12 : 14))
      .text((d) => truncate(d.data.bot?.nickname ?? "", isNarrow ? 8 : 12));

    node.append("title").text((d) => {
      const bot = d.data.bot;
      if (!bot) return "";
      const tier = activityTier(bot.message_weight);
      return `${bot.nickname}\n${bot.online ? "在线" : "离线"} · 活跃度 ${tier}`;
    });

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (bots.length) this.render(bots);
      });
      this.resizeObserver.observe(this.canvasHost);
    }
  }

  destroy(): void {
    if (this.pollTimer != null) window.clearInterval(this.pollTimer);
    this.resizeObserver?.disconnect();
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function activityTier(weight: number): string {
  if (weight >= 5000) return "很高";
  if (weight >= 1000) return "较高";
  if (weight >= 200) return "一般";
  if (weight > 0) return "较低";
  return "暂无统计";
}
