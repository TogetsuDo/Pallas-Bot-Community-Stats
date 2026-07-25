import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { fetchCorpusHot, type HotTab } from "@/api";
import SegTabs from "@/components/SegTabs";
import { cn } from "@/lib/utils";
import { rankHotItems, type HotTagNode } from "@/hotBubbleLayout";

const communityTabs: Array<{ key: HotTab; label: string }> = [
  { key: "fleet", label: "机群" },
  { key: "pool", label: "高频池" },
  { key: "month", label: "本月" },
];

const COMMUNITY_HOT_TAB_OPTIONS = communityTabs.map((row) => ({
  value: row.key,
  label: row.label,
}));

function pillClasses(node: HotTagNode, selected: string | null): string {
  const classes = ["corpus-hot__pill", `corpus-hot__pill--${node.sizeClass}`];
  if (node.rank <= 3) classes.push(`corpus-hot__pill--top${node.rank}`);
  if (node.item.keywords === selected) classes.push("corpus-hot__pill--active");
  return classes.join(" ");
}

type CorpusWordCloudProps = {
  enabled?: boolean;
  tab?: HotTab;
  onTabChange?: (tab: HotTab) => void;
  showTabs?: boolean;
};

export default function CorpusWordCloud({
  enabled = true,
  tab: tabProp,
  onTabChange,
  showTabs = true,
}: CorpusWordCloudProps) {
  const [internalTab, setInternalTab] = useState<HotTab>("fleet");
  const tab = tabProp ?? internalTab;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchCorpusHot>>["items"]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudEntering, setCloudEntering] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const enterTimerRef = useRef<number | null>(null);
  const prevTabRef = useRef<HotTab | null>(null);
  const pendingTabEnterRef = useRef(false);

  const setTab = useCallback(
    (next: HotTab) => {
      if (onTabChange) onTabChange(next);
      if (tabProp === undefined) setInternalTab(next);
    },
    [onTabChange, tabProp],
  );

  const tabLabel = communityTabs.find((row) => row.key === tab)?.label || "机群";

  const scopeLabel =
    tab === "fleet" ? "近24h机群叠加" : tab === "pool" ? "社区高频池" : `${tabLabel}近期活跃`;

  const statusHint = tab === "fleet" ? "越大越热 · 点选查看" : "越大越热 · 点选看回复";

  const rankedNodes = useMemo(() => rankHotItems(items), [items]);
  const selectedItem = items.find((item) => item.keywords === selectedKeywords) || null;
  const selectedRank =
    selectedKeywords != null
      ? (rankedNodes.find((node) => node.item.keywords === selectedKeywords)?.rank ?? null)
      : null;

  const triggerCloudEnter = useCallback(() => {
    setCloudEntering(true);
    if (enterTimerRef.current != null) window.clearTimeout(enterTimerRef.current);
    enterTimerRef.current = window.setTimeout(() => {
      setCloudEntering(false);
      enterTimerRef.current = null;
    }, 640);
  }, []);

  const loadHot = useCallback(async () => {
    const tabSwitch = pendingTabEnterRef.current || cloudLoading;
    setBusy(true);
    setErr("");
    try {
      const next = await fetchCorpusHot(tab);
      setItems(next.items);
      setLoadedOnce(true);
      setSelectedKeywords((cur) =>
        cur && !next.items.some((item) => item.keywords === cur) ? null : cur,
      );
      if (tabSwitch && rankHotItems(next.items).length) {
        triggerCloudEnter();
      }
    } catch (e) {
      setItems([]);
      setSelectedKeywords(null);
      setLoadedOnce(true);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      pendingTabEnterRef.current = false;
      setBusy(false);
      setCloudLoading(false);
    }
  }, [cloudLoading, tab, triggerCloudEnter]);

  useEffect(() => {
    if (prevTabRef.current != null && prevTabRef.current !== tab) {
      pendingTabEnterRef.current = true;
      setCloudLoading(true);
      setSelectedKeywords(null);
    }
    prevTabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    if (!enabled) return;
    void loadHot();
    // 仅在 enabled / tab 变化时拉取；与 WebUI CorpusWordCloud 一致
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadHot 随 tab 重建即可
  }, [enabled, tab]);

  useEffect(
    () => () => {
      if (enterTimerRef.current != null) window.clearTimeout(enterTimerRef.current);
    },
    [],
  );

  function selectTab(next: HotTab) {
    if (next === tab || busy) return;
    setTab(next);
  }

  function toggleKeyword(keywords: string) {
    setSelectedKeywords((cur) => (cur === keywords ? null : keywords));
  }

  return (
    <div className="corpus-hot">
      {showTabs ? (
        <SegTabs
          className="corpus-hot__tabs"
          full
          ariaLabel="热词统计范围"
          value={tab}
          disabled={busy}
          onValueChange={(v) => selectTab(v as HotTab)}
          options={COMMUNITY_HOT_TAB_OPTIONS}
        />
      ) : null}

      {busy && !items.length && !loadedOnce ? (
        <p className="corpus-hot__status text-[var(--text-muted)]">加载{scopeLabel}热词…</p>
      ) : err ? (
        <p className="corpus-hot__status text-[var(--warn,#fbbf24)]">热词加载失败：{err}</p>
      ) : !items.length && loadedOnce ? (
        <p className="corpus-hot__status text-[var(--text-muted)]">
          {tab === "fleet"
            ? "暂无机群热词。各部署开启语料贡献并上报心跳后，这里会展示近24h热词叠加榜。"
            : tab === "pool"
              ? "暂无共享语料高频词。接入并贡献语料后，这里会展示社区累计最热触发词。"
              : "该时段暂无近期活跃热词。可切换到「机群」或「高频池」查看。"}
        </p>
      ) : items.length ? (
        <p className="corpus-hot__status text-[var(--text-muted)]">
          {scopeLabel} · {statusHint}
        </p>
      ) : (
        <p className="corpus-hot__status text-[var(--text-muted)]">加载{scopeLabel}热词…</p>
      )}

      {items.length ? (
        <div
          className={cn("corpus-hot__canvas", cloudLoading && "corpus-hot__canvas--loading")}
          aria-label="共享语料热词云"
        >
          <div
            className={cn(
              "corpus-hot__cloud",
              selectedKeywords && "corpus-hot__cloud--selected",
              cloudEntering && "corpus-hot__cloud--tab-enter",
            )}
            role="list"
          >
            {rankedNodes.map((node, index) => (
              <button
                key={node.item.keywords}
                type="button"
                className={pillClasses(node, selectedKeywords)}
                style={
                  {
                    "--heat": node.scoreRatio.toFixed(3),
                    "--pill-i": String(index),
                  } as CSSProperties
                }
                role="listitem"
                aria-pressed={node.item.keywords === selectedKeywords}
                title={`${node.item.keywords} · 热度 ${node.item.score}`}
                onClick={() => toggleKeyword(node.item.keywords)}
              >
                {node.rank <= 3 ? (
                  <span className="corpus-hot__pill-rank" aria-hidden="true">
                    {node.rank}
                  </span>
                ) : null}
                <span className="corpus-hot__pill-word">{node.item.keywords}</span>
                <span className="corpus-hot__pill-score">{node.item.score}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedItem ? (
        <div className="corpus-hot__detail" aria-live="polite">
          <div className="corpus-hot__detail-panel">
            <div className="corpus-hot__detail-hd">
              <div className="corpus-hot__detail-heading">
                {selectedRank != null && selectedRank <= 3 ? (
                  <span className="corpus-hot__detail-rank">#{selectedRank}</span>
                ) : null}
                <h3 className="corpus-hot__detail-title">{selectedItem.keywords}</h3>
                <p className="corpus-hot__detail-meta text-[var(--text-muted)]">
                  {tab === "pool"
                    ? `累计热度 ${selectedItem.score}`
                    : tab === "fleet"
                      ? `机群叠加热度 ${selectedItem.score}`
                      : `${tabLabel}热度 ${selectedItem.score}`}
                </p>
              </div>
              <button
                type="button"
                className="corpus-hot__detail-close"
                aria-label="收起详情"
                onClick={() => setSelectedKeywords(null)}
              >
                收起
              </button>
            </div>
            <ul className="corpus-hot__reply-list">
              {!selectedItem.answers.length ? (
                <li className="corpus-hot__reply corpus-hot__reply--empty text-[var(--text-muted)]">
                  {tab === "fleet" ? "机群榜不含代表回复" : "暂无代表回复"}
                </li>
              ) : (
                selectedItem.answers.map((answer, idx) => (
                  <li key={`${selectedItem.keywords}-${idx}`} className="corpus-hot__reply">
                    <p className="corpus-hot__reply-text">
                      {answer.message || answer.answer_keywords || "（无文案）"}
                    </p>
                    <p className="corpus-hot__reply-hint text-[var(--text-muted)]">
                      引用 {answer.count} 次
                    </p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
