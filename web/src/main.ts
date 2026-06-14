import { fetchBubbleRoster, fetchCorpusHot, fetchOverview, formatNum } from "./api";
import brandMarkUrl from "./assets/favicon.png?url";
import { initSectionMotion, markAppReady } from "./motion";
import {
  renderHeroMetrics,
  renderHeroMetricsError,
  renderOverview,
  renderOverviewError,
} from "./overview";
import { bindHubThemeToggle, initHubTheme } from "./theme";
import "./styles.css";

function ensureFavicon(): void {
  let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    el.type = "image/png";
    document.head.appendChild(el);
  }
  el.href = brandMarkUrl;
}

ensureFavicon();
initHubTheme();
document.body.classList.add("app-booting");

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <div class="app-backdrop" aria-hidden="true"></div>

  <header class="site-header" data-site-header>
    <div class="site-header__brand">
      <img class="site-header__logo" src="${brandMarkUrl}" width="32" height="32" alt="" />
      <div>
        <div class="site-header__title">Pallas 社区中心</div>
        <div class="site-header__sub" data-header-sub>同步社区数据…</div>
      </div>
    </div>
    <div class="site-header__actions">
      <nav class="site-header__nav" aria-label="页面区块">
        <a class="site-header__link" href="#bubble">牛牛</a>
        <a class="site-header__link" href="#overview">概览</a>
        <a class="site-header__link" href="#wordcloud">热词</a>
      </nav>
      <div class="theme-toggle" data-theme-toggle role="group" aria-label="主题">
        <button type="button" class="theme-toggle__btn" data-theme-mode="system" aria-pressed="false" title="跟随系统">系统</button>
        <button type="button" class="theme-toggle__btn" data-theme-mode="light" aria-pressed="false" title="浅色">浅</button>
        <button type="button" class="theme-toggle__btn" data-theme-mode="dark" aria-pressed="false" title="深色">深</button>
      </div>
    </div>
  </header>

  <section class="hero-dashboard" aria-label="实时指标">
    <div class="hero-dashboard__inner">
      <div class="hero-dashboard__label">
        <span class="hero-dashboard__tag">LIVE</span>
        <span>社区实时指标</span>
      </div>
      <div data-hero-metrics class="hero-dashboard__grid">
        <div class="hero-metric hero-metric--skeleton" aria-hidden="true"></div>
        <div class="hero-metric hero-metric--skeleton" aria-hidden="true"></div>
        <div class="hero-metric hero-metric--skeleton" aria-hidden="true"></div>
        <div class="hero-metric hero-metric--skeleton" aria-hidden="true"></div>
      </div>
    </div>
  </section>

  <main class="hub-main">
    <section id="bubble" class="section section--bubble section--visible" data-reveal>
      <div class="section__intro section__intro--tech">
        <span class="section__tag">ROSTER</span>
        <div class="section__head">
          <h2>在线牛牛</h2>
          <div class="bubble-view-toggle" data-bubble-view-toggle role="group" aria-label="气泡墙视图">
            <button type="button" class="bubble-view-toggle__btn bubble-view-toggle__btn--active" data-bubble-view="flat" aria-pressed="true">平铺</button>
            <button type="button" class="bubble-view-toggle__btn" data-bubble-view="sphere" aria-pressed="false">立体</button>
          </div>
        </div>
        <p class="section__legend bubble-section__legend" data-bubble-legend>加载名册气泡…</p>
      </div>
      <div class="bubble-shell tech-shell">
        <div data-bubble-empty class="bubble-empty" hidden></div>
        <div data-bubble-canvas class="bubble-canvas"></div>
      </div>
      <div class="bot-list">
        <div class="bot-list__hd">
          <button type="button" class="bot-list__toggle" data-bot-list-toggle aria-expanded="false">查看全部牛牛</button>
          <span class="bot-list__count" data-bot-list-count>上报公开 0 只 · 在线 0 只</span>
        </div>
        <div data-bot-list-panel class="bot-list__panel" hidden>
          <div class="bot-list__filters" role="tablist" aria-label="牛牛筛选">
            <button type="button" class="bot-list__filter bot-list__filter--active" data-bot-filter="all" role="tab" aria-selected="true">全部</button>
            <button type="button" class="bot-list__filter" data-bot-filter="online" role="tab" aria-selected="false">在线</button>
            <button type="button" class="bot-list__filter" data-bot-filter="offline" role="tab" aria-selected="false">离线</button>
          </div>
          <div data-bot-list-host class="bot-list__host"></div>
        </div>
      </div>
    </section>

    <section id="overview" class="section section--overview" data-reveal>
      <div class="section__intro section__intro--tech">
        <span class="section__tag">OVERVIEW</span>
        <h2>社区概览</h2>
        <p>自愿接入的 Pallas 自托管安装汇总：部署规模、语料与联邦等聚合统计。</p>
      </div>
      <div data-overview-root class="overview-root overview-root--loading">
        <div class="skeleton-dashboard" aria-hidden="true">
          <div class="skeleton-grid"></div>
          <div class="skeleton-panel"></div>
        </div>
      </div>
    </section>

    <section id="wordcloud" class="section section--hot" data-reveal>
      <div class="section__intro section__intro--tech">
        <span class="section__tag">CORPUS</span>
        <h2>共享语料热词</h2>
        <p class="section__legend" data-hot-legend>进入视口后加载热词云…</p>
      </div>
      <div class="corpus-hot-shell tech-shell">
        <div class="corpus-hot__tabs" data-hot-tabs role="tablist" aria-label="热词统计范围">
          <button type="button" class="corpus-hot__tab corpus-hot__tab--active" data-hot-period="fleet" role="tab" aria-selected="true">机群</button>
          <button type="button" class="corpus-hot__tab" data-hot-period="pool" role="tab" aria-selected="false">高频池</button>
          <button type="button" class="corpus-hot__tab" data-hot-period="day" role="tab" aria-selected="false">今日</button>
          <button type="button" class="corpus-hot__tab" data-hot-period="week" role="tab" aria-selected="false">本周</button>
          <button type="button" class="corpus-hot__tab" data-hot-period="month" role="tab" aria-selected="false">本月</button>
        </div>
        <div data-hot-empty class="corpus-hot__empty" hidden></div>
        <div data-hot-canvas class="corpus-hot__canvas" aria-label="共享语料热词云"></div>
        <div data-hot-detail class="corpus-hot__detail" aria-live="polite"></div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="site-footer__inner glass-surface">
      <p>不上报群号与消息正文；气泡墙仅展示 opt-in 公开的名册与活跃度权重。</p>
      <p>
        <a href="https://github.com/PallasBot/Pallas-Bot" target="_blank" rel="noreferrer">Pallas-Bot</a>
        ·
        <a href="https://PallasBot.github.io/Pallas-Bot-Docs/" target="_blank" rel="noreferrer">文档</a>
      </p>
    </div>
  </footer>
