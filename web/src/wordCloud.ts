import * as d3 from "d3";
import type { CorpusHotData, HotCorpusItem, HotTab } from "./api";
import {
  hotBubbleFill,
  hotBubbleFontSize,
  hotBubbleLabel,
  layoutHotBubbles,
} from "./hotBubbleLayout";

const TAB_LABELS: Record<HotTab, string> = {
  fleet: "机群",
  pool: "高频池",
  day: "今日",
  week: "本周",
  month: "本月",
};

export class CorpusWordCloud {
  private readonly section: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly cloudEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private tab: HotTab = "fleet";
  private items: HotCorpusItem[] = [];
  private selectedKeywords: string | null = null;
  private loadFn: ((tab: HotTab) => Promise<CorpusHotData>) | null = null;
  private busy = false;
  private resizeObserver: ResizeObserver | null = null;
  private renderToken = 0;

  constructor(section: HTMLElement) {
    this.section = section;
    this.tabsEl = section.querySelector<HTMLElement>("[data-hot-tabs]")!;
    this.cloudEl = section.querySelector<HTMLElement>("[data-hot-canvas]")!;
    this.detailEl = section.querySelector<HTMLElement>("[data-hot-detail]")!;
    this.emptyEl = section.querySelector<HTMLElement>("[data-hot-empty]")!;
    this.legendEl = section.querySelector<HTMLElement>("[data-hot-legend]")!;
    this.bindTabs();
  }

  observe(load: (tab: HotTab) => Promise<CorpusHotData>): void {
    this.loadFn = load;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void this.refresh();
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(this.section);
  }

