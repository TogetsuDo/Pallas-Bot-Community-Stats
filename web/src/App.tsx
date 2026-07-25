import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { fetchOverview } from "@/api";
import { BubbleSection } from "@/components/BubbleSection";
import { Hero } from "@/components/Hero";
import { MetricsStrip } from "@/components/MetricsStrip";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { WordCloudSection } from "@/components/WordCloudSection";
import { GallerySection } from "@/components/GallerySection";
import { useHubTheme } from "@/hooks/useHubTheme";

export function App() {
  const { mode, setTheme } = useHubTheme();
  const [headerSub, setHeaderSub] = useState("同步社区数据…");
  const [headerLoading, setHeaderLoading] = useState(true);

  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    staleTime: 60_000,
    retry: 1,
  });

  const onHeaderStats = useCallback((text: string) => {
    setHeaderSub(text);
    setHeaderLoading(false);
  }, []);

  const onHeaderError = useCallback(() => {
    setHeaderSub("名册暂不可用");
    setHeaderLoading(false);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SiteHeader
        subtitle={headerSub}
        subtitleLoading={headerLoading}
        themeMode={mode}
        onThemeChange={setTheme}
      />
      <Hero />
      <main>
        <BubbleSection onHeaderStats={onHeaderStats} onHeaderError={onHeaderError} />
        <MetricsStrip
          data={overview.data}
          loading={overview.isLoading}
          error={overview.error ? (overview.error as Error).message : null}
        />
        <WordCloudSection />
        <GallerySection />
      </main>
      <SiteFooter />
    </div>
  );
}
