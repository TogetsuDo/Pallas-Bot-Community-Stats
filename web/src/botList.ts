import type { BubbleBot } from "./api";
import { openQQProfile } from "./qqProfile";

type BotListFilter = "all" | "online" | "offline";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class BotListPanel {
  private readonly section: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly listHost: HTMLElement;
  private readonly countEl: HTMLElement;
  private filter: BotListFilter = "all";
  private open = false;
  private bots: BubbleBot[] = [];

  constructor(section: HTMLElement) {
    this.section = section;
    this.toggleBtn = section.querySelector<HTMLButtonElement>("[data-bot-list-toggle]")!;
    this.panel = section.querySelector<HTMLElement>("[data-bot-list-panel]")!;
    this.listHost = section.querySelector<HTMLElement>("[data-bot-list-host]")!;
    this.countEl = section.querySelector<HTMLElement>("[data-bot-list-count]")!;
    this.bind();
  }

  private bind(): void {
    this.toggleBtn.addEventListener("click", () => {
      this.open = !this.open;
      this.panel.hidden = !this.open;
      this.toggleBtn.setAttribute("aria-expanded", this.open ? "true" : "false");
      this.toggleBtn.textContent = this.open ? "收起牛牛列表" : "查看全部牛牛";
      if (this.open) this.renderList();
    });

    this.panel.querySelectorAll<HTMLButtonElement>("[data-bot-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.botFilter as BotListFilter | undefined;
        if (!next || next === this.filter) return;
        this.filter = next;
        this.syncFilterTabs();
        this.renderList();
      });
    });
  }

  update(bots: BubbleBot[]): void {
    this.bots = bots;
    const online = bots.filter((bot) => bot.online).length;
    this.countEl.textContent = `上报公开 ${bots.length} 只 · 在线 ${online} 只`;
    if (this.open) this.renderList();
  }

  private syncFilterTabs(): void {
    this.panel.querySelectorAll<HTMLButtonElement>("[data-bot-filter]").forEach((btn) => {
      const active = btn.dataset.botFilter === this.filter;
      btn.classList.toggle("bot-list__filter--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  private filteredBots(): BubbleBot[] {
    if (this.filter === "online") return this.bots.filter((bot) => bot.online);
    if (this.filter === "offline") return this.bots.filter((bot) => !bot.online);
    return this.bots;
  }

  private renderList(): void {
    const rows = this.filteredBots();
    if (!rows.length) {
      this.listHost.innerHTML = `<p class="bot-list__empty">当前筛选下暂无牛牛。</p>`;
      return;
    }

    this.listHost.innerHTML = rows
      .map((bot) => {
        const status = bot.online ? "在线" : "离线";
        const statusClass = bot.online ? "bot-list__status--online" : "bot-list__status--offline";
        const avatar = bot.avatar_url
          ? `<img class="bot-list__avatar" src="${escapeHtml(bot.avatar_url)}" alt="" width="40" height="40" loading="lazy" />`
          : `<span class="bot-list__avatar bot-list__avatar--fallback" aria-hidden="true">${escapeHtml((bot.nickname || "?").trim().slice(0, 1) || "?")}</span>`;
        const meta = bot.qq
          ? `QQ ${bot.qq} · ${status}`
          : `牛牛未公开QQ · ${status}`;
        const action =
          bot.profile_url && bot.qq
            ? `<button type="button" class="bot-list__action" data-bot-qq="${bot.qq}" data-bot-profile="${escapeHtml(bot.profile_url)}">添加好友</button>`
            : "";

        return `
          <article class="bot-list__row">
            ${avatar}
            <div class="bot-list__main">
              <div class="bot-list__name">${escapeHtml(bot.nickname.trim() || (bot.qq ? `牛 ${bot.qq}` : "牛牛"))}</div>
              <div class="bot-list__meta">${escapeHtml(meta)}</div>
            </div>
            <span class="bot-list__status ${statusClass}">${status}</span>
            ${action}
          </article>
        `;
      })
      .join("");

    this.listHost.querySelectorAll<HTMLButtonElement>(".bot-list__action").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qq = Number(btn.dataset.botQq);
        const profile = btn.dataset.botProfile;
        if (!qq || !profile) return;
        void openQQProfile(qq, profile);
      });
    });
  }
}
