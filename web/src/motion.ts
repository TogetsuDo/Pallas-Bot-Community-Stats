function dismissBootSplash(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.classList.add("boot-splash--hide");
  splash.setAttribute("aria-busy", "false");
  const remove = () => splash.remove();
  splash.addEventListener("transitionend", remove, { once: true });
  window.setTimeout(remove, 520);
}

/** 页面壳已渲染：关闭启动屏并淡入主内容 */
export function markShellReady(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove("app-booting");
      document.body.classList.add("app-ready");
      dismissBootSplash();
    });
  });
}

export function initSectionMotion(root: ParentNode = document): void {
  const sections = root.querySelectorAll<HTMLElement>(".section[data-reveal]");
  if (!sections.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    sections.forEach((el) => el.classList.add("section--visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("section--visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
  );

  sections.forEach((el, index) => {
    el.style.setProperty("--section-i", String(index));
    observer.observe(el);
  });
}

export function markAppReady(): void {
  markShellReady();
}
