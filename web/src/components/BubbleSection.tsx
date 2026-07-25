import { useEffect, useRef } from "react";
import { fetchBubbleRoster, formatNum, type BubbleBot } from "@/api";

type BubbleSectionProps = {
  onHeaderStats?: (text: string) => void;
  onHeaderError?: () => void;
};

export function BubbleSection({ onHeaderStats, onHeaderError }: BubbleSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const onHeaderStatsRef = useRef(onHeaderStats);
  const onHeaderErrorRef = useRef(onHeaderError);
  onHeaderStatsRef.current = onHeaderStats;
  onHeaderErrorRef.current = onHeaderError;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    let cancelled = false;
    let wall: { destroy: () => void } | null = null;

    void (async () => {
      const [{ BotListPanel }, { BubbleWall }] = await Promise.all([
        import("@/botList"),
        import("@/bubble"),
      ]);
      if (cancelled || !sectionRef.current) return;

      const botList = new BotListPanel(section);
      const bubbleWall = new BubbleWall(section, {
        onBotsChange: (bots: BubbleBot[]) => botList.update(bots),
      });
      wall = bubbleWall;

      bubbleWall.observe(async () => {
        try {
          const data = await fetchBubbleRoster();
          onHeaderStatsRef.current?.(
            `在线 ${formatNum(data.bots_online)} / ${formatNum(data.bots_total)} 只公开牛`,
          );
          return data.bots;
        } catch (err) {
          onHeaderErrorRef.current?.();
          throw err;
        }
      });
    })();

    return () => {
      cancelled = true;
      wall?.destroy();
    };
  }, []);

  return (
    <section
      id="bubble"
      ref={sectionRef}
      className="section section--bubble scroll-mt-20 border-b border-[var(--border)] py-12 sm:py-14"
    >
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)]">
        <div className="section__intro mb-5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Roster
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-[var(--text)]">在线牛牛</h2>
            <div
              className="bubble-view-toggle"
              data-bubble-view-toggle
              role="group"
              aria-label="气泡墙视图"
            >
              <button
                type="button"
                className="bubble-view-toggle__btn bubble-view-toggle__btn--active"
                data-bubble-view="flat"
                aria-pressed="true"
              >
                平铺
              </button>
              <button
                type="button"
                className="bubble-view-toggle__btn"
                data-bubble-view="sphere"
                aria-pressed="false"
              >
                立体
              </button>
            </div>
          </div>
          <p className="bubble-section__legend mt-2 text-sm text-[var(--text-muted)]" data-bubble-legend>
            加载名册气泡…
          </p>
        </div>

        <div className="bubble-shell tech-shell">
          <div data-bubble-empty className="bubble-empty" hidden />
          <div data-bubble-canvas className="bubble-canvas bubble-canvas--loading">
            <div className="bubble-loading-shimmer" aria-hidden="true" />
          </div>
        </div>

        <div className="bot-list">
          <div className="bot-list__hd">
            <button type="button" className="bot-list__toggle" data-bot-list-toggle aria-expanded="false">
              查看全部牛牛
            </button>
            <span className="bot-list__count" data-bot-list-count>
              上报公开 0 只 · 在线 0 只
            </span>
          </div>
          <div data-bot-list-panel className="bot-list__panel" hidden>
            <div className="bot-list__filters" role="tablist" aria-label="牛牛筛选">
              <button
                type="button"
                className="bot-list__filter bot-list__filter--active"
                data-bot-filter="all"
                role="tab"
                aria-selected="true"
              >
                全部
              </button>
              <button
                type="button"
                className="bot-list__filter"
                data-bot-filter="online"
                role="tab"
                aria-selected="false"
              >
                在线
              </button>
              <button
                type="button"
                className="bot-list__filter"
                data-bot-filter="offline"
                role="tab"
                aria-selected="false"
              >
                离线
              </button>
            </div>
            <div data-bot-list-host className="bot-list__host" />
          </div>
        </div>
      </div>
    </section>
  );
}
