import type { BubbleBot } from "./api";
import { importD3 } from "./d3Loader";
import { copyQQNumber, openQQProfile } from "./qqProfile";

type LayoutMode = "flat" | "sphere";
type Vec3 = { x: number; y: number; z: number };

type LayoutNode = {
  id: string;
  bot: BubbleBot;
  r: number;
  x: number;
  y: number;
  wx: number;
  wy: number;
  wz: number;
};

type SimLink = {
  source: LayoutNode;
  target: LayoutNode;
};

type Projected = {
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
  depthClass: "near" | "mid" | "far";
};

type NodeSelection = import("d3").Selection<SVGGElement, LayoutNode, SVGGElement, unknown>;
type LinkSelection = import("d3").Selection<SVGLineElement, SimLink, SVGGElement, unknown>;

type SceneRefs = {
  stageSel: import("d3").Selection<SVGGElement, unknown, null, undefined>;
  meshLayerSel: import("d3").Selection<SVGGElement, unknown, null, undefined> | null;
  meshSel: import("d3").Selection<SVGPathElement, MeshCurve, SVGGElement, unknown> | null;
  linkLayerSel: import("d3").Selection<SVGGElement, unknown, null, undefined>;
  nodeSel: NodeSelection;
  linkSel: LinkSelection;
  clipIds: string[];
  clipCircleSels: import("d3").Selection<SVGCircleElement, unknown, null, undefined>[];
};

type MeshCurve = {
  id: string;
  points: Vec3[];
};

type D3Module = Awaited<ReturnType<typeof importD3>>;

const BUBBLE_POLL_MS = 60_000;
const FOCUS_ANIM_MS = 980;
const IDLE_ROT_X = 0.32;
const IDLE_ROT_Y = 0.58;
const LAYOUT_STORAGE_KEY = "pallas-hub-bubble-layout";
const PACK_PAD_RESERVE = 6;
const AUTO_SPIN_Y_PER_FRAME = 0.0011;
const DRAG_SENS_MOUSE = 0.0042;
const DRAG_SENS_TOUCH = 0.0038;
const DRAG_MOVE_THRESHOLD_PX = 4;

function isBubbleClickable(bot?: BubbleBot): bot is BubbleBot {
  if (!bot) return false;
  return Boolean(bot.profile_url || bot.avatar_url || bot.nickname.trim());
}

function readLayoutMode(): LayoutMode {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw === "sphere" ? "sphere" : "flat";
  } catch {
    return "flat";
  }
}

