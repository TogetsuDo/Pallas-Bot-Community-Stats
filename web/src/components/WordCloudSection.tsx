import { useEffect, useRef, useState } from "react";
import CorpusWordCloud from "@/components/CorpusWordCloud";

export function WordCloudSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        setEnabled(true);
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="wordcloud"
      ref={sectionRef}
      className="scroll-mt-20 py-12 sm:py-14"
    >
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)]">
        <div className="mb-5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Corpus
          </p>
          <h2 className="text-xl font-semibold text-[var(--text)]">共享语料热词</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            与控制台社区语料热词同一套交互：点选查看热度与代表回复。
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          {enabled ? (
            <CorpusWordCloud enabled />
          ) : (
            <p className="m-0 text-sm text-[var(--text-muted)]">进入视口后加载热词云…</p>
          )}
        </div>
      </div>
    </section>
  );
}