  private bindTabs(): void {
    this.tabsEl.querySelectorAll<HTMLButtonElement>("[data-hot-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.hotPeriod as HotTab | undefined;
        if (!tab || tab === this.tab || this.busy) return;
        this.tab = tab;
        this.selectedKeywords = null;
        this.syncTabs();
        void this.refresh();
      });
    });
  }

  private syncTabs(): void {
    this.tabsEl.querySelectorAll<HTMLButtonElement>("[data-hot-period]").forEach((btn) => {
      const active = btn.dataset.hotPeriod === this.tab;
      btn.classList.toggle("corpus-hot__tab--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  private async refresh(): Promise<void> {
    if (!this.loadFn) return;
    this.busy = true;
    this.legendEl.textContent = `加载${TAB_LABELS[this.tab]}热词…`;
    try {
      const data = await this.loadFn(this.tab);
      this.items = data.items;
      const scope =
        this.tab === "fleet"
          ? "近24h各部署热词叠加"
          : this.tab === "pool"
            ? "社区高频池"
            : `${TAB_LABELS[this.tab]}近期活跃`;
      const hint =
        this.tab === "fleet" ? "气泡越大越热 · 点击查看热度" : "气泡越大越热 · 点击查看代表回复";
      this.legendEl.textContent = `${scope} · ${hint}`;
      this.renderCloud();
      this.renderDetail();
    } catch (err) {
      this.items = [];
      this.legendEl.textContent = "热词加载失败";
      this.emptyEl.hidden = false;
      this.emptyEl.textContent = `热词数据加载失败：${err instanceof Error ? err.message : String(err)}`;
      this.cloudEl.innerHTML = "";
      this.detailEl.innerHTML = "";
    } finally {
      this.busy = false;
    }
  }

  private renderCloud(): void {
    const token = ++this.renderToken;
    this.cloudEl.innerHTML = "";
    if (!this.items.length) {
      this.emptyEl.hidden = false;
      this.emptyEl.textContent =
        this.tab === "fleet"
          ? "暂无机群热词。各部署开启语料贡献并上报心跳后，这里会展示近24h热词叠加榜。"
          : this.tab === "pool"
            ? "暂无共享语料高频词。接入并贡献语料后，这里会展示社区累计最热触发词。"
            : "该时段暂无近期活跃热词。可切换到「机群」或「高频池」查看。";
      return;
    }
    this.emptyEl.hidden = true;

    const width = this.cloudEl.clientWidth || 960;
    const { nodes, height } = layoutHotBubbles(this.items, width);

    const svg = d3
      .select(this.cloudEl)
      .append("svg")
      .attr("class", "hot-bubble-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "共享语料热词气泡图");

    const node = svg
      .selectAll<SVGGElement, (typeof nodes)[number]>("g.hot-bubble-node")
      .data(nodes)
      .join("g")
      .attr("class", (d) => {
        const active = d.item.keywords === this.selectedKeywords ? " hot-bubble-node--active" : "";
        return `hot-bubble-node${active}`;
      })
      .attr("data-keywords", (d) => d.item.keywords)
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-pressed", (d) => (d.item.keywords === this.selectedKeywords ? "true" : "false"))
      .on("click", (_, d) => {
        this.toggleKeywords(d.item.keywords);
      })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.toggleKeywords(d.item.keywords);
      });

    const body = node
      .append("g")
      .attr("class", "hot-bubble-node__body")
      .style("--hot-delay", (_, i) => `${Math.min(i * 35, 640)}ms`);

    body
      .append("circle")
      .attr("r", (d) => d.r)
      .attr("class", "hot-bubble-node__disk")
      .attr("fill", (d) => hotBubbleFill(d.scoreRatio));

    body
      .append("text")
      .attr("class", "hot-bubble-node__label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", (d) => hotBubbleFontSize(d.r))
      .text((d) => hotBubbleLabel(d.item.keywords, d.r));

    node.append("title").text((d) => `${d.item.keywords}\n热度 ${d.item.score}`);

    if (token !== this.renderToken) return;

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.items.length) this.renderCloud();
      });
      this.resizeObserver.observe(this.cloudEl);
    }
  }

  private toggleKeywords(keywords: string): void {
    this.selectKeywords(this.selectedKeywords === keywords ? null : keywords);
  }

  private selectKeywords(keywords: string | null): void {
    this.selectedKeywords = keywords;
    this.syncSelectionState();
    this.renderDetail();
  }

  private syncSelectionState(): void {
    this.cloudEl.querySelectorAll<SVGGElement>("g.hot-bubble-node").forEach((el) => {
      const key = el.getAttribute("data-keywords");
      const active = key !== null && key === this.selectedKeywords;
      el.classList.toggle("hot-bubble-node--active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  private renderDetail(): void {
    this.detailEl.innerHTML = "";
    if (!this.selectedKeywords) return;
    const item = this.items.find((row) => row.keywords === this.selectedKeywords);
    if (!item) return;

    const hd = document.createElement("div");
    hd.className = "corpus-hot__detail-hd";

    const titleWrap = document.createElement("div");
    titleWrap.className = "corpus-hot__detail-heading";

    const title = document.createElement("h3");
    title.className = "corpus-hot__detail-title";
    title.textContent = item.keywords;

    const meta = document.createElement("p");
    meta.className = "corpus-hot__detail-meta";
    meta.textContent =
      this.tab === "fleet"
        ? `机群叠加热度 ${item.score}`
        : this.tab === "pool"
          ? `累计热度 ${item.score}`
          : `${TAB_LABELS[this.tab]}热度 ${item.score}`;

    titleWrap.append(title, meta);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "corpus-hot__detail-close";
    closeBtn.setAttribute("aria-label", "收起代表回复");
    closeBtn.textContent = "收起";
    closeBtn.addEventListener("click", () => {
      this.selectKeywords(null);
    });

    hd.append(titleWrap, closeBtn);

    const list = document.createElement("ul");
    list.className = "corpus-hot__reply-list";
    if (!item.answers.length) {
      const li = document.createElement("li");
      li.className = "corpus-hot__reply corpus-hot__reply--empty";
      li.textContent = this.tab === "fleet" ? "机群榜不含代表回复" : "暂无代表回复";
      list.appendChild(li);
    } else {
      item.answers.forEach((answer) => {
        const li = document.createElement("li");
        li.className = "corpus-hot__reply";
        const text = document.createElement("p");
        text.className = "corpus-hot__reply-text";
        text.textContent = answer.message || answer.answer_keywords || "（无文案）";
        const hint = document.createElement("p");
        hint.className = "corpus-hot__reply-hint";
        hint.textContent = `引用 ${answer.count} 次`;
        li.append(text, hint);
        list.appendChild(li);
      });
    }

    this.detailEl.append(hd, list);
  }
}
