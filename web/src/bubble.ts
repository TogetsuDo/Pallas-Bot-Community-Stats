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
  private animFrame: number | null = null;
  private sphereSpinRaf: number | null = null;
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
    this.viewRotX = IDLE_ROT_X;
    this.viewRotY = IDLE_ROT_Y;
    this.canvasHost.classList.remove("bubble-canvas--focused", "bubble-canvas--dragging");
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
    this.viewRotX = clampRotX(this.dragStartRotX - dy * sens);
    void importD3().then((d3) => this.paintSphereScene(d3));
    event.preventDefault();
  };

  private onSpherePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPending = false;
    if (this.isDragging) {
      this.endSphereDrag();
      window.setTimeout(() => {
        this.dragMoved = false;
      }, 100);
      return;
    }
    this.dragPointerId = null;
  };

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
        void importD3().then((d3) => this.paintSphereScene(d3));
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
    try {
      const bots = await load();
      await this.render(bots);
    } catch (err) {
      this.empty.hidden = false;
      this.empty.textContent = `气泡数据加载失败：${err instanceof Error ? err.message : String(err)}`;
      this.canvasHost.innerHTML = "";
      this.onBotsChange?.([]);
      this.hidePopover();
    }
  }

  private async render(bots: BubbleBot[]): Promise<void> {
    const token = ++this.renderToken;
    const d3 = await importD3();
    if (token !== this.renderToken) return;
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
    const links = this.layoutMode === "sphere" ? buildSphereLinks(nodes) : [];
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

    nodes.forEach((node, index) => {
      const clipId = `${clipPrefix}-${index}`;
      clipIds.push(clipId);
      defs
        .append("clipPath")
        .attr("id", clipId)
        .append("circle")
        .attr("r", Math.max(0, node.r - 4));
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

    this.scene = { stageSel: stage, meshLayerSel, meshSel, linkLayerSel: linkLayer, nodeSel, linkSel, clipIds };
    this.canvasHost.classList.toggle("bubble-canvas--focused", Boolean(this.activeBotKey));

    if (this.activeBotKey && this.layoutMode === "sphere") {
      const focusNode = this.layoutNodes.find((node) => node.bot.bot_key === this.activeBotKey)!;
      const focusAngles = focusRotationForNode(focusNode, this.viewRotY);
      this.viewRotX = focusAngles.rotX;
      this.viewRotY = focusAngles.rotY;
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
        this.viewRotX = from.rotX + (target.rotX - from.rotX) * t;
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

    this.scene.linkLayerSel.style("display", "none");
    this.scene.meshLayerSel?.style("display", "none");

    this.scene.nodeSel
      .attr("transform", (node) => `translate(${node.x},${node.y})`)
      .style("opacity", 1)
      .attr("class", (node) => nodeClassName(node, focusKey, this.focusBlend, false))
      .each((node, index, groups) => {
        const group = d3.select(groups[index]);
        let bodyScale = 1;
        if (focusKey && this.focusBlend > 0) {
          if (node.id === focusKey) {
            const boost = node.r < medianR ? 1.38 : 1.16;
            bodyScale = 1 + (boost - 1) * this.focusBlend;
          } else if (node.r < medianR * 0.92) {
            bodyScale = 1 - 0.1 * this.focusBlend;
          } else {
            bodyScale = 1 - 0.04 * this.focusBlend;
          }
        }
        updateNodeGraphics(d3, group, node, bodyScale, this.scene!.clipIds, this.canvasHost);
      });

    if (focusKey && this.focusBlend > 0) {
      const focusNode = this.layoutNodes.find((node) => node.id === focusKey);
      if (focusNode) {
        const panX = (cx - focusNode.x) * this.focusBlend;
        const panY = (cy - focusNode.y) * this.focusBlend;
        const zoom = 1 + 0.1 * this.focusBlend;
        this.scene.stageSel.attr(
          "transform",
          `translate(${cx},${cy}) scale(${zoom}) translate(${-cx + panX},${-cy + panY})`,
        );
      }
    } else {
      this.scene.stageSel.attr("transform", null);
    }
  }

  private paintSphereScene(d3: D3Module): void {
    if (!this.scene) return;

    const { width, height } = this.lastViewport;
    const cx = width / 2;
    const cy = height / 2;
    const focal = Math.max(width, height) * 1.35;
    const focusKey = this.activeBotKey;
    const focusNeighbors = focusKey ? this.neighborMap.get(focusKey) : undefined;
    const showNeighbors = Boolean(focusKey && focusNeighbors && this.focusBlend > 0.35);
    const projected = new Map<string, Projected>();

    this.scene.linkLayerSel.style("display", null);
    if (this.scene.meshLayerSel) {
      this.scene.meshLayerSel.style("display", null);
    }

    const projectWorld = (point: Vec3): Projected => {
      const rotated = rotateX(rotateY(point, this.viewRotY), this.viewRotX);
      return project(rotated, focal, cx, cy, this.sphereRadius);
    };

    if (this.scene.meshSel) {
      const sphereR = this.sphereRadius;
      const meshDepth: { id: string; avgZ: number }[] = [];
      this.scene.meshSel.each((curve, index, groups) => {
        const projectedPts = curve.points.map((point) => projectWorld(point));
        const avgZ = projectedPts.reduce((sum, point) => sum + point.z, 0) / projectedPts.length;
        meshDepth.push({ id: curve.id, avgZ });
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

    nodeData.sort((a, b) => a.point.z - b.point.z);

    this.scene.nodeSel
      .data(
        nodeData.map((item) => item.node),
        (node) => node.id,
      )
      .order()
      .attr("transform", (node) => {
        const point = projected.get(node.id)!;
        return `translate(${point.x},${point.y})`;
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
      .attr("class", (node) =>
        nodeClassName(
          node,
          focusKey,
          this.focusBlend,
          true,
          projected.get(node.id)!.depthClass,
          showNeighbors ? focusKey : null,
          showNeighbors ? focusNeighbors : undefined,
        ),
      )
      .each((node, index, groups) => {
        const item = nodeData.find((entry) => entry.node.id === node.id);
        if (!item) return;
        const group = d3.select(groups[index]);
        updateNodeGraphics(d3, group, node, item.bodyScale, this.scene!.clipIds, this.canvasHost);
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

    if (!this.docClickBound) {
      this.docClickBound = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.popoverEl?.contains(target)) return;
        if (target instanceof Element && target.closest(".bubble-node")) return;
        if (target instanceof Element && target.closest("[data-bubble-view-toggle]")) return;
        void importD3().then((d3) => this.clearFocus(d3));
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

function clampRotX(value: number): number {
  return Math.max(-0.35, Math.min(1.45, value));
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

function updateNodeGraphics(
  d3: D3Module,
  group: import("d3").Selection<SVGGElement, unknown, null, undefined>,
  node: LayoutNode,
  bodyScale: number,
  clipIds: string[],
  canvasHost: HTMLElement,
): void {
  const displayR = node.r * bodyScale;
  const avatarR = Math.max(0, displayR - 4);

  group.select(".bubble-node__body").attr("transform", `scale(${bodyScale})`);
  group.select(".bubble-node__pulse").attr("r", node.r + 2);
  group.select(".bubble-node__halo").attr("r", node.r);

  const clipIndex = Number(group.attr("data-clip-index"));
  const clipId = clipIds[clipIndex];
  if (clipId) {
    d3.select(canvasHost).select(`#${clipId} circle`).attr("r", Math.max(0, avatarR));
  }

  const avatar = group.select<SVGImageElement>(".bubble-node__avatar");
  if (!avatar.empty()) {
    avatar.attr("width", avatarR * 2).attr("height", avatarR * 2).attr("x", -avatarR).attr("y", -avatarR);
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
  const depth = focal + v.z;
  const scale = focal / depth;
  const normalized = Math.min(1, Math.max(0, (v.z / sphereRadius + 1) / 2));
  const opacity = 0.12 + 0.88 * normalized ** 1.75;
  let depthClass: Projected["depthClass"] = "mid";
  if (normalized >= 0.66) depthClass = "near";
  else if (normalized <= 0.42) depthClass = "far";
  return {
    x: cx + v.x * scale,
    y: cy + v.y * scale,
    z: v.z,
    scale,
    opacity,
    depthClass,
  };
}

function focusRotationForNode(node: LayoutNode, viewRotY = 0): { rotX: number; rotY: number } {
  const planar = Math.hypot(node.wx, node.wz);
  const baseRotY = Math.atan2(-node.wx, node.wz);
  return {
    rotY: nearestAngle(viewRotY, baseRotY),
    rotX: Math.atan2(node.wy, planar || 1),
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
  const segments = 56;
  const latBands = 5;
  const lonBands = 8;

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

function buildSphereLinks(nodes: LayoutNode[]): SimLink[] {
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
        .map((node) => ({ node, angle: sphereAngularDistance(source, node) }))
        .sort((a, b) => a.angle - b.angle)
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
