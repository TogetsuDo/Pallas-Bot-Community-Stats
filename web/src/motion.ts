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
  requestAnimationFrame(() => {
    document.body.classList.remove("app-booting");
    document.body.classList.add("app-ready");
  });
}
