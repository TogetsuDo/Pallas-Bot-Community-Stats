import * as d3 from "d3";
import type { CorpusHotData, HotCorpusItem, HotPeriod } from "./api";
import {
  hotBubbleFill,
  hotBubbleFontSize,
  hotBubbleLabel,
  layoutHotBubbles,
} from "./hotBubbleLayout";

const PERIOD_LABELS: Record<HotPeriod, string> = {
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
  private period: HotPeriod = "day";
  private items: HotCorpusItem[] = [];
  private selectedKeywords: string | null = null;
  private loadFn: ((period: HotPeriod) => Promise<CorpusHotData>) | null = null;
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

  observe(load: (period: HotPeriod) => Promise<CorpusHotData>): void {
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
        const period = btn.dataset.hotPeriod as HotPeriod | undefined;
        if (!period || period === this.period || this.busy) return;
        this.period = period;
        this.selectedKeywords = null;
        this.syncTabs();
        void this.refresh();
      });
    });
  }

  private syncTabs(): void {
    this.tabsEl.querySelectorAll<HTMLButtonElement>("[data-hot-period]").forEach((btn) => {
      const active = btn.dataset.hotPeriod === this.period;
      btn.classList.toggle("corpus-hot__tab--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  private async refresh(): Promise<void> {
    if (!this.loadFn) return;
    this.busy = true;
    this.legendEl.textContent = `加载${PERIOD_LABELS[this.period]}热词…`;
    try {
      const data = await this.loadFn(this.period);
      this.items = data.items;
      this.legendEl.textContent = `${PERIOD_LABELS[this.period]}最热触发词 · 气泡越大越热 · 点击查看代表回复`;
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
      this.emptyEl.textContent = "该时段暂无共享语料热词。接入并贡献语料后，这里会展示社区最热触发词。";
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
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("--hot-delay", (_, i) => `${Math.min(i * 35, 640)}ms`)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-pressed", (d) => (d.item.keywords === this.selectedKeywords ? "true" : "false"))
      .on("click", (_, d) => {
        this.selectedKeywords = this.selectedKeywords === d.item.keywords ? null : d.item.keywords;
        this.renderCloud();
        this.renderDetail();
      })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.selectedKeywords = this.selectedKeywords === d.item.keywords ? null : d.item.keywords;
        this.renderCloud();
        this.renderDetail();
      });

    node
      .append("circle")
      .attr("r", (d) => d.r)
      .attr("class", "hot-bubble-node__disk")
      .attr("fill", (d) => hotBubbleFill(d.scoreRatio));

    node
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

  private renderDetail(): void {
    this.detailEl.innerHTML = "";
    if (!this.selectedKeywords) return;
    const item = this.items.find((row) => row.keywords === this.selectedKeywords);
    if (!item) return;

    const title = document.createElement("h3");
    title.className = "corpus-hot__detail-title";
    title.textContent = item.keywords;

    const meta = document.createElement("p");
    meta.className = "corpus-hot__detail-meta";
    meta.textContent = `${PERIOD_LABELS[this.period]}热度 ${item.score}`;

    const list = document.createElement("ul");
    list.className = "corpus-hot__reply-list";
    if (!item.answers.length) {
      const li = document.createElement("li");
      li.className = "corpus-hot__reply corpus-hot__reply--empty";
      li.textContent = "暂无代表回复";
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

    this.detailEl.append(title, meta, list);
  }
}
