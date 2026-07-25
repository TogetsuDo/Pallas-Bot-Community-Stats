export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)] py-10">
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)] text-sm text-[var(--text-muted)]">
        <p className="mb-3 max-w-2xl leading-relaxed">
          不上报群号与消息正文；气泡墙仅展示 opt-in 公开的名册与活跃度权重。
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <a
            className="underline-offset-2 hover:text-[var(--text)] hover:underline"
            href="https://github.com/PallasBot/Pallas-Bot"
            target="_blank"
            rel="noreferrer"
          >
            Pallas-Bot
          </a>
          <span aria-hidden="true">·</span>
          <a
            className="underline-offset-2 hover:text-[var(--text)] hover:underline"
            href="https://PallasBot.github.io/Pallas-Bot-Docs/"
            target="_blank"
            rel="noreferrer"
          >
            文档
          </a>
          <span aria-hidden="true">·</span>
          <a
            className="underline-offset-2 hover:text-[var(--text)] hover:underline"
            href="https://github.com/TogetsuDo/Pallas-Bot-Community-Stats"
            target="_blank"
            rel="noreferrer"
          >
            Community-Stats
          </a>
        </p>
      </div>
    </footer>
  );
}
