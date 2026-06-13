import { fetchBubbleRoster, fetchCorpusHot, fetchOverview, formatNum } from "./api";
import brandMarkUrl from "./assets/favicon.png?url";
import { BubbleWall } from "./bubble";
import { renderOverview, renderOverviewError } from "./overview";
import { CorpusWordCloud } from "./wordCloud";
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

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <header class="site-header" data-site-header>
    <div class="site-header__brand">
      <img class="site-header__logo" src="${brandMarkUrl}" width="32" height="32" alt="" />
      <div>
        <div class="site-header__title">Pallas 社区中心</div>
        <div class="site-header__sub" data-header-sub>加载中…</div>
      </div>
    </div>
    <a class="site-header__link" href="#overview">查看概览</a>
  </header>

  <main>
    <section id="bubble" class="section section--bubble">
      <div class="section__intro">
        <h1>在线牛牛</h1>
        <p class="section__legend" data-bubble-legend>加载名册中…</p>
      </div>
      <div class="bubble-shell">
        <div data-bubble-empty class="bubble-empty" hidden></div>
        <div data-bubble-canvas class="bubble-canvas"></div>
      </div>
      <a class="scroll-hint" href="#wordcloud">向下查看热词云 ↓</a>
    </section>

    <section id="wordcloud" class="section section--hot">
      <div class="section__intro">
        <h2>共享语料热词</h2>
        <p class="section__legend" data-hot-legend>进入视口后加载热词…</p>
      </div>
      <div class="corpus-hot-shell">
        <div class="corpus-hot__tabs" data-hot-tabs role="tablist" aria-label="热词时间范围">
          <button type="button" class="corpus-hot__tab corpus-hot__tab--active" data-hot-period="day" role="tab" aria-selected="true">今日</button>
          <button type="button" class="corpus-hot__tab" data-hot-period="week" role="tab" aria-selected="false">本周</button>
          <button type="button" class="corpus-hot__tab" data-hot-period="month" role="tab" aria-selected="false">本月</button>
        </div>
        <div data-hot-empty class="corpus-hot__empty" hidden></div>
        <div data-hot-cloud class="corpus-hot__cloud" aria-label="热词云"></div>
        <div data-hot-detail class="corpus-hot__detail" aria-live="polite"></div>
      </div>
      <a class="scroll-hint" href="#overview">向下查看社区概览 ↓</a>
    </section>

    <section id="overview" class="section section--overview">
      <div class="section__intro">
        <h2>社区概览</h2>
        <p>自愿接入的 Pallas 自托管安装汇总：部署规模、语料与联邦等聚合统计。</p>
      </div>
      <div data-overview-root class="overview-root">
        <div class="skeleton-grid" aria-hidden="true"></div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <p>不上报群号与消息正文；气泡墙仅展示 opt-in 公开的名册与活跃度权重。</p>
    <p>
      <a href="/v1/monitor/overview" target="_blank" rel="noreferrer">监控 JSON</a>
      ·
      <a href="/v1/roster/bubble" target="_blank" rel="noreferrer">名册 JSON</a>
      ·
      <a href="https://github.com/PallasBot/Pallas-Bot" target="_blank" rel="noreferrer">Pallas-Bot</a>
    </p>
  </footer>
`;

const headerSub = document.querySelector<HTMLElement>("[data-header-sub]")!;
const overviewRoot = document.querySelector<HTMLElement>("[data-overview-root]")!;
const header = document.querySelector<HTMLElement>("[data-site-header]")!;
const bubbleSection = document.querySelector<HTMLElement>("#bubble")!;
const hotSection = document.querySelector<HTMLElement>("#wordcloud")!;

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    const overview = await fetchOverview();
    renderOverview(overviewRoot, overview);
    const dep = overview.deployments;
    headerSub.textContent = `在线 ${formatNum(dep.deployments_online)} 套 · ${formatNum(dep.bots_online_sum)} 只牛`;
  } catch (err) {
    renderOverviewError(overviewRoot, err instanceof Error ? err.message : String(err));
    headerSub.textContent = "概览暂不可用";
  }

  const wall = new BubbleWall(bubbleSection);
  wall.observe(async () => {
    const data = await fetchBubbleRoster();
    headerSub.textContent = `在线 ${formatNum(data.bots_online)} / ${formatNum(data.bots_total)} 只公开牛`;
    return data.bots;
  });

  const hotCloud = new CorpusWordCloud(hotSection);
  hotCloud.observe((period) => fetchCorpusHot(period));

  window.addEventListener(
    "scroll",
    () => {
      header.classList.toggle("site-header--elevated", window.scrollY > 8);
    },
    { passive: true },
  );
}
