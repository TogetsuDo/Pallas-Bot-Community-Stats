import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchGalleryPosts, type GalleryPost } from "@/api/gallery";
import "@/styles/gallery.css";

const VISIBLE = 3;
const ROTATE_MS = 3800;
const FLAKE_COUNT = 8;

function truncateQuote(text: string, max = 14): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function pickFlakes(posts: GalleryPost[], n: number): string[] {
  const pool = posts.map((p) => p.text.trim()).filter(Boolean);
  if (!pool.length) return [];
  const out: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < Math.min(n, pool.length) && guard < 40) {
    guard += 1;
    const raw = pool[Math.floor(Math.random() * pool.length)]!;
    const q = truncateQuote(raw);
    if (used.has(q)) continue;
    used.add(q);
    out.push(q);
  }
  return out;
}

function shortTime(unix: number): string {
  try {
    return new Date(unix * 1000).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function MessageCard({ post }: { post: GalleryPost }) {
  return (
    <article className="gallery-msg">
      {post.avatar_url ? (
        <img className="gallery-msg__avatar" src={post.avatar_url} alt="" width={36} height={36} />
      ) : (
        <div className="gallery-msg__avatar gallery-msg__avatar--fallback" aria-hidden="true" />
      )}
      <div className="gallery-msg__body">
        <div className="gallery-msg__meta">
          <span className="gallery-msg__name">{post.nickname || "牛牛"}</span>
          <span className="gallery-msg__time">{shortTime(post.created_unix)}</span>
        </div>
        {post.text ? <p className="gallery-msg__bubble">{post.text}</p> : null}
      </div>
    </article>
  );
}

function ImageTile({ post }: { post: GalleryPost }) {
  return (
    <article className="gallery-shot" title={shortTime(post.created_unix)}>
      <img src={post.image_url!} alt="" loading="lazy" />
    </article>
  );
}

function GalleryItem({ post }: { post: GalleryPost }) {
  if (post.image_url) return <ImageTile post={post} />;
  return <MessageCard post={post} />;
}

export function GallerySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [topIndex, setTopIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const [flakes, setFlakes] = useState<string[]>([]);
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void fetchGalleryPosts(48)
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
        setFlakes(pickFlakes(data.posts, FLAKE_COUNT));
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (reduceMotion || posts.length <= 1) return;
    const timer = window.setInterval(() => {
      setTopIndex((i) => (i + 1) % posts.length);
      setTick((t) => t + 1);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [posts, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || !posts.length) return;
    setFlakes(pickFlakes(posts, FLAKE_COUNT));
    const timer = window.setInterval(() => {
      setFlakes(pickFlakes(posts, FLAKE_COUNT));
    }, 14000);
    return () => window.clearInterval(timer);
  }, [posts, reduceMotion]);

  const visible = useMemo(() => {
    if (!posts.length) return [];
    const count = Math.min(VISIBLE, posts.length);
    const out: GalleryPost[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(posts[(topIndex + i) % posts.length]!);
    }
    return out;
  }, [posts, topIndex]);

  return (
    <section
      id="gallery"
      ref={sectionRef}
      className="scroll-mt-20 border-b border-[var(--border)] py-12 sm:py-14"
    >
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)]">
        <div className="mb-5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Gallery
          </p>
          <h2 className="text-xl font-semibold text-[var(--text)]">社区投稿</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            纯文字以聊天气泡轮换；带图投稿直接展示截图。正文碎片会轻轻飘落。
          </p>
        </div>

        {!enabled || loading ? (
          <div className="gallery-stage gallery-stage--empty text-sm text-[var(--text-muted)]">
            {enabled ? "加载投稿…" : "进入视口后加载投稿…"}
          </div>
        ) : error ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
            投稿加载失败：{error}
          </p>
        ) : !posts.length ? (
          <div className="gallery-stage gallery-stage--empty text-sm text-[var(--text-muted)]">
            暂无投稿。可在 Bot 控制台「社区统计与语料 → 社区投稿」添加。
          </div>
        ) : (
          <div className="gallery-stage">
            {!reduceMotion
              ? flakes.map((quote, i) => (
                  <span
                    key={`flake-${i}-${quote}`}
                    className="gallery-flake"
                    style={
                      {
                        "--flake-x": `${6 + ((i * 19) % 88)}%`,
                        "--flake-delay": `${(i % 7) * 1.1}s`,
                        "--flake-dur": `${8 + (i % 5) * 1.2}s`,
                      } as CSSProperties
                    }
                  >
                    {quote}
                  </span>
                ))
              : null}
            <div className="gallery-rail" aria-live="polite">
              {visible.map((post, i) => (
                <div
                  key={`${post.id}-${topIndex}-${i}-${tick}`}
                  className="gallery-rail__slot"
                  data-focus={i === 0 ? "1" : "0"}
                  data-enter={reduceMotion ? "0" : "1"}
                >
                  <GalleryItem post={post} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
