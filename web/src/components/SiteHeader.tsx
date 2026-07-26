import brandMarkUrl from "@/assets/brand-avatar.png?url";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HubThemeMode } from "@/theme";

const NAV = [
  { href: "#bubble", label: "牛牛" },
  { href: "#metrics", label: "指标" },
  { href: "#gallery", label: "投稿" },
  { href: "#wordcloud", label: "热词" },
] as const;

const THEMES: { mode: HubThemeMode; label: string }[] = [
  { mode: "system", label: "系统" },
  { mode: "light", label: "浅" },
  { mode: "dark", label: "深" },
];

type SiteHeaderProps = {
  subtitle: string;
  subtitleLoading?: boolean;
  themeMode: HubThemeMode;
  onThemeChange: (mode: HubThemeMode) => void;
};

export function SiteHeader({
  subtitle,
  subtitleLoading,
  themeMode,
  onThemeChange,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[var(--content-max)] items-center justify-between gap-3 px-[var(--page-gutter)] py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src={brandMarkUrl} alt="" width={28} height={28} className="rounded-lg" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text)]">Pallas-Bot 社区中心</div>
            <div
              className={cn(
                "truncate text-xs text-[var(--text-muted)]",
                subtitleLoading && "animate-pulse",
              )}
            >
              {subtitle}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav
            className="hidden items-center gap-1 sm:flex"
            aria-label="页面区块"
          >
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div
            className="flex rounded-[var(--radius-control)] border border-[var(--border)] p-0.5"
            role="group"
            aria-label="主题"
          >
            {THEMES.map(({ mode, label }) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "h-7 px-2 text-[11px]",
                  themeMode === mode &&
                    "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text)]",
                )}
                aria-pressed={themeMode === mode}
                onClick={() => onThemeChange(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
