export type HotPeriod = "day" | "week" | "month";

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
};

export type RosterBubble = {
  online_ttl_sec: number;
  as_of: string;
  bots_total: number;
  bots_online: number;
  bots: BubbleBot[];
};

export async function fetchOverview(): Promise<MonitorOverview> {
  const resp = await fetch("/v1/monitor/overview");
  if (!resp.ok) throw new Error(`overview ${resp.status}`);
  return resp.json() as Promise<MonitorOverview>;
}

export async function fetchBubbleRoster(): Promise<RosterBubble> {
  const resp = await fetch("/v1/roster/bubble");
  if (!resp.ok) throw new Error(`bubble ${resp.status}`);
  return resp.json() as Promise<RosterBubble>;
}

export async function fetchCorpusHot(period: HotPeriod = "day", limit = 40): Promise<CorpusHotData> {
  const params = new URLSearchParams({ period, limit: String(limit) });
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
