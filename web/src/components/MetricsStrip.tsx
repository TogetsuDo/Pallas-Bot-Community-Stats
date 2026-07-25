import type { MonitorOverview } from "@/api";
import { formatNum, onlineWindowText } from "@/api";

type MetricsStripProps = {
  data?: MonitorOverview;
  error?: string | null;
  loading?: boolean;
};

type Metric = { label: string; value: string; hint: string };

function buildMetrics(data: MonitorOverview): Metric[] {
  const dep = data.deployments;
  const corpus = data.corpus;
  const fed = data.federation;
  const windowText = onlineWindowText(data.online_ttl_sec);

  const items: Metric[] = [
    {
      label: "在线部署",
      value: formatNum(dep.deployments_online),
      hint: windowText,
    },
    {
      label: "在线牛牛",
      value: formatNum(dep.bots_online_sum),
      hint: "各安装上报合计",
    },
  ];

  if (corpus) {
    items.push({
      label: "共享语料",
      value: formatNum(corpus.contexts_total),
      hint: `${formatNum(corpus.answers_total)} 回复`,
    });
  } else {
    items.push({
      label: "24h 活跃",
      value: formatNum(dep.active_recent_24h),
      hint: `累计 ${formatNum(dep.deployments_total)} 套`,
    });
  }

  if (fed && (fed.members_total > 0 || fed.members_online > 0)) {
    items.push({
      label: "联邦在线",
      value: formatNum(fed.members_online),
      hint: `累计 ${formatNum(fed.members_total)}`,
    });
  } else {
    items.push({
      label: "累计部署",
      value: formatNum(dep.deployments_total),
      hint: "历史接入",
    });
  }

  return items.slice(0, 4);
}

export function MetricsStrip({ data, error, loading }: MetricsStripProps) {
  return (
    <section id="metrics" className="scroll-mt-20 border-b border-[var(--border)] py-12 sm:py-14">
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)]">
        <div className="mb-6">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Snapshot
          </p>
          <h2 className="text-xl font-semibold text-[var(--text)]">社区动态</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            自愿接入的自托管安装汇总，轻量一览。
          </p>
        </div>

        {error ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
            指标加载失败：{error}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(loading || !data
              ? Array.from({ length: 4 }, (_, i) => ({ key: i, skeleton: true as const }))
              : buildMetrics(data).map((m, i) => ({ key: i, skeleton: false as const, ...m }))
            ).map((item) =>
              item.skeleton ? (
                <div
                  key={item.key}
                  className="h-[88px] animate-pulse rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]"
                />
              ) : (
                <article
                  key={item.key}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                >
                  <div className="text-[11px] text-[var(--text-muted)]">{item.label}</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tracking-tight text-[var(--text)]">
                    {item.value}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">{item.hint}</div>
                </article>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}
