export type HotPeriod = "day" | "week" | "month";
export type HotMode = "fleet" | "pool" | "recent";
export type HotTab = "fleet" | "pool" | "month";

export type HotCorpusAnswer = {
  answer_keywords: string;
  message: string;
  count: number;
};

export type HotCorpusItem = {
  keywords: string;
  score: number;
  answers: HotCorpusAnswer[];
};

export type CorpusHotData = {
  mode: HotMode;
  period: HotPeriod;
  window_sec: number;
  as_of: string;
  items: HotCorpusItem[];
};

export type MonitorOverview = {
  online_ttl_sec: number;
  as_of: string;
  corpus_enabled: boolean;
  deployments: {
    deployments_total: number;
    deployments_online: number;
    bots_online_sum: number;
    catalog_bots_online_sum: number;
    deployments_online_sharded: number;
    shard_workers_online_sum: number;
    active_recent_24h: number;
    online_versions: Array<{ version: string; count: number }>;
  };
  corpus?: {
    contexts_total: number;
    answers_total: number;
    answer_hits_sum: number;
    enrollments_total: number;
    enrollments_online: number;
  } | null;
  federation?: {
    members_total: number;
    members_online: number;
    members_recent_24h: number;
  } | null;
};

export type BubbleBot = {
  bot_key: string;
  qq?: number;
  nickname: string;
  avatar_url: string;
  profile_url: string;
  online: boolean;
  message_weight: number;
  deployment_ids?: string[];
};

export type RosterBubble = {
  online_ttl_sec: number;
  as_of: string;
  bots_total: number;
  bots_online: number;
  bots: BubbleBot[];
};

type HubPrefetchKey = "overview" | "roster";

declare global {
  interface Window {
    __PALLAS_HUB_PREFETCH__?: Partial<Record<HubPrefetchKey, Promise<unknown>>>;
  }
}

function takePrefetched<T>(key: HubPrefetchKey, fetchFresh: () => Promise<T>): Promise<T> {
  const hub = window.__PALLAS_HUB_PREFETCH__;
  const pending = hub?.[key];
  if (pending) {
    delete hub[key];
    return pending as Promise<T>;
  }
  return fetchFresh();
}

export async function fetchOverview(): Promise<MonitorOverview> {
  return takePrefetched("overview", async () => {
    const resp = await fetch("/v1/monitor/overview");
    if (!resp.ok) throw new Error(`overview ${resp.status}`);
    return resp.json() as Promise<MonitorOverview>;
  });
}

export async function fetchBubbleRoster(): Promise<RosterBubble> {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo_clusters") || params.get("demo") === "clusters") {
      return buildDemoClusterRoster();
    }
  }
  return takePrefetched("roster", async () => {
    const resp = await fetch("/v1/roster/bubble");
    if (!resp.ok) throw new Error(`bubble ${resp.status}`);
    return resp.json() as Promise<RosterBubble>;
  });
}

/**
 * 本地预览：`?demo_clusters=1` 注入约 60 只公开牛的测试名册。
 * 模拟当前社区体量：维护者侧 43 只同属一套部署，其余 17 只来自其他小部署。
 */
function buildDemoClusterRoster(): RosterBubble {
  type Pack = { dep: string; count: number; baseQq: number; label: string; owner: "self" | "community" };
  // 自有 43 只同一套部署；社区 17；合计 60
  const packs: Pack[] = [
    { dep: "demo-self-main", count: 43, baseQq: 351000001, label: "自研", owner: "self" },
    { dep: "demo-peer-north", count: 5, baseQq: 361000001, label: "北境", owner: "community" },
    { dep: "demo-peer-east", count: 4, baseQq: 362000001, label: "东风", owner: "community" },
    { dep: "demo-peer-south", count: 3, baseQq: 363000001, label: "南枝", owner: "community" },
    { dep: "demo-peer-west", count: 2, baseQq: 364000001, label: "西岭", owner: "community" },
    { dep: "demo-peer-solo-a", count: 1, baseQq: 365000001, label: "路过", owner: "community" },
    { dep: "demo-peer-solo-b", count: 1, baseQq: 366000001, label: "旅人", owner: "community" },
    { dep: "demo-peer-solo-c", count: 1, baseQq: 367000001, label: "旁观", owner: "community" },
  ];

  const bots: BubbleBot[] = [];
  let selfIndex = 0;

  for (const pack of packs) {
    for (let i = 0; i < pack.count; i++) {
      const qq = pack.baseQq + i;
      const isSelf = pack.owner === "self";
      const seq = isSelf ? ++selfIndex : i + 1;
      const nickname = isSelf
        ? `帕拉斯·${String(seq).padStart(2, "0")}`
        : `${pack.label}牛${pack.count > 1 ? String(i + 1) : ""}`;
      const onlineBias = isSelf ? 0.82 : 0.7;
      const online = ((qq * 17) % 100) / 100 < onlineBias;
      bots.push({
        bot_key: `demo-${pack.dep}-${qq}`,
        qq,
        nickname,
        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`,
        profile_url: "",
        online,
        message_weight: demoMessageWeight(pack.owner, isSelf ? seq : i, pack.count, qq),
        deployment_ids: [pack.dep],
      });
    }
  }

  bots.sort((a, b) => b.message_weight - a.message_weight || a.nickname.localeCompare(b.nickname, "zh"));
  return {
    online_ttl_sec: 900,
    as_of: new Date().toISOString(),
    bots_total: bots.length,
    bots_online: bots.filter((b) => b.online).length,
    bots,
  };
}

/** 少数高活跃 + 多数中低活跃，贴近「部分很热」的真实分布。 */
function demoMessageWeight(
  owner: "self" | "community",
  index: number,
  count: number,
  qq: number,
): number {
  const jitter = qq % 97;
  if (owner === "self") {
    // 自有 43：约 6 只很高、8 只偏高，其余中低
    if (index <= 3) return 12_000 + jitter * 8; // 很高
    if (index <= 6) return 6_500 + jitter * 5;
    if (index <= 14) return 1_800 + jitter * 3;
    if (index <= 28) return 420 + jitter;
    return 60 + (jitter % 80);
  }
  // 社区：每簇最多 1–2 只偏热
  if (index === 0 && count >= 3) return 7_200 + jitter * 4;
  if (index === 0) return 2_400 + jitter * 2;
  if (index === 1 && count >= 4) return 1_100 + jitter;
  return 80 + (jitter % 220);
}

export async function fetchCorpusHot(tab: HotTab = "fleet", limit = 40): Promise<CorpusHotData> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (tab === "fleet") {
    params.set("mode", "fleet");
  } else if (tab === "pool") {
    params.set("mode", "pool");
  } else {
    params.set("mode", "recent");
    params.set("period", tab);
  }
  const resp = await fetch(`/v1/corpus/hot?${params}`);
  if (!resp.ok) throw new Error(`corpus hot ${resp.status}`);
  return resp.json() as Promise<CorpusHotData>;
}

export function formatNum(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.floor(n).toLocaleString("zh-CN");
}

export function onlineWindowText(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 60) return "统计窗口内";
  const m = Math.max(1, Math.round(sec / 60));
  return `近 ${m} 分钟内有心跳`;
}
