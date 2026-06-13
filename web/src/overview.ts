import type { MonitorOverview } from "./api";
import { formatNum, onlineWindowText } from "./api";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statCard(label: string, value: string, hint: string, index: number): string {
  return `
    <article class="stat-card stat-card--tech" style="--card-i: ${index}">
      <div class="stat-card__corner" aria-hidden="true"></div>
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
      <div class="stat-card__hint">${hint}</div>
    </article>
  `;
}

function heroMetric(label: string, value: string, index: number): string {
  return `
    <div class="hero-metric" style="--metric-i: ${index}">
      <span class="hero-metric__label">${label}</span>
      <span class="hero-metric__value">${value}</span>
    </div>
  `;
}

export function renderHeroMetrics(root: HTMLElement, data: MonitorOverview): void {
  const dep = data.deployments;
  root.innerHTML = [
    heroMetric("在线部署", formatNum(dep.deployments_online), 0),
    heroMetric("在线牛牛", formatNum(dep.bots_online_sum), 1),
    heroMetric("24h 活跃", formatNum(dep.active_recent_24h), 2),
    heroMetric("累计部署", formatNum(dep.deployments_total), 3),
  ].join("");
  root.classList.add("hero-dashboard__grid--ready");
}

export function renderHeroMetricsError(root: HTMLElement): void {
  root.innerHTML = `<p class="hero-dashboard__fallback">指标暂不可用</p>`;
  root.classList.add("hero-dashboard__grid--ready");
}

export function renderOverview(root: HTMLElement, data: MonitorOverview): void {
  const dep = data.deployments;
  const corpus = data.corpus;
  const fed = data.federation;
  const windowText = onlineWindowText(data.online_ttl_sec);

  const cards: string[] = [
    statCard("在线部署", formatNum(dep.deployments_online), `${windowText}的自托管安装`, 0),
    statCard("在线牛牛", formatNum(dep.bots_online_sum), "各安装上报的在线牛合计", 1),
    statCard(
      "24h 活跃部署",
      formatNum(dep.active_recent_24h),
      `历史累计 ${formatNum(dep.deployments_total)} 套`,
      2,
    ),
    statCard(
      "分片部署",
      `${formatNum(dep.deployments_online_sharded)} / ${formatNum(dep.shard_workers_online_sum)}`,
      "在线分片套数 / worker 合计",
      3,
    ),
  ];

  if (corpus) {
    cards.push(
      statCard(
        "共享语料池",
        `${formatNum(corpus.contexts_total)} 词条`,
        `${formatNum(corpus.answers_total)} 回复 · 接入 ${formatNum(corpus.enrollments_online)} 处在线`,
        cards.length,
      ),
    );
  }

  if (fed && (fed.members_total > 0 || fed.members_online > 0)) {
    cards.push(
      statCard(
        "联邦入池",
        `${formatNum(fed.members_online)} 在线`,
        `累计 ${formatNum(fed.members_total)} 套 · 24h 新增 ${formatNum(fed.members_recent_24h)}`,
        cards.length,
      ),
    );
  }

  const versions = (dep.online_versions ?? []).slice(0, 6);
  const maxCount = versions.reduce((max, row) => Math.max(max, row.count), 1);
  const versionRows = versions
    .map((row, index) => {
      const pct = Math.round((row.count / maxCount) * 100);
      return `
        <li class="version-row" style="--row-i: ${index}">
          <span class="version-row__name">${escapeHtml(row.version || "未知")}</span>
          <div class="version-row__bar" aria-hidden="true"><span style="width: ${pct}%"></span></div>
          <strong class="version-row__count">${row.count}</strong>
        </li>
      `;
    })
    .join("");

  root.innerHTML = `
    <div class="overview-dashboard hub-reveal">
      <div class="overview-grid">${cards.join("")}</div>
      ${
        versionRows
          ? `
        <aside class="overview-versions tech-panel">
          <div class="tech-panel__hd">
            <span class="tech-panel__tag">VERSIONS</span>
            <h3>在线版本分布</h3>
          </div>
          <ul class="version-list">${versionRows}</ul>
        </aside>`
          : ""
      }
      <p class="overview-asof">
        <span class="overview-asof__dot" aria-hidden="true"></span>
        快照 ${escapeHtml(data.as_of || "")}
      </p>
    </div>
  `;
  root.classList.remove("overview-root--loading");
}

export function renderOverviewError(root: HTMLElement, message: string): void {
  root.innerHTML = `<div class="panel-error hub-reveal">概览加载失败：${escapeHtml(message)}</div>`;
  root.classList.remove("overview-root--loading");
}
