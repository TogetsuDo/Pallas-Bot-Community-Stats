import * as d3 from "d3";
import type { BubbleBot } from "./api";
import { openQQProfile } from "./qqProfile";

type BubbleDatum = {
  bot?: BubbleBot;
  value: number;
  children?: BubbleDatum[];
};

type PackNode = d3.HierarchyCircularNode<BubbleDatum>;

function isBubbleClickable(bot?: BubbleBot): bot is BubbleBot {
  if (!bot) return false;
  return Boolean(bot.profile_url || bot.avatar_url || bot.nickname.trim());
}

const BUBBLE_POLL_MS = 60_000;
const PACK_PAD_RESERVE = 6;

export class BubbleWall {
  private readonly section: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly empty: HTMLElement;
  private pollTimer: number | null = null;
  private started = false;
  private resizeObserver: ResizeObserver | null = null;
  private renderToken = 0;
  private activeBotKey: string | null = null;
  private lastBots: BubbleBot[] = [];
  private popoverEl: HTMLElement | null = null;
  private docClickBound: ((event: MouseEvent) => void) | null = null;

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
      this.hidePopover();
    }
  }

  private render(bots: BubbleBot[]): void {
    const token = ++this.renderToken;
    this.lastBots = bots;
    const onlineCount = bots.filter((bot) => bot.online).length;
    this.legend.textContent = `共 ${bots.length} 只 · 在线 ${onlineCount} 只 · 点击头像查看昵称与添加好友`;

    if (!bots.length) {
      this.empty.hidden = false;
      this.empty.textContent =
        "暂无公开名册的牛牛。部署方可在 Pallas 控制台开启「社区名册公开」后出现在此（功能陆续接入）。";
      this.canvasHost.innerHTML = "";
      this.hidePopover();
      return;
    }

    if (this.activeBotKey && !bots.some((bot) => bot.bot_key === this.activeBotKey)) {
      this.activeBotKey = null;
      this.hidePopover();
    }

    this.empty.hidden = true;
    this.canvasHost.querySelector(".bubble-svg")?.remove();

    const width = this.canvasHost.clientWidth || 960;
    const isNarrow = width <= 560;
    const baseHeight = isNarrow ? Math.max(440, width * 0.95) : Math.max(540, Math.min(740, width * 0.62));
    const packPad = isNarrow ? 10 : 14;

    const rootData: BubbleDatum = {
      value: 0,
      children: bots.map((bot) => ({
        value: Math.max(1, Math.sqrt(bot.message_weight || 0) + 8),
        bot,
      })),
    };

    const pack = d3
      .pack<BubbleDatum>()
      .size([width - packPad * 2, baseHeight - PACK_PAD_RESERVE - packPad * 2])
      .padding(isNarrow ? 6 : 10);
    const root = pack(d3.hierarchy(rootData).sum((d) => d.value)) as PackNode;
    const nodes = root.leaves().map((node) => ({
      ...node,
      x: node.x + packPad,
      y: node.y + packPad,
    }));

    const maxBottom = d3.max(nodes, (d) => d.y + d.r) ?? baseHeight;
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
        const clickable = isBubbleClickable(d.data.bot) ? " bubble-node--clickable" : "";
        const active = d.data.bot?.bot_key === this.activeBotKey ? " bubble-node--active" : "";
        return `bubble-node${online}${clickable}${active}`;
      })
      .attr("data-bot-key", (d) => d.data.bot?.bot_key ?? "")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("--bubble-delay", (_, i) => `${Math.min(i * 45, 720)}ms`)
      .attr("role", (d) => (isBubbleClickable(d.data.bot) ? "button" : null))
      .attr("tabindex", (d) => (isBubbleClickable(d.data.bot) ? 0 : null))
      .attr("aria-expanded", (d) => (d.data.bot?.bot_key === this.activeBotKey ? "true" : "false"))
      .on("click", (event, d) => {
        event.stopPropagation();
        const bot = d.data.bot;
        if (!isBubbleClickable(bot)) return;
        if (this.activeBotKey === bot.bot_key) {
          this.activeBotKey = null;
          this.hidePopover();
          node.classed("bubble-node--active", false);
          return;
        }
        this.activeBotKey = bot.bot_key;
        node.classed("bubble-node--active", (n) => n.data.bot?.bot_key === bot.bot_key);
        this.showPopover(event.currentTarget as SVGGElement, bot);
      })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const bot = d.data.bot;
        if (!isBubbleClickable(bot)) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.activeBotKey === bot.bot_key) {
          this.activeBotKey = null;
          this.hidePopover();
          node.classed("bubble-node--active", false);
          return;
        }
        this.activeBotKey = bot.bot_key;
        node.classed("bubble-node--active", (n) => n.data.bot?.bot_key === bot.bot_key);
        this.showPopover(event.currentTarget as SVGGElement, bot);
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
    body.each(function (this: SVGGElement, d, i) {
      const g = d3.select(this);
      const bot = d.data.bot;
      const r = d.r - avatarInset;
      if (bot?.avatar_url) {
        g.append("image")
          .attr("class", "bubble-node__avatar")
          .attr("href", bot.avatar_url)
          .attr("width", Math.max(0, r * 2))
          .attr("height", Math.max(0, r * 2))
          .attr("x", -r)
          .attr("y", -r)
          .attr("clip-path", `url(#${clipPrefix}-${i})`);
        return;
      }
      const label = (bot?.nickname || "?").trim().slice(0, 1) || "?";
      g.append("circle")
        .attr("class", "bubble-node__avatar-fallback")
        .attr("r", r)
        .attr("fill", "var(--bubble-fallback-fill, #3d4556)");
      g.append("text")
        .attr("class", "bubble-node__avatar-fallback-text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", Math.max(12, r * 0.9))
        .text(label);
    });

    node.append("title").text((d) => {
      const bot = d.data.bot;
      if (!bot) return "";
      const tier = activityTier(bot.message_weight);
      return `${bot.nickname}\n${bot.online ? "在线" : "离线"} · 活跃度 ${tier}\n点击头像查看昵称与添加好友`;
    });

    if (this.activeBotKey) {
      const activeBot = bots.find((bot) => bot.bot_key === this.activeBotKey);
      const activeNode = this.canvasHost.querySelector<SVGGElement>(
        `g.bubble-node[data-bot-key="${CSS.escape(this.activeBotKey)}"]`,
      );
      if (activeBot && activeNode) {
        this.showPopover(activeNode, activeBot);
      }
    }

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.lastBots.length) this.render(this.lastBots);
      });
      this.resizeObserver.observe(this.canvasHost);
    }
  }

  private showPopover(nodeEl: SVGGElement, bot: BubbleBot): void {
    this.hidePopover();
    const popover = document.createElement("div");
    popover.className = "bubble-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", `${bot.nickname} 资料`);

    const name = document.createElement("p");
    name.className = "bubble-popover__name";
    name.textContent = bot.nickname.trim() || (bot.qq ? `牛 ${bot.qq}` : "牛牛");

    const meta = document.createElement("p");
    meta.className = "bubble-popover__meta";
    if (bot.qq) {
      meta.textContent = `QQ ${bot.qq} · ${bot.online ? "在线" : "离线"} · 活跃度 ${activityTier(bot.message_weight)}`;
    } else {
      meta.textContent = "牛牛未公开QQ";
    }

    const actions: HTMLElement[] = [name, meta];
    if (bot.profile_url && bot.qq) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "bubble-popover__add";
      addBtn.textContent = "添加好友";
      addBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void openQQProfile(bot.qq!, bot.profile_url);
      });
      actions.push(addBtn);
    }

    popover.append(...actions);
    popover.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(popover);
    this.popoverEl = popover;
    requestAnimationFrame(() => this.positionPopover(nodeEl, popover));

    if (!this.docClickBound) {
      this.docClickBound = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.popoverEl?.contains(target)) return;
        if (target instanceof Element && target.closest(".bubble-node")) return;
        this.activeBotKey = null;
        this.hidePopover();
        this.canvasHost.querySelectorAll(".bubble-node--active").forEach((el) => {
          el.classList.remove("bubble-node--active");
        });
      };
      document.addEventListener("click", this.docClickBound);
    }
  }

  private positionPopover(nodeEl: SVGGElement, popover: HTMLElement): void {
    const bubbleRect = nodeEl.getBoundingClientRect();
    const centerX = bubbleRect.left + bubbleRect.width / 2;
    const gap = 10;
    const popHeight = popover.offsetHeight;
    const fitsAbove = bubbleRect.top - gap >= popHeight;
    const fitsBelow = bubbleRect.bottom + gap + popHeight <= window.innerHeight;

    popover.classList.remove("bubble-popover--above", "bubble-popover--below");
    if (fitsAbove || !fitsBelow) {
      popover.classList.add("bubble-popover--above");
      popover.style.left = `${centerX}px`;
      popover.style.top = `${bubbleRect.top - gap}px`;
    } else {
      popover.classList.add("bubble-popover--below");
      popover.style.left = `${centerX}px`;
      popover.style.top = `${bubbleRect.bottom + gap}px`;
    }
  }

  private hidePopover(): void {
    this.popoverEl?.remove();
    this.popoverEl = null;
  }

  destroy(): void {
    if (this.pollTimer != null) window.clearInterval(this.pollTimer);
    this.resizeObserver?.disconnect();
    this.hidePopover();
    if (this.docClickBound) {
      document.removeEventListener("click", this.docClickBound);
      this.docClickBound = null;
    }
  }
}

function activityTier(weight: number): string {
  if (weight >= 5000) return "很高";
  if (weight >= 1000) return "较高";
  if (weight >= 200) return "一般";
  if (weight > 0) return "较低";
  return "暂无统计";
}
