import * as d3 from "d3";
import type { BubbleBot } from "./api";
import { openQQProfile } from "./qqProfile";

type BubbleDatum = {
  bot?: BubbleBot;
  value: number;
  children?: BubbleDatum[];
};

type PackNode = d3.HierarchyCircularNode<BubbleDatum>;

const BUBBLE_POLL_MS = 60_000;
const LABEL_RESERVE = 28;

export class BubbleWall {
  private readonly section: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly empty: HTMLElement;
  private pollTimer: number | null = null;
  private started = false;
  private resizeObserver: ResizeObserver | null = null;
  private renderToken = 0;

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
    const token = ++this.renderToken;
    const onlineCount = bots.filter((bot) => bot.online).length;
    this.legend.textContent = `共 ${bots.length} 只 · 在线 ${onlineCount} 只 · 点击头像查看 QQ 资料`;

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
    const baseHeight = isNarrow ? Math.max(440, width * 0.95) : Math.max(540, Math.min(740, width * 0.62));
    const packPad = isNarrow ? 10 : 14;
    const minLabelR = isNarrow ? 24 : 30;

    const rootData: BubbleDatum = {
      value: 0,
      children: bots.map((bot) => ({
        value: Math.max(1, Math.sqrt(bot.message_weight || 0) + 8),
        bot,
      })),
    };

    const pack = d3
      .pack<BubbleDatum>()
      .size([width - packPad * 2, baseHeight - LABEL_RESERVE - packPad * 2])
      .padding(isNarrow ? 6 : 10);
    const root = pack(d3.hierarchy(rootData).sum((d) => d.value)) as PackNode;
    const nodes = root.leaves().map((node) => ({
      ...node,
      x: node.x + packPad,
      y: node.y + packPad,
    }));

    const maxBottom = d3.max(nodes, (d) => d.y + d.r + LABEL_RESERVE) ?? baseHeight;
    const height = Math.max(baseHeight, maxBottom + packPad);

    const svg = d3
      .select(this.canvasHost)
      .append("svg")
      .attr("class", "bubble-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "社区牛牛气泡墙");

    const defs = svg.append("defs");
    const clipPrefix = `bubble-clip-${token}`;

    nodes.forEach((node, index) => {
      const clipId = `${clipPrefix}-${index}`;
      defs
        .append("clipPath")
        .attr("id", clipId)
        .append("circle")
        .attr("r", Math.max(0, node.r - 4));
    });

    const node = svg
      .selectAll<SVGGElement, (typeof nodes)[number]>("g.bubble-node")
      .data(nodes)
      .join("g")
      .attr("class", (d) => {
        const online = d.data.bot?.online ? " bubble-node--online" : " bubble-node--offline";
        const clickable = d.data.bot?.profile_url ? " bubble-node--clickable" : "";
        return `bubble-node${online}${clickable}`;
      })
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("--bubble-delay", (_, i) => `${Math.min(i * 45, 720)}ms`)
      .attr("role", (d) => (d.data.bot?.profile_url ? "button" : null))
      .attr("tabindex", (d) => (d.data.bot?.profile_url ? 0 : null))
      .on("click", (_, d) => {
        const bot = d.data.bot;
        if (!bot?.profile_url) return;
        void openQQProfile(bot.qq, bot.profile_url);
      })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const bot = d.data.bot;
        if (!bot?.profile_url) return;
        event.preventDefault();
        void openQQProfile(bot.qq, bot.profile_url);
      });

    const body = node.append("g").attr("class", "bubble-node__body");

    body
      .filter((d) => d.data.bot?.online === true)
      .append("circle")
      .attr("r", (d) => d.r + 2)
      .attr("class", "bubble-node__pulse");

    body
      .append("circle")
      .attr("r", (d) => d.r)
      .attr("class", "bubble-node__halo");

    const avatarInset = 4;
    body
      .append("image")
      .attr("class", "bubble-node__avatar")
      .attr("href", (d) => d.data.bot?.avatar_url ?? "")
      .attr("width", (d) => Math.max(0, (d.r - avatarInset) * 2))
      .attr("height", (d) => Math.max(0, (d.r - avatarInset) * 2))
      .attr("x", (d) => -(d.r - avatarInset))
      .attr("y", (d) => -(d.r - avatarInset))
      .attr("clip-path", (_, i) => `url(#${clipPrefix}-${i})`);

    const labelLayer = svg.append("g").attr("class", "bubble-label-layer");

    labelLayer
      .selectAll<SVGGElement, (typeof nodes)[number]>("g.bubble-node__label-wrap")
      .data(nodes.filter((d) => d.r >= minLabelR))
      .join("g")
      .attr("class", (d) =>
        d.data.bot?.online ? "bubble-node__label-wrap bubble-node__label-wrap--online" : "bubble-node__label-wrap",
      )
      .attr("transform", (d) => `translate(${d.x}, ${d.y + d.r + (isNarrow ? 8 : 10)})`)
      .style("--bubble-delay", (_, i) => `${Math.min(i * 45 + 120, 840)}ms`)
      .each(function (d) {
        const nickname = truncate(d.data.bot?.nickname ?? "", isNarrow ? 8 : 12);
        if (!nickname) return;

        const wrap = d3.select(this);
        const text = wrap
          .append("text")
          .attr("class", "bubble-node__label")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .text(nickname);

        const box = (text.node() as SVGTextElement).getBBox();
        const padX = 8;
        const padY = 4;
        wrap
          .insert("rect", "text")
          .attr("class", "bubble-node__label-bg")
          .attr("x", box.x - padX)
          .attr("y", box.y - padY)
          .attr("width", box.width + padX * 2)
          .attr("height", box.height + padY * 2)
          .attr("rx", box.height / 2 + padY);
      });

    node.append("title").text((d) => {
      const bot = d.data.bot;
      if (!bot) return "";
      const tier = activityTier(bot.message_weight);
      return `${bot.nickname}\n${bot.online ? "在线" : "离线"} · 活跃度 ${tier}\n点击查看 QQ 资料`;
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