`;

bindHubThemeToggle();

const headerSub = document.querySelector<HTMLElement>("[data-header-sub]")!;
const overviewRoot = document.querySelector<HTMLElement>("[data-overview-root]")!;
const heroMetrics = document.querySelector<HTMLElement>("[data-hero-metrics]")!;
const header = document.querySelector<HTMLElement>("[data-site-header]")!;
const bubbleSection = document.querySelector<HTMLElement>("#bubble")!;
const hotSection = document.querySelector<HTMLElement>("#wordcloud")!;

initSectionMotion();

const overviewPromise = fetchOverview();
const rosterPromise = fetchBubbleRoster();

void bootstrap();
void loadOverviewPanels(overviewPromise);

async function bootstrap(): Promise<void> {
  const [{ BotListPanel }, { BubbleWall }] = await Promise.all([
    import("./botList"),
    import("./bubble"),
  ]);

  const botList = new BotListPanel(bubbleSection);
  const wall = new BubbleWall(bubbleSection, {
    onBotsChange: (bots) => botList.update(bots),
  });
  wall.observe(async () => {
    const data = await rosterPromise;
    headerSub.textContent = `在线 ${formatNum(data.bots_online)} / ${formatNum(data.bots_total)} 只公开牛`;
    return data.bots;
  });

  initWordCloudWhenVisible();

  window.addEventListener(
    "scroll",
    () => {
      header.classList.toggle("site-header--elevated", window.scrollY > 8);
    },
    { passive: true },
  );
}

function initWordCloudWhenVisible(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void (async () => {
        const { CorpusWordCloud } = await import("./wordCloud");
        const hotCloud = new CorpusWordCloud(hotSection);
        hotCloud.observe((tab) => fetchCorpusHot(tab));
      })();
    },
    { rootMargin: "120px 0px" },
  );
  observer.observe(hotSection);
}

async function loadOverviewPanels(overviewReq: Promise<Awaited<ReturnType<typeof fetchOverview>>>): Promise<void> {
  try {
    const overview = await overviewReq;
    renderHeroMetrics(heroMetrics, overview);
    renderOverview(overviewRoot, overview);
    const dep = overview.deployments;
    headerSub.textContent = `在线 ${formatNum(dep.deployments_online)} 套 · ${formatNum(dep.bots_online_sum)} 只牛`;
  } catch (err) {
    renderHeroMetricsError(heroMetrics);
    renderOverviewError(overviewRoot, err instanceof Error ? err.message : String(err));
    headerSub.textContent = "概览暂不可用";
  } finally {
    markAppReady();
  }
}