function storeLayoutMode(mode: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export class BubbleWall {
  private readonly section: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly viewToggle: HTMLElement | null;
  private readonly onBotsChange?: (bots: BubbleBot[]) => void;
  private pollTimer: number | null = null;
  private started = false;
  private resizeObserver: ResizeObserver | null = null;
  private renderToken = 0;
  private layoutMode: LayoutMode = readLayoutMode();
  private activeBotKey: string | null = null;
  private popoverBotKey: string | null = null;
  private lastBots: BubbleBot[] = [];
  private layoutNodes: LayoutNode[] = [];
  private lastViewport = { width: 960, height: 540 };
  private sphereRadius = 220;
  private viewRotX = IDLE_ROT_X;
  private viewRotY = IDLE_ROT_Y;
  private focusBlend = 0;
  private scene: SceneRefs | null = null;
  private d3Ref: D3Module | null = null;
  private animFrame: number | null = null;
  private sphereSpinRaf: number | null = null;
  private spherePaintFrame = 0;
  private neighborMap = new Map<string, Set<string>>();
  private isDragging = false;
  private dragPending = false;
  private dragMoved = false;
  private dragPointerId: number | null = null;
  private dragAnchorX = 0;
  private dragAnchorY = 0;
  private dragStartRotX = IDLE_ROT_X;
  private dragStartRotY = IDLE_ROT_Y;
  private sphereInteractionBound = false;
  private popoverEl: HTMLElement | null = null;
  private docClickBound: ((event: MouseEvent) => void) | null = null;
  private flatFocusMorphFrom: string | null = null;
  private flatFocusMorphT = 1;

  constructor(section: HTMLElement, options?: { onBotsChange?: (bots: BubbleBot[]) => void }) {
    this.section = section;
    this.canvasHost = section.querySelector<HTMLElement>("[data-bubble-canvas]")!;
    this.legend = section.querySelector<HTMLElement>("[data-bubble-legend]")!;
    this.empty = section.querySelector<HTMLElement>("[data-bubble-empty]")!;
    this.viewToggle = section.querySelector<HTMLElement>("[data-bubble-view-toggle]");
    this.onBotsChange = options?.onBotsChange;
    this.bindViewToggle();
    this.syncViewToggleUi();
    this.bindSphereInteraction();
    this.bindDocDismiss();
  }

  observe(load: () => Promise<BubbleBot[]>): void {
    if (this.started) return;
    this.started = true;
    void this.refresh(load);
    this.pollTimer = window.setInterval(() => void this.refresh(load), BUBBLE_POLL_MS);
  }

  private bindViewToggle(): void {
    if (!this.viewToggle) return;
    this.viewToggle.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const mode = target.dataset.bubbleView;
      if (mode !== "flat" && mode !== "sphere") return;
      if (mode === this.layoutMode) return;
      this.layoutMode = mode;
      storeLayoutMode(mode);
      this.syncViewToggleUi();
      this.resetInteractionState();
      if (this.lastBots.length) void this.render(this.lastBots);
    });
  }

  private syncViewToggleUi(): void {
    if (!this.viewToggle) return;
    this.viewToggle.querySelectorAll<HTMLButtonElement>("[data-bubble-view]").forEach((btn) => {
      const active = btn.dataset.bubbleView === this.layoutMode;
      btn.classList.toggle("bubble-view-toggle__btn--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.canvasHost.classList.toggle("bubble-canvas--sphere", this.layoutMode === "sphere");
    this.canvasHost.classList.toggle("bubble-canvas--flat", this.layoutMode === "flat");
  }

  private updateLegend(bots: BubbleBot[]): void {
    const onlineCount = bots.filter((bot) => bot.online).length;
    const modeHint = this.layoutMode === "sphere" ? "立体关系网" : "平铺气泡";
    const interactHint =
      this.layoutMode === "sphere"
        ? "拖拽旋转 · 点击聚焦并高亮同套邻居 · 再次点击添加好友"
        : "点击聚焦 · 再次点击添加好友";
    this.legend.textContent = `${modeHint} · 上报公开共 ${bots.length} 只 · 在线 ${onlineCount} 只 · ${interactHint}`;
  }

  private resetInteractionState(): void {
    this.cancelAnimation();
    this.stopSphereAutoSpin();
    this.activeBotKey = null;
    this.popoverBotKey = null;
    this.endSphereDrag();
    this.hidePopover();
    this.focusBlend = 0;
    this.resetFlatFocusMorph();
    this.viewRotX = IDLE_ROT_X;
    this.viewRotY = IDLE_ROT_Y;
    this.canvasHost.classList.remove("bubble-canvas--focused", "bubble-canvas--dragging");
  }

  private resetFlatFocusMorph(): void {
    this.flatFocusMorphFrom = null;
    this.flatFocusMorphT = 1;
  }

  private bindDocDismiss(): void {
    if (this.docClickBound) return;
    this.docClickBound = (event: MouseEvent) => {
      if (!this.activeBotKey) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (this.popoverEl?.contains(target)) return;
      if (target instanceof Element && target.closest(".bubble-node")) return;
      if (target instanceof Element && target.closest("[data-bubble-view-toggle]")) return;
      void importD3().then((d3) => this.clearFocus(d3));
    };
    document.addEventListener("click", this.docClickBound);
  }

  private bindSphereInteraction(): void {
    if (this.sphereInteractionBound) return;
    this.sphereInteractionBound = true;
    this.canvasHost.addEventListener("pointerdown", this.onSpherePointerDown);
    this.canvasHost.addEventListener("pointermove", this.onSpherePointerMove);
    this.canvasHost.addEventListener("pointerup", this.onSpherePointerUp);
    this.canvasHost.addEventListener("pointercancel", this.onSpherePointerUp);
  }

  private unbindSphereInteraction(): void {
    if (!this.sphereInteractionBound) return;
    this.sphereInteractionBound = false;
    this.canvasHost.removeEventListener("pointerdown", this.onSpherePointerDown);
    this.canvasHost.removeEventListener("pointermove", this.onSpherePointerMove);
    this.canvasHost.removeEventListener("pointerup", this.onSpherePointerUp);
    this.canvasHost.removeEventListener("pointercancel", this.onSpherePointerUp);
  }

  private onSpherePointerDown = (event: PointerEvent): void => {
    if (this.layoutMode !== "sphere" || !this.scene) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.dragPending = true;
    this.isDragging = false;
    this.dragMoved = false;
    this.dragPointerId = event.pointerId;
    this.dragAnchorX = event.clientX;
    this.dragAnchorY = event.clientY;
    this.dragStartRotX = this.viewRotX;
    this.dragStartRotY = this.viewRotY;
  };

  private onSpherePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) return;
    const dx = event.clientX - this.dragAnchorX;
    const dy = event.clientY - this.dragAnchorY;

    if (this.dragPending && !this.isDragging) {
      if (Math.abs(dx) <= DRAG_MOVE_THRESHOLD_PX && Math.abs(dy) <= DRAG_MOVE_THRESHOLD_PX) return;
      this.dragPending = false;
      this.isDragging = true;
      this.dragMoved = true;
      this.canvasHost.classList.add("bubble-canvas--dragging");
      this.canvasHost.setPointerCapture(event.pointerId);
    }
    if (!this.isDragging) return;

    const sens = event.pointerType === "touch" ? DRAG_SENS_TOUCH : DRAG_SENS_MOUSE;
    this.viewRotY = this.dragStartRotY + dx * sens;
    this.viewRotX = this.dragStartRotX - dy * sens;
    this.paintSphereFrame();
    event.preventDefault();
  };

  private onSpherePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) return;
    const wasDragging = this.isDragging;
    this.dragPending = false;
    if (wasDragging) {
      this.endSphereDrag();
      window.setTimeout(() => {
        this.dragMoved = false;
      }, 100);
      return;
    }
    this.dragPointerId = null;
    this.handleSphereTap(event);
  };

  private handleSphereTap(event: PointerEvent): void {
    if (this.layoutMode !== "sphere" || !this.scene || !this.d3Ref || this.dragMoved) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const nodeEl = hit?.closest?.("g.bubble-node[data-bot-key]");
    if (!(nodeEl instanceof SVGGElement)) return;
    const botKey = nodeEl.getAttribute("data-bot-key");
    if (!botKey) return;
    const node = this.layoutNodes.find((entry) => entry.bot.bot_key === botKey);
    if (!node || !isBubbleClickable(node.bot)) return;
    void this.handleNodeClick(this.d3Ref, botKey, nodeEl, node.bot, this.scene.nodeSel);
  }

  private paintSphereFrame(): void {
    if (this.d3Ref) this.paintSphereScene(this.d3Ref);
  }

  private endSphereDrag(): void {
    if (this.dragPointerId != null && this.canvasHost.hasPointerCapture(this.dragPointerId)) {
      this.canvasHost.releasePointerCapture(this.dragPointerId);
    }
    this.isDragging = false;
    this.dragPending = false;
    this.dragPointerId = null;
    this.canvasHost.classList.remove("bubble-canvas--dragging");
  }

  private ensureSphereAutoSpin(): void {
    if (this.sphereSpinRaf != null) return;
    const tick = () => {
      if (this.layoutMode !== "sphere" || !this.scene) {
        this.sphereSpinRaf = null;
        return;
      }
      if (!this.activeBotKey && !this.isDragging && !this.dragPending && this.animFrame == null) {
        this.viewRotY += AUTO_SPIN_Y_PER_FRAME;
        this.paintSphereFrame();
      }
      this.sphereSpinRaf = requestAnimationFrame(tick);
    };
    this.sphereSpinRaf = requestAnimationFrame(tick);
  }

  private stopSphereAutoSpin(): void {
    if (this.sphereSpinRaf != null) {
      cancelAnimationFrame(this.sphereSpinRaf);
      this.sphereSpinRaf = null;
    }
  }

  private async refresh(load: () => Promise<BubbleBot[]>): Promise<void> {
    this.canvasHost.classList.add("bubble-canvas--loading");
    try {
      const bots = await load();
      await this.render(bots);
    } catch (err) {
      this.empty.hidden = false;
      this.empty.textContent = `气泡数据加载失败：${err instanceof Error ? err.message : String(err)}`;
      this.canvasHost.innerHTML = "";
      this.onBotsChange?.([]);
      this.hidePopover();
    } finally {
      this.canvasHost.classList.remove("bubble-canvas--loading");
    }
  }

  private async render(bots: BubbleBot[]): Promise<void> {
    const token = ++this.renderToken;
    const d3 = await importD3();
    if (token !== this.renderToken) return;
    this.canvasHost.querySelector(".bubble-loading-shimmer")?.remove();
    this.lastBots = bots;
    this.updateLegend(bots);

    if (!bots.length) {
      this.empty.hidden = false;
      this.empty.textContent =
        "暂无公开名册的牛牛。部署方可在 Pallas 控制台开启「社区名册公开」后出现在此（功能陆续接入）。";
      this.canvasHost.innerHTML = "";
      this.onBotsChange?.([]);
      this.resetInteractionState();
      return;
    }

    if (this.activeBotKey && !bots.some((bot) => bot.bot_key === this.activeBotKey)) {
      this.resetInteractionState();
    }
    if (this.popoverBotKey && this.popoverBotKey !== this.activeBotKey) {
      this.hidePopover();
      this.popoverBotKey = null;
    }

    this.empty.hidden = true;
    this.onBotsChange?.(bots);
    this.canvasHost.querySelector(".bubble-svg")?.remove();

    const width = this.canvasHost.clientWidth || 960;
    const isNarrow = width <= 560;
    const baseHeight = isNarrow ? Math.max(440, width * 0.95) : Math.max(540, Math.min(740, width * 0.62));
    this.lastViewport = { width, height: baseHeight };
    this.sphereRadius = Math.min(width, baseHeight) * (isNarrow ? 0.42 : 0.47);

    const nodes =
      this.layoutMode === "sphere"
        ? layoutSphereNodes(bots, this.sphereRadius, isNarrow)
        : layoutFlatNodes(d3, bots, width, baseHeight, isNarrow);
    const links = buildRosterLinks(nodes, this.layoutMode);
    this.neighborMap = buildNeighborMap(links);
    this.layoutNodes = nodes;

    const height =
      this.layoutMode === "flat"
        ? Math.max(baseHeight, (d3.max(nodes, (node) => node.y + node.r) ?? baseHeight) + 28)
        : baseHeight;

    const svg = d3
      .select(this.canvasHost)
      .append("svg")
      .attr("class", "bubble-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", height)
      .attr("role", "img")
      .attr(
        "aria-label",
        this.layoutMode === "sphere" ? "社区牛牛立体关系网" : "社区牛牛平铺气泡墙",
      );

    const defs = svg.append("defs");
    const clipPrefix = `bubble-clip-${token}`;
    const clipIds: string[] = [];
    const clipCircleSels: SceneRefs["clipCircleSels"] = [];

    nodes.forEach((node, index) => {
      const clipId = `${clipPrefix}-${index}`;
      clipIds.push(clipId);
      clipCircleSels.push(
        defs
          .append("clipPath")
          .attr("id", clipId)
          .append("circle")
          .attr("r", Math.max(0, node.r - 4)),
      );
    });

    const stage = svg.append("g").attr("class", "bubble-stage");

    let meshLayerSel: SceneRefs["meshLayerSel"] = null;
    let meshSel: SceneRefs["meshSel"] = null;
    if (this.layoutMode === "sphere") {
      meshLayerSel = stage.append("g").attr("class", "bubble-mesh");
      const meshCurves = buildSphereMeshCurves(this.sphereRadius);
      meshSel = meshLayerSel
        .selectAll<SVGPathElement, MeshCurve>("path.bubble-mesh__curve")
        .data(meshCurves, (curve) => curve.id)
        .join("path")
        .attr("class", "bubble-mesh__curve");
    }

    const linkLayer = stage.append("g").attr("class", "bubble-links");
    const linkSel = linkLayer
      .selectAll<SVGLineElement, SimLink>("line.bubble-link")
      .data(links)
      .join("line")
      .attr("class", (link) => {
        const online =
          link.source.bot.online && link.target.bot.online ? " bubble-link--online" : "";
        return `bubble-link${online}`;
      });

    const nodeSel = stage
      .selectAll<SVGGElement, LayoutNode>("g.bubble-node")
      .data(nodes)
      .join("g")
      .attr("class", (d) => nodeClassName(d, this.activeBotKey, this.focusBlend, false))
      .attr("data-bot-key", (d) => d.bot.bot_key)
      .attr("data-clip-index", (_, i) => String(i))
      .style("--bubble-delay", (d) => {
        if (this.layoutMode !== "flat") return "0ms";
        return `${Math.round(hashUnit(d.bot.bot_key) * 2800)}ms`;
      })
      .style("--bubble-pulse-dur", (d) =>
        this.layoutMode === "flat"
          ? `${(3.2 + hashUnit(`${d.bot.bot_key}:pulse`) * 1.6).toFixed(2)}s`
          : null,
      )
      .attr("role", (d) => (isBubbleClickable(d.bot) ? "button" : null))
      .attr("tabindex", (d) => (isBubbleClickable(d.bot) ? 0 : null))
      .attr("aria-expanded", (d) => (d.bot.bot_key === this.popoverBotKey ? "true" : "false"))
      .on("click", (event, d) => {
        event.stopPropagation();
        if (this.layoutMode === "sphere") return;
        if (!isBubbleClickable(d.bot) || this.dragMoved) return;
        void this.handleNodeClick(d3, d.bot.bot_key, event.currentTarget as SVGGElement, d.bot, nodeSel);
      })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!isBubbleClickable(d.bot) || this.dragMoved) return;
        event.preventDefault();
        event.stopPropagation();
        void this.handleNodeClick(d3, d.bot.bot_key, event.currentTarget as SVGGElement, d.bot, nodeSel);
      });

    appendNodeBodies(d3, nodeSel, clipPrefix, this.layoutMode === "flat");

    nodeSel.append("title").text((d) => {
      const bot = d.bot;
      const tier = activityTier(bot.message_weight);
      const hint =
        this.layoutMode === "sphere"
          ? "点击聚焦并高亮同套邻居 · 再次点击添加好友"
          : "点击聚焦 · 再次点击添加好友";
      return `${bot.nickname}\n${bot.online ? "在线" : "离线"} · 活跃度 ${tier}\n${hint}`;
    });

    this.d3Ref = d3;
    this.spherePaintFrame = 0;
    this.scene = {
      stageSel: stage,
      meshLayerSel,
      meshSel,
      linkLayerSel: linkLayer,
      nodeSel,
      linkSel,
      clipIds,
      clipCircleSels,
    };
    this.canvasHost.classList.toggle("bubble-canvas--focused", Boolean(this.activeBotKey));

    if (this.activeBotKey && this.layoutMode === "sphere") {
      this.focusBlend = 1;
    } else if (!this.activeBotKey && this.focusBlend < 0.01) {
      this.viewRotX = IDLE_ROT_X;
      this.viewRotY = IDLE_ROT_Y;
      this.focusBlend = this.activeBotKey ? 1 : 0;
    } else if (this.activeBotKey) {
      this.focusBlend = 1;
    }

    this.paintFrame(d3);

    if (this.popoverBotKey) {
      const activeBot = bots.find((bot) => bot.bot_key === this.popoverBotKey);
      const activeNode = this.canvasHost.querySelector<SVGGElement>(
        `g.bubble-node[data-bot-key="${CSS.escape(this.popoverBotKey)}"]`,
      );
      if (activeBot && activeNode) {
        this.showPopover(activeNode, activeBot);
      }
    }

    if (token !== this.renderToken) return;

    if (this.layoutMode === "sphere") {
      this.ensureSphereAutoSpin();
    } else {
      this.stopSphereAutoSpin();
    }

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.lastBots.length) void this.render(this.lastBots);
      });
      this.resizeObserver.observe(this.canvasHost);
    }
  }

  private async handleNodeClick(
    d3: D3Module,
    botKey: string,
    nodeEl: SVGGElement,
    bot: BubbleBot,
    nodeSelection: NodeSelection,
  ): Promise<void> {
    if (this.dragMoved) return;
    if (this.activeBotKey === botKey && this.popoverBotKey === botKey) {
      this.hidePopover();
      this.popoverBotKey = null;
      nodeSelection.attr("aria-expanded", "false");
      return;
    }

    if (this.activeBotKey === botKey) {
      this.popoverBotKey = botKey;
      nodeSelection.attr("aria-expanded", (node) => (node.bot.bot_key === botKey ? "true" : "false"));
      this.showPopover(nodeEl, bot);
      return;
    }

    this.hidePopover();
    this.popoverBotKey = null;
    const previousKey = this.activeBotKey;
    this.activeBotKey = botKey;
    nodeSelection
      .classed("bubble-node--active", (node) => node.bot.bot_key === botKey)
      .attr("aria-expanded", "false");
    this.canvasHost.classList.add("bubble-canvas--focused");

    if (this.layoutMode === "sphere") {
      const focusNode = this.layoutNodes.find((node) => node.bot.bot_key === botKey);
      if (!focusNode) return;
      const angles = focusRotationForNode(focusNode, this.viewRotY);
      await this.animateSphereView(d3, { rotX: angles.rotX, rotY: angles.rotY, focusBlend: 1 });
      return;
    }

    if (previousKey && previousKey !== botKey && this.focusBlend > 0.01) {
      await this.animateFlatFocusSwitch(d3, previousKey, botKey);
      return;
    }

    await this.animateFocusBlend(d3, 1);
  }

  private async clearFocus(d3: D3Module): Promise<void> {
    this.activeBotKey = null;
    this.popoverBotKey = null;
    this.hidePopover();
    this.scene?.nodeSel.classed("bubble-node--active", false).attr("aria-expanded", "false");
    this.canvasHost.classList.remove("bubble-canvas--focused");

    if (this.layoutMode === "sphere") {
      await this.animateSphereView(d3, { rotX: IDLE_ROT_X, rotY: IDLE_ROT_Y, focusBlend: 0 });
      return;
    }
    await this.animateFocusBlend(d3, 0);
  }

  private cancelAnimation(): void {
    if (this.animFrame != null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  private animateFocusBlend(d3: D3Module, target: number): Promise<void> {
    this.cancelAnimation();
    this.resetFlatFocusMorph();
    this.canvasHost.classList.add("bubble-canvas--animating");
    const from = this.focusBlend;
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        const raw = Math.min(1, (now - start) / FOCUS_ANIM_MS);
        const t = easeCubicInOut(raw);
        this.focusBlend = from + (target - from) * t;
        this.paintFrame(d3);
        if (raw < 1) {
          this.animFrame = requestAnimationFrame(step);
          return;
        }
        this.animFrame = null;
        this.canvasHost.classList.remove("bubble-canvas--animating");
        resolve();
      };
      this.animFrame = requestAnimationFrame(step);
    });
  }

  private animateFlatFocusSwitch(d3: D3Module, fromKey: string, toKey: string): Promise<void> {
    this.cancelAnimation();
    this.canvasHost.classList.add("bubble-canvas--animating");
    this.flatFocusMorphFrom = fromKey;
    this.flatFocusMorphT = 0;
    this.focusBlend = 1;
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        const raw = Math.min(1, (now - start) / FOCUS_ANIM_MS);
        const t = easeCubicInOut(raw);
        this.flatFocusMorphT = t;
        this.paintFrame(d3);
        if (raw < 1) {
          this.animFrame = requestAnimationFrame(step);
          return;
        }
        this.flatFocusMorphFrom = null;
        this.flatFocusMorphT = 1;
        this.focusBlend = 1;
        this.animFrame = null;
        this.canvasHost.classList.remove("bubble-canvas--animating");
        this.paintFrame(d3);
        resolve();
      };
      this.animFrame = requestAnimationFrame(step);
    });
  }

  private animateSphereView(
    d3: D3Module,
    target: { rotX: number; rotY: number; focusBlend: number },
  ): Promise<void> {
    this.cancelAnimation();
    this.canvasHost.classList.add("bubble-canvas--animating");
    const from = {
      rotX: this.viewRotX,
      rotY: this.viewRotY,
      focusBlend: this.focusBlend,
    };
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        const raw = Math.min(1, (now - start) / FOCUS_ANIM_MS);
        const t = easeCubicInOut(raw);
        this.viewRotX = lerpAngle(from.rotX, target.rotX, t);
        this.viewRotY = lerpAngle(from.rotY, target.rotY, t);
        this.focusBlend = from.focusBlend + (target.focusBlend - from.focusBlend) * t;
        this.paintFrame(d3);
        if (raw < 1) {
          this.animFrame = requestAnimationFrame(step);
          return;
        }
        this.viewRotX = target.rotX;
        this.viewRotY = target.rotY;
        this.focusBlend = target.focusBlend;
        this.paintFrame(d3);
        this.animFrame = null;
        this.canvasHost.classList.remove("bubble-canvas--animating");
        resolve();
      };
      this.animFrame = requestAnimationFrame(step);
    });
  }

  private paintFrame(d3: D3Module): void {
    if (!this.scene) return;
    if (this.layoutMode === "sphere") {
      this.paintSphereScene(d3);
      return;
    }
    this.paintFlatScene(d3);
  }

  private paintFlatScene(d3: D3Module): void {
    if (!this.scene) return;
    const { width, height } = this.lastViewport;
    const cx = width / 2;
    const cy = height / 2;
    const focusKey = this.activeBotKey;
    const medianR = d3.median(this.layoutNodes, (node) => node.r) ?? 30;
    const focusNode = focusKey ? this.layoutNodes.find((node) => node.id === focusKey) : undefined;
    const morphFromKey = this.flatFocusMorphFrom;
    const morphFromNode =
      morphFromKey && morphFromKey !== focusKey
        ? this.layoutNodes.find((node) => node.id === morphFromKey)
        : undefined;
    const morphing = Boolean(focusNode && morphFromNode && this.flatFocusMorphT < 1);
    const focusing = Boolean(focusNode && (this.focusBlend > 0 || morphing));
    const linkBlend = morphing ? Math.max(this.focusBlend, this.flatFocusMorphT) : this.focusBlend;
    const showFlatLinks = focusing && linkBlend > 0.04;
    const focusNeighbors = focusKey ? this.neighborMap.get(focusKey) : undefined;
    const highlightLinks = Boolean(focusKey && focusNeighbors && linkBlend > 0.3);

    this.scene.linkLayerSel.style("display", showFlatLinks ? "" : "none");
    this.scene.meshLayerSel?.style("display", "none");

    const nodeVisual = (node: LayoutNode): FlatNodePaint =>
      resolveFlatNodeVisual(
        node,
        focusKey,
        focusNode,
        this.focusBlend,
        medianR,
        morphFromKey,
        morphFromNode,
        focusNode,
        this.flatFocusMorphT,
      );

    this.scene.nodeSel
      .attr("transform", (node) => {
        const paint = nodeVisual(node);
        return `translate(${paint.x},${paint.y})`;
      })
      .style("opacity", (node) => nodeVisual(node).opacity)
      .attr("class", (node) => {
        const classFocusKey =
          morphing && this.flatFocusMorphT < 0.5 ? morphFromKey : focusKey;
        const classFocusBlend = morphing ? 1 : this.focusBlend;
        return nodeClassName(node, classFocusKey ?? null, classFocusBlend, false);
      })
      .each((node, index, groups) => {
        const group = d3.select(groups[index]);
        updateNodeGraphics(
          d3,
          group,
          node,
          nodeVisual(node).bodyScale,
          this.scene!.clipCircleSels,
          clipIndexFromGroup(group),
        );
      });

    if (showFlatLinks) {
      this.scene.linkSel
        .attr("class", (link) => {
          const online =
            link.source.bot.online && link.target.bot.online ? " bubble-link--online" : "";
          const connected = focusKey && (link.source.id === focusKey || link.target.id === focusKey);
          const highlight = highlightLinks && connected ? " bubble-link--highlight" : "";
          return `bubble-link${online}${highlight}`;
        })
        .attr("x1", (link) => {
          const sourcePaint = nodeVisual(link.source);
          const targetPaint = nodeVisual(link.target);
          return flatLinkEndpoint(link.source, link.target, sourcePaint, targetPaint).x1;
        })
        .attr("y1", (link) => {
          const sourcePaint = nodeVisual(link.source);
          const targetPaint = nodeVisual(link.target);
          return flatLinkEndpoint(link.source, link.target, sourcePaint, targetPaint).y1;
        })
        .attr("x2", (link) => {
          const sourcePaint = nodeVisual(link.source);
          const targetPaint = nodeVisual(link.target);
          return flatLinkEndpoint(link.source, link.target, sourcePaint, targetPaint).x2;
        })
        .attr("y2", (link) => {
          const sourcePaint = nodeVisual(link.source);
          const targetPaint = nodeVisual(link.target);
          return flatLinkEndpoint(link.source, link.target, sourcePaint, targetPaint).y2;
        })
        .style("stroke-opacity", (link) => {
          const connected = focusKey && (link.source.id === focusKey || link.target.id === focusKey);
          if (highlightLinks && connected) {
            return Math.min(0.72, 0.22 + 0.46 * linkBlend);
          }
          return 0.08 + 0.14 * linkBlend;
        })
        .attr("stroke-width", (link) => {
          const connected = focusKey && (link.source.id === focusKey || link.target.id === focusKey);
          return connected && highlightLinks ? 1.15 : 0.85;
        });
    }

    if (morphing && morphFromNode && focusNode) {
      const fromStage = flatStageMetrics(morphFromNode, 1, cx, cy);
      const toStage = flatStageMetrics(focusNode, 1, cx, cy);
      const t = this.flatFocusMorphT;
      this.scene.stageSel.attr(
        "transform",
        flatStageTransform({
          cx,
          cy,
          panX: fromStage.panX + (toStage.panX - fromStage.panX) * t,
          panY: fromStage.panY + (toStage.panY - fromStage.panY) * t,
          zoom: fromStage.zoom + (toStage.zoom - fromStage.zoom) * t,
        }),
      );
    } else if (focusing && focusNode) {
      this.scene.stageSel.attr("transform", flatStageTransform(flatStageMetrics(focusNode, this.focusBlend, cx, cy)));
    } else {
      this.scene.stageSel.attr("transform", null);
    }
  }

  private paintSphereScene(d3: D3Module): void {
    if (!this.scene) return;

    const { width, height } = this.lastViewport;
    const cx = width / 2;
    const cy = height / 2;
    const focal = Math.max(width, height) * 2.45;
    const focusKey = this.activeBotKey;
    const focusNeighbors = focusKey ? this.neighborMap.get(focusKey) : undefined;
    const showNeighbors = Boolean(focusKey && focusNeighbors && this.focusBlend > 0.35);
    const projected = new Map<string, Projected>();
    const spinOnly = !this.isDragging && !this.activeBotKey && this.animFrame == null;
    const updateMesh = Boolean(this.scene.meshSel) && (!spinOnly || this.spherePaintFrame++ % 2 === 0);

    this.scene.linkLayerSel.style("display", null);
    if (this.scene.meshLayerSel) {
      this.scene.meshLayerSel.style("display", null);
    }

    const projectWorld = (point: Vec3): Projected => {
      const rotated = rotateY(rotateX(point, this.viewRotX), this.viewRotY);
      return project(rotated, focal, cx, cy, this.sphereRadius);
    };

    if (updateMesh && this.scene.meshSel) {
      const sphereR = this.sphereRadius;
      this.scene.meshSel.each((curve, index, groups) => {
        const projectedPts = curve.points.map((point) => projectWorld(point));
        const avgZ = projectedPts.reduce((sum, point) => sum + point.z, 0) / projectedPts.length;
        const d = projectedPts
          .map((point, i) => `${i === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" ");
        d3.select(groups[index]).attr("d", d).style("opacity", meshCurveOpacity(avgZ, sphereR));
      });
    }

    this.layoutNodes.forEach((node) => {
      const point = projectWorld({ x: node.wx, y: node.wy, z: node.wz });
      projected.set(node.id, point);
    });

    const nodeData = this.layoutNodes.map((node) => {
      const point = projected.get(node.id)!;
      return { node, point, bodyScale: point.scale };
    });
    const nodeDataById = new Map(nodeData.map((item) => [item.node.id, item]));

    nodeData.sort((a, b) => a.point.z - b.point.z);

    this.scene.nodeSel
      .data(
        nodeData.map((item) => item.node),
        (node) => node.id,
      )
      .order()
      .attr("transform", (node) => {
        const point = projected.get(node.id)!;
        return `translate(${point.x.toFixed(1)},${point.y.toFixed(1)})`;
      })
      .style("opacity", (node) => {
        const point = projected.get(node.id)!;
        if (focusKey === node.id && this.focusBlend > 0.35) {
          return Math.max(point.opacity, 0.94);
        }
        if (showNeighbors && focusNeighbors) {
          if (focusNeighbors.has(node.id)) return Math.min(1, point.opacity * 1.04);
          return point.opacity * 0.26;
        }
        return point.opacity;
      })
      .each((node, index, groups) => {
        const item = nodeDataById.get(node.id);
        if (!item) return;
        const group = d3.select(groups[index]);
        const point = item.point;
        const nextClass = nodeClassName(
          node,
          focusKey,
          this.focusBlend,
          true,
          point.depthClass,
          showNeighbors ? focusKey : null,
          showNeighbors ? focusNeighbors : undefined,
        );
        const currentClass = groups[index].getAttribute("class") ?? "";
        if (currentClass !== nextClass) {
          group.attr("class", nextClass);
        }
        updateNodeGraphics(
          d3,
          group,
          node,
          item.bodyScale,
          this.scene!.clipCircleSels,
          clipIndexFromGroup(group),
        );
      });

    this.scene.linkSel
      .attr("class", (link) => {
        const online =
          link.source.bot.online && link.target.bot.online ? " bubble-link--online" : "";
        const highlight =
          showNeighbors && (link.source.id === focusKey || link.target.id === focusKey)
            ? " bubble-link--highlight"
            : "";
        return `bubble-link${online}${highlight}`;
      })
      .attr("x1", (link) => projected.get(link.source.id)!.x)
      .attr("y1", (link) => projected.get(link.source.id)!.y)
      .attr("x2", (link) => projected.get(link.target.id)!.x)
      .attr("y2", (link) => projected.get(link.target.id)!.y)
      .style("stroke-opacity", (link) => {
        const source = projected.get(link.source.id)!;
        const target = projected.get(link.target.id)!;
        const depth = (source.opacity + target.opacity) / 2;
        if (showNeighbors) {
          if (link.source.id === focusKey || link.target.id === focusKey) {
            return Math.min(0.78, 0.34 + 0.38 * depth);
          }
          return 0.035;
        }
        const base = link.source.bot.online && link.target.bot.online ? 0.16 : 0.1;
        return base + 0.22 * depth + 0.08 * this.focusBlend;
      })
      .attr("stroke-width", (link) => {
        const source = projected.get(link.source.id)!;
        const target = projected.get(link.target.id)!;
        return 0.55 + 0.55 * ((source.opacity + target.opacity) / 2);
      });

    // 旋转绕世界原点（球心），勿再做 stage 平移，否则球心会偏离画面中心
    this.scene.stageSel.attr("transform", null);
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
    if (bot.qq) {
      const actionRow = document.createElement("div");
      actionRow.className = "bubble-popover__actions";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "bubble-popover__add";
      addBtn.textContent = "添加好友";
      addBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void openQQProfile(bot.qq!);
      });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "bubble-popover__copy";
      copyBtn.textContent = "复制 QQ";
      copyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void copyQQNumber(bot.qq!);
      });

      actionRow.append(addBtn, copyBtn);
      actions.push(actionRow);
    }

    popover.append(...actions);
    popover.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(popover);
    this.popoverEl = popover;
    requestAnimationFrame(() => this.positionPopover(nodeEl, popover));
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
    this.cancelAnimation();
    this.stopSphereAutoSpin();
    this.endSphereDrag();
    this.unbindSphereInteraction();
    if (this.pollTimer != null) window.clearInterval(this.pollTimer);
    this.resizeObserver?.disconnect();
    this.hidePopover();
    if (this.docClickBound) {
      document.removeEventListener("click", this.docClickBound);
      this.docClickBound = null;
    }
  }
}

type FlatNodePaint = {
  x: number;
  y: number;
  opacity: number;
  bodyScale: number;
};

type FlatStageMetrics = {
  cx: number;
  cy: number;
  panX: number;
  panY: number;
  zoom: number;
};

function flatNodePaint(
  node: LayoutNode,
  focusNode: LayoutNode,
  focusKey: string,
  focusBlend: number,
  medianR: number,
): FlatNodePaint {
  if (focusBlend <= 0) {
    return { x: node.x, y: node.y, opacity: 1, bodyScale: 1 };
  }
  if (node.id === focusKey) {
    const boost = node.r < medianR ? 1.62 : 1.34;
    return {
      x: node.x,
      y: node.y,
      opacity: 1,
      bodyScale: 1 + (boost - 1) * focusBlend,
    };
  }
  const dx = node.x - focusNode.x;
  const dy = node.y - focusNode.y;
  const dist = Math.hypot(dx, dy) || 1;
  const pushBase = Math.max(36, node.r * 1.35 + 24);
  const push = pushBase * focusBlend;
  const fade = node.r < medianR * 0.92 ? 0.42 : 0.58;
  return {
    x: node.x + (dx / dist) * push,
    y: node.y + (dy / dist) * push,
    opacity: 1 - (1 - fade) * focusBlend,
    bodyScale: node.r < medianR * 0.92 ? 1 - 0.16 * focusBlend : 1 - 0.08 * focusBlend,
  };
}

function lerpFlatNodePaint(from: FlatNodePaint, to: FlatNodePaint, t: number): FlatNodePaint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    opacity: from.opacity + (to.opacity - from.opacity) * t,
    bodyScale: from.bodyScale + (to.bodyScale - from.bodyScale) * t,
  };
}

function flatStageMetrics(
  focusNode: LayoutNode,
  focusBlend: number,
  cx: number,
  cy: number,
): FlatStageMetrics {
  return {
    cx,
    cy,
    panX: (cx - focusNode.x) * focusBlend,
    panY: (cy - focusNode.y) * focusBlend,
    zoom: 1 + 0.18 * focusBlend,
  };
}

function flatStageTransform(metrics: FlatStageMetrics): string {
  const { cx, cy, panX, panY, zoom } = metrics;
  return `translate(${cx},${cy}) scale(${zoom}) translate(${-cx + panX},${-cy + panY})`;
}

function resolveFlatNodeVisual(
  node: LayoutNode,
  focusKey: string | null,
  focusNode: LayoutNode | undefined,
  focusBlend: number,
  medianR: number,
  morphFromKey: string | null,
  morphFromNode: LayoutNode | undefined,
  morphToNode: LayoutNode | undefined,
  morphT: number,
): FlatNodePaint {
  if (morphFromKey && morphFromNode && morphToNode && focusKey && morphFromKey !== focusKey && morphT < 1) {
    const from = flatNodePaint(node, morphFromNode, morphFromKey, 1, medianR);
    const to = flatNodePaint(node, morphToNode, focusKey, 1, medianR);
    return lerpFlatNodePaint(from, to, morphT);
  }
  if (focusNode && focusKey && focusBlend > 0) {
    return flatNodePaint(node, focusNode, focusKey, focusBlend, medianR);
  }
  return { x: node.x, y: node.y, opacity: 1, bodyScale: 1 };
}

function flatLinkEndpoint(
  source: LayoutNode,
  target: LayoutNode,
  sourcePaint: FlatNodePaint,
  targetPaint: FlatNodePaint,
): { x1: number; y1: number; x2: number; y2: number } {
  const fromR = Math.max(4, source.r * sourcePaint.bodyScale - 2);
  const toR = Math.max(4, target.r * targetPaint.bodyScale - 2);
  const dx = targetPaint.x - sourcePaint.x;
  const dy = targetPaint.y - sourcePaint.y;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    x1: sourcePaint.x + (dx / dist) * fromR,
    y1: sourcePaint.y + (dy / dist) * fromR,
    x2: targetPaint.x - (dx / dist) * toR,
    y2: targetPaint.y - (dy / dist) * toR,
  };
}

function flatLayoutDistance(a: LayoutNode, b: LayoutNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nodeClassName(
  node: LayoutNode,
  focusKey: string | null,
  focusBlend: number,
  sphere: boolean,
  depthClass?: Projected["depthClass"],
  neighborKey?: string | null,
  neighborSet?: Set<string>,
): string {
  const online = node.bot.online ? " bubble-node--online" : " bubble-node--offline";
  const clickable = isBubbleClickable(node.bot) ? " bubble-node--clickable" : "";
  const active = node.bot.bot_key === focusKey ? " bubble-node--active" : "";
  const primary = focusKey === node.id && focusBlend > 0.2 ? " bubble-node--focus-primary" : "";
  const depth = sphere && depthClass ? ` bubble-node--depth-${depthClass}` : "";
  const neighborLinked =
    neighborKey && neighborKey !== node.id && neighborSet?.has(node.id)
      ? " bubble-node--hover-neighbor"
      : "";
  return `bubble-node${depth}${online}${clickable}${active}${primary}${neighborLinked}`;
}

function buildNeighborMap(links: SimLink[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  links.forEach((link) => {
    touch(link.source.id, link.target.id);
    touch(link.target.id, link.source.id);
  });
  return map;
}

function appendNodeBodies(
  d3: D3Module,
  nodeSel: NodeSelection,
  clipPrefix: string,
  withPulse: boolean,
): void {
  const body = nodeSel.append("g").attr("class", "bubble-node__body");

  if (withPulse) {
    body
      .filter((d) => d.bot.online === true)
      .append("circle")
      .attr("class", "bubble-node__pulse");
  }

  body.append("circle").attr("class", "bubble-node__halo");

  const avatarInset = 4;
  body.each(function (this: SVGGElement, d, i) {
    const g = d3.select(this);
    const bot = d.bot;
    const r = d.r - avatarInset;
    if (bot.avatar_url) {
      g.append("circle")
        .attr("class", "bubble-node__avatar-bg")
        .attr("r", r)
        .attr("fill", "var(--bubble-avatar-fill, #1a2433)");
      g.append("image")
        .attr("class", "bubble-node__avatar")
        .attr("href", bot.avatar_url)
        .attr("preserveAspectRatio", "xMidYMid slice")
        .attr("width", Math.max(0, r * 2))
        .attr("height", Math.max(0, r * 2))
        .attr("x", -r)
        .attr("y", -r)
        .attr("clip-path", `url(#${clipPrefix}-${i})`);
      return;
    }
    const label = (bot.nickname || "?").trim().slice(0, 1) || "?";
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
}

function clipIndexFromGroup(
  group: import("d3").Selection<SVGGElement, unknown, null, undefined>,
): number {
  return Number(group.attr("data-clip-index"));
}

function updateNodeGraphics(
  d3: D3Module,
  group: import("d3").Selection<SVGGElement, unknown, null, undefined>,
  node: LayoutNode,
  bodyScale: number,
  clipCircleSels: import("d3").Selection<SVGCircleElement, unknown, null, undefined>[],
  clipIndex: number,
): void {
  const displayR = node.r * bodyScale;
  const avatarR = Math.max(0, displayR - 4);

  group.select(".bubble-node__body").attr("transform", `scale(${bodyScale})`);
  group.select(".bubble-node__pulse").attr("r", node.r + 2);
  group.select(".bubble-node__halo").attr("r", node.r);

  const clipCircle = clipCircleSels[clipIndex];
  if (clipCircle && !clipCircle.empty()) {
    clipCircle.attr("r", Math.max(0, avatarR));
  }

  const avatar = group.select<SVGImageElement>(".bubble-node__avatar");
  if (!avatar.empty()) {
    avatar.attr("width", avatarR * 2).attr("height", avatarR * 2).attr("x", -avatarR).attr("y", -avatarR);
  }
  const avatarBg = group.select(".bubble-node__avatar-bg");
  if (!avatarBg.empty()) {
    avatarBg.attr("r", avatarR);
  }
  const fallback = group.select(".bubble-node__avatar-fallback");
  if (!fallback.empty()) {
    fallback.attr("r", avatarR);
    group.select(".bubble-node__avatar-fallback-text").attr("font-size", Math.max(12, avatarR * 0.9));
  }
}

function layoutFlatNodes(
  d3: D3Module,
  bots: BubbleBot[],
  width: number,
  baseHeight: number,
  isNarrow: boolean,
): LayoutNode[] {
  type PackDatum = { bot: BubbleBot; value: number; children?: PackDatum[] };
  const packPad = isNarrow ? 10 : 14;
  const rootData: PackDatum = {
    bot: bots[0],
    value: 0,
    children: bots.map((bot) => ({
      bot,
      value: Math.max(1, Math.sqrt(bot.message_weight || 0) + 8),
    })),
  };

  const pack = d3
    .pack<PackDatum>()
    .size([width - packPad * 2, baseHeight - PACK_PAD_RESERVE - packPad * 2])
    .padding(isNarrow ? 6 : 10);
  const root = pack(d3.hierarchy(rootData).sum((d) => d.value));
  const leaves = root.leaves() as Array<import("d3").HierarchyCircularNode<PackDatum>>;

  return leaves.map((leaf) => ({
    id: leaf.data.bot.bot_key,
    bot: leaf.data.bot,
    r: leaf.r,
    x: leaf.x + packPad,
    y: leaf.y + packPad,
    wx: 0,
    wy: 0,
    wz: 0,
  }));
}

function layoutSphereNodes(bots: BubbleBot[], sphereRadius: number, isNarrow: boolean): LayoutNode[] {
  return bots.map((bot, index) => {
    const pos = spherePosition(index, bots.length, sphereRadius, bot.bot_key);
    return {
      id: bot.bot_key,
      bot,
      r: sphereNodeRadius(bot, isNarrow),
      x: 0,
      y: 0,
      wx: pos.x,
      wy: pos.y,
      wz: pos.z,
    };
  });
}

function sphereNodeRadius(bot: BubbleBot, isNarrow: boolean): number {
  return nodeRadius(bot, isNarrow) * (isNarrow ? 0.84 : 0.86);
}

function nodeRadius(bot: BubbleBot, isNarrow: boolean): number {
  const weight = Math.sqrt(bot.message_weight || 0) + 8;
  const minR = isNarrow ? 18 : 22;
  const maxR = isNarrow ? 52 : 68;
  return Math.min(maxR, Math.max(minR, minR + weight * 0.75));
}

function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function spherePosition(index: number, total: number, radius: number, seed: string): Vec3 {
  const offset = 2 / total;
  const inc = Math.PI * (3 - Math.sqrt(5));
  const jitter = (hashUnit(seed) - 0.5) * 0.03;
  const y = (index * offset - 1) + offset / 2 + jitter;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = index * inc + jitter * 0.35;
  const surface = radius * 1.03;
  return {
    x: Math.cos(phi) * ring * surface,
    y: y * surface,
    z: Math.sin(phi) * ring * surface,
  };
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function project(v: Vec3, focal: number, cx: number, cy: number, sphereRadius: number): Projected {
  const depth = Math.max(focal * 0.12, focal - v.z);
  const layoutScale = focal / depth;
  const normalized = Math.min(1, Math.max(0, (v.z / sphereRadius + 1) / 2));
  const bodyScale = 0.84 + 0.2 * normalized;
  const opacity = 0.12 + 0.88 * normalized ** 1.75;
  let depthClass: Projected["depthClass"] = "mid";
  if (normalized >= 0.66) depthClass = "near";
  else if (normalized <= 0.42) depthClass = "far";
  return {
    x: cx + v.x * layoutScale,
    y: cy + v.y * layoutScale,
    z: v.z,
    scale: bodyScale,
    opacity,
    depthClass,
  };
}

function focusRotationForNode(node: LayoutNode, viewRotY = 0): { rotX: number; rotY: number } {
  const { wx, wy, wz } = node;
  const rotX = Math.hypot(wy, wz) > 1e-6 ? Math.atan2(wy, wz) : 0;
  const sinX = Math.sin(rotX);
  const cosX = Math.cos(rotX);
  const wx1 = wx;
  const wz1 = wy * sinX + wz * cosX;
  const baseRotY =
    Math.abs(wx1) > 1e-6 || Math.abs(wz1) > 1e-6 ? Math.atan2(-wx1, wz1) : viewRotY;
  return {
    rotY: nearestAngle(viewRotY, baseRotY),
    rotX,
  };
}

function nearestAngle(reference: number, angle: number): number {
  let result = angle;
  while (result - reference > Math.PI) result -= Math.PI * 2;
  while (result - reference < -Math.PI) result += Math.PI * 2;
  return result;
}

function lerpAngle(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

function easeCubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function buildSphereMeshCurves(sphereRadius: number): MeshCurve[] {
  const curves: MeshCurve[] = [];
  const segments = 40;
  const latBands = 4;
  const lonBands = 6;

  for (let band = 1; band < latBands; band++) {
    const lat = -Math.PI / 2 + (band / latBands) * Math.PI;
    const cosLat = Math.cos(lat);
    const y = sphereRadius * Math.sin(lat);
    const ring = sphereRadius * cosLat;
    const points: Vec3[] = [];
    for (let step = 0; step <= segments; step++) {
      const lon = (step / segments) * Math.PI * 2;
      points.push({ x: ring * Math.sin(lon), y, z: ring * Math.cos(lon) });
    }
    curves.push({ id: `lat-${band}`, points });
  }

  for (let band = 0; band < lonBands; band++) {
    const lon = (band / lonBands) * Math.PI * 2;
    const points: Vec3[] = [];
    for (let step = 0; step <= segments; step++) {
      const lat = -Math.PI / 2 + (step / segments) * Math.PI;
      const cosLat = Math.cos(lat);
      points.push({
        x: sphereRadius * cosLat * Math.sin(lon),
        y: sphereRadius * Math.sin(lat),
        z: sphereRadius * cosLat * Math.cos(lon),
      });
    }
    curves.push({ id: `lon-${band}`, points });
  }

  return curves;
}

function meshCurveOpacity(avgZ: number, sphereRadius: number): number {
  const normalized = Math.min(1, Math.max(0, (avgZ / sphereRadius + 1) / 2));
  return 0.08 + 0.28 * normalized ** 1.4;
}

function sphereAngularDistance(a: LayoutNode, b: LayoutNode): number {
  const magA = Math.hypot(a.wx, a.wy, a.wz);
  const magB = Math.hypot(b.wx, b.wy, b.wz);
  if (magA < 1 || magB < 1) return Math.PI;
  const dot = (a.wx * b.wx + a.wy * b.wy + a.wz * b.wz) / (magA * magB);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

function buildRosterLinks(nodes: LayoutNode[], mode: LayoutMode): SimLink[] {
  const distance = mode === "sphere" ? sphereAngularDistance : flatLayoutDistance;
  const links: SimLink[] = [];
  const seen = new Set<string>();

  const add = (source: LayoutNode, target: LayoutNode) => {
    if (source === target) return;
    const key = source.id < target.id ? `${source.id}|${target.id}` : `${target.id}|${source.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target });
  };

  const depIds = new Set<string>();
  nodes.forEach((node) => {
    for (const depId of node.bot.deployment_ids ?? []) {
      if (depId) depIds.add(depId);
    }
  });

  depIds.forEach((depId) => {
    const group = nodes.filter((node) => node.bot.deployment_ids?.includes(depId));
    if (group.length < 2) return;
    const neighborCount = group.length > 18 ? 2 : 3;
    group.forEach((source) => {
      const nearest = group
        .filter((node) => node !== source)
        .map((node) => ({ node, dist: distance(source, node) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, neighborCount);
      nearest.forEach(({ node }) => add(source, node));
    });
  });

  return links;
}

function activityTier(weight: number): string {
  if (weight >= 5000) return "很高";
  if (weight >= 1000) return "较高";
  if (weight >= 200) return "一般";
  if (weight > 0) return "较低";
  return "暂无统计";
}
