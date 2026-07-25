import brandMarkUrl from "@/assets/brand-avatar.png?url";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section
      className="relative overflow-hidden border-b border-[var(--border)]"
      aria-label="品牌介绍"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 78% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%), radial-gradient(ellipse 50% 40% at 10% 20%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%)",
        }}
      />
      <div className="relative mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)] pb-16 pt-14 sm:pb-20 sm:pt-20">
        <img
          src={brandMarkUrl}
          alt="Pallas"
          width={88}
          height={88}
          className="mb-6 rounded-[18px] shadow-[0_12px_40px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
          decoding="async"
        />
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--accent)_85%,white)]">
          Pallas
        </p>
        <h1 className="mb-4 max-w-xl text-4xl font-bold tracking-tight text-[var(--text)] sm:text-5xl">
          社区中心
        </h1>
        <p className="mb-8 max-w-lg text-[15px] leading-relaxed text-[var(--text-muted)]">
          公开名册、在线部署与共享语料的社区入口。不上报群号与消息正文；气泡墙仅展示
          opt-in 公开的名册。
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a href="#bubble">查看在线牛牛</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a
              href="https://github.com/TogetsuDo/Pallas-Bot-Community-Stats/blob/main/docs/API.md"
              target="_blank"
              rel="noreferrer"
            >
              API 文档
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
