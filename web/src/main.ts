import { fetchBubbleRoster, fetchOverview, formatNum } from "./api";
import brandMarkUrl from "./assets/favicon.png?url";
import { BubbleWall } from "./bubble";
import { renderOverview, renderOverviewError } from "./overview";
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
    <a class="site-header__link" href="#bubble">查看牛牛</a>
  </header>

  <main>
    <section id="overview" class="section section--overview">
      <div class="section__intro">
        <h1>社区概览</h1>
        <p>自愿接入的 Pallas 自托管安装汇总。向下滚动查看公开名册的在线牛牛气泡墙。</p>
      </div>
      <div data-overview-root class="overview-root">
        <div class="skeleton-grid" aria-hidden="true"></div>
      </div>
      <a class="scroll-hint" href="#bubble">向下查看在线牛牛 ↓</a>
    </section>

    <section id="bubble" class="section section--bubble">
      <div class="section__intro">
        <h2>在线牛牛</h2>
        <p class="section__legend" data-bubble-legend>进入此区域后加载名册…</p>
      </div>
      <div class="bubble-shell">
        <div data-bubble-empty class="bubble-empty" hidden></div>
        <div data-bubble-canvas class="bubble-canvas"></div>
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

  window.addEventListener(
    "scroll",
    () => {
      header.classList.toggle("site-header--elevated", window.scrollY > 8);
    },
    { passive: true },
  );
}
