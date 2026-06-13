import type { CorpusHotData, HotCorpusItem, HotPeriod } from "./api";

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

  constructor(section: HTMLElement) {
    this.section = section;
    this.tabsEl = section.querySelector<HTMLElement>("[data-hot-tabs]")!;
    this.cloudEl = section.querySelector<HTMLElement>("[data-hot-cloud]")!;
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
      this.legendEl.textContent = `${PERIOD_LABELS[this.period]}最热触发词 · 点击词条查看代表回复`;
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
    this.cloudEl.innerHTML = "";
    if (!this.items.length) {
      this.emptyEl.hidden = false;
      this.emptyEl.textContent = "该时段暂无共享语料热词。接入并贡献语料后，这里会展示社区最热触发词。";
      return;
    }
    this.emptyEl.hidden = true;
    const maxScore = Math.max(...this.items.map((item) => item.score), 1);
    this.items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "corpus-hot__word";
      if (item.keywords === this.selectedKeywords) {
        btn.classList.add("corpus-hot__word--active");
      }
      const ratio = 0.35 + (item.score / maxScore) * 0.65;
      btn.style.fontSize = `${Math.max(0.78, Math.min(1.65, 0.78 + ratio * 0.9))}rem`;
      btn.textContent = item.keywords;
      btn.title = `热度 ${item.score}`;
      btn.addEventListener("click", () => {
        this.selectedKeywords = this.selectedKeywords === item.keywords ? null : item.keywords;
        this.renderCloud();
        this.renderDetail();
      });
      this.cloudEl.appendChild(btn);
    });
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
