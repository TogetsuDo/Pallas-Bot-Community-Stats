import type { CorpusHotData, HotCorpusItem, HotTab } from "./api";
import { layoutHotTags, rankHotItems } from "./hotBubbleLayout";

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
    void this.refresh();
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
        this.tab === "fleet" ? "标签越大越热 · 点击查看热度" : "标签越大越热 · 点击查看代表回复";
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
    const { nodes, height } = layoutHotTags(this.items, width);
    const cloud = document.createElement("div");
    cloud.className = "corpus-hot__cloud";
    cloud.style.height = `${height}px`;
    cloud.setAttribute("role", "list");
    cloud.setAttribute("aria-label", "共享语料热词云");

    nodes.forEach((node, index) => {
      const active = node.item.keywords === this.selectedKeywords;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `corpus-hot__pill corpus-hot__pill--${node.sizeClass}`;
      if (node.rank <= 3) {
        btn.classList.add(`corpus-hot__pill--top${node.rank}`);
      }
      if (active) {
        btn.classList.add("corpus-hot__pill--active");
      }
      btn.style.setProperty("--heat", node.scoreRatio.toFixed(3));
      btn.style.setProperty("--pill-i", String(index));
      btn.style.left = `${node.x}px`;
      btn.style.top = `${node.y}px`;
      btn.dataset.keywords = node.item.keywords;
      btn.setAttribute("role", "listitem");
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.title = `${node.item.keywords} · 热度 ${node.item.score}`;

      if (node.rank <= 3) {
        const rank = document.createElement("span");
        rank.className = "corpus-hot__pill-rank";
        rank.textContent = String(node.rank);
        rank.setAttribute("aria-hidden", "true");
        btn.appendChild(rank);
      }

      const word = document.createElement("span");
      word.className = "corpus-hot__pill-word";
      word.textContent = node.item.keywords;
      btn.appendChild(word);

      const score = document.createElement("span");
      score.className = "corpus-hot__pill-score";
      score.textContent = String(node.item.score);
      btn.appendChild(score);

      btn.addEventListener("click", () => {
        this.toggleKeywords(node.item.keywords);
      });

      cloud.appendChild(btn);
    });

    if (this.selectedKeywords) {
      cloud.classList.add("corpus-hot__cloud--selected");
    }

    this.cloudEl.appendChild(cloud);

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
    const cloud = this.cloudEl.querySelector<HTMLElement>(".corpus-hot__cloud");
    cloud?.classList.toggle("corpus-hot__cloud--selected", this.selectedKeywords !== null);

    this.cloudEl.querySelectorAll<HTMLButtonElement>(".corpus-hot__pill").forEach((el) => {
      const key = el.dataset.keywords;
      const active = key !== undefined && key === this.selectedKeywords;
      el.classList.toggle("corpus-hot__pill--active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  private renderDetail(): void {
    this.detailEl.innerHTML = "";
    this.detailEl.hidden = !this.selectedKeywords;
    if (!this.selectedKeywords) return;

    const item = this.items.find((row) => row.keywords === this.selectedKeywords);
    if (!item) return;

    const rank = rankHotItems(this.items).find((node) => node.item.keywords === item.keywords)?.rank;

    const panel = document.createElement("div");
    panel.className = "corpus-hot__detail-panel";

    const hd = document.createElement("div");
    hd.className = "corpus-hot__detail-hd";

    const titleWrap = document.createElement("div");
    titleWrap.className = "corpus-hot__detail-heading";

    if (rank !== undefined && rank <= 3) {
      const badge = document.createElement("span");
      badge.className = "corpus-hot__detail-rank";
      badge.textContent = `#${rank}`;
      titleWrap.appendChild(badge);
    }

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
    closeBtn.setAttribute("aria-label", "收起详情");
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

    panel.append(hd, list);
    this.detailEl.appendChild(panel);
  }
}
