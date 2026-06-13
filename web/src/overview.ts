import type { MonitorOverview } from "./api";
import { formatNum, onlineWindowText } from "./api";

function statCard(label: string, value: string, hint: string): string {
  return `
    <article class="stat-card">
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
      <div class="stat-card__hint">${hint}</div>
    </article>
  `;
}

export function renderOverview(root: HTMLElement, data: MonitorOverview): void {
  const dep = data.deployments;
  const corpus = data.corpus;
  const fed = data.federation;
  const windowText = onlineWindowText(data.online_ttl_sec);

  const cards: string[] = [
    statCard("在线部署", formatNum(dep.deployments_online), `${windowText}的自托管安装`),
    statCard("在线牛牛", formatNum(dep.bots_online_sum), "各安装上报的在线牛合计"),
    statCard(
      "24h 活跃部署",
      formatNum(dep.active_recent_24h),
      `历史累计 ${formatNum(dep.deployments_total)} 套`,
    ),
    statCard(
      "分片部署",
      `${formatNum(dep.deployments_online_sharded)} / ${formatNum(dep.shard_workers_online_sum)}`,
      "在线分片套数 / worker 合计",
    ),
  ];

  if (corpus) {
    cards.push(
      statCard(
        "语料池",
        `${formatNum(corpus.contexts_total)} 词条`,
        `${formatNum(corpus.answers_total)} 回复 · 接入 ${formatNum(corpus.enrollments_online)} 处在线`,
      ),
    );
  }

  if (fed && (fed.members_total > 0 || fed.members_online > 0)) {
    cards.push(
      statCard(
        "联邦入池",
        `${formatNum(fed.members_online)} 在线`,
        `累计 ${formatNum(fed.members_total)} 套 · 24h 新增 ${formatNum(fed.members_recent_24h)}`,
      ),
    );
  }

  const versions = (dep.online_versions ?? [])
    .slice(0, 5)
    .map((row) => `<li><span>${escapeHtml(row.version || "未知")}</span><strong>${row.count}</strong></li>`)
    .join("");

  root.innerHTML = `
    <div class="overview-grid">${cards.join("")}</div>
    ${
      versions
        ? `<div class="overview-versions"><h3>在线版本 Top</h3><ul>${versions}</ul></div>`
        : ""
    }
    <p class="overview-asof">快照 ${escapeHtml(data.as_of || "")}</p>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderOverviewError(root: HTMLElement, message: string): void {
  root.innerHTML = `<div class="panel-error">概览加载失败：${escapeHtml(message)}</div>`;
}
