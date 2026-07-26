import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchGalleryPosts, type GalleryPost } from "@/api/gallery";
import "@/styles/gallery.css";

const ROTATE_MS = 4200;
const FLAKE_COUNT = 8;

function truncateQuote(text: string, max = 14): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function pickFlakes(posts: GalleryPost[], n: number): string[] {
  const pool = posts.map((p) => p.text.trim()).filter(Boolean);
  if (!pool.length) return [];
  const out: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < Math.min(n, pool.length) && guard < 48) {
    guard += 1;
    const raw = pool[Math.floor(Math.random() * pool.length)]!;
    const q = truncateQuote(raw);
    if (used.has(q)) continue;
    used.add(q);
    out.push(q);
  }
  return out;
}

function pickRandomVisible(posts: GalleryPost[], count: number): GalleryPost[] {
  if (!posts.length) return [];
  if (posts.length <= count) return shuffle(posts);
  return shuffle(posts).slice(0, count);
}

function pickReplacement(posts: GalleryPost[], visible: GalleryPost[], replaceId: string): GalleryPost {
  const visibleIds = new Set(visible.map((p) => p.id));
  const fresh = posts.filter((p) => !visibleIds.has(p.id));
  if (fresh.length) {
    return fresh[Math.floor(Math.random() * fresh.length)]!;
  }
  const others = posts.filter((p) => p.id !== replaceId);
  if (others.length) {
    return others[Math.floor(Math.random() * others.length)]!;
  }
  return posts[0]!;
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

function useVisibleSlotCount(): number {
  const [count, setCount] = useState(3);
  useEffect(() => {
    const mqNarrow = window.matchMedia("(max-width: 560px)");
    const mqMid = window.matchMedia("(max-width: 720px)");
    const update = () => {
      if (mqNarrow.matches) setCount(1);
      else if (mqMid.matches) setCount(2);
      else setCount(3);
    };
    update();
    mqNarrow.addEventListener("change", update);
    mqMid.addEventListener("change", update);
    return () => {
      mqNarrow.removeEventListener("change", update);
      mqMid.removeEventListener("change", update);
    };
  }, []);
  return count;
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
  const slotCount = useVisibleSlotCount();
  const postsRef = useRef<GalleryPost[]>([]);
  const rotateSlotRef = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState<GalleryPost[]>([]);
  const [focusSlot, setFocusSlot] = useState(0);
  const [flakes, setFlakes] = useState<string[]>([]);
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  postsRef.current = posts;

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
        const shuffled = shuffle(data.posts);
        setPosts(shuffled);
        setFlakes(pickFlakes(shuffled, FLAKE_COUNT));
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
    if (!posts.length) return;
    setVisible((prev) => {
      const keep = prev.filter((p) => posts.some((x) => x.id === p.id)).slice(0, slotCount);
      if (keep.length === slotCount) return keep;
      const filler = pickRandomVisible(
        posts.filter((p) => !keep.some((k) => k.id === p.id)),
        slotCount - keep.length,
      );
      return [...keep, ...filler].slice(0, slotCount);
    });
  }, [posts, slotCount]);

  useEffect(() => {
    if (reduceMotion || posts.length <= 1) return;
    const timer = window.setInterval(() => {
      const pool = postsRef.current;
      if (pool.length <= 1) return;

      let swapped = -1;
      setVisible((prev) => {
        if (!prev.length) return prev;
        let useSlot = rotateSlotRef.current % prev.length;
        rotateSlotRef.current += 1;
        if (prev.length > 1 && Math.random() < 0.4) {
          useSlot = Math.floor(Math.random() * prev.length);
        }
        const current = prev[useSlot]!;
        const nextPost = pickReplacement(pool, prev, current.id);
        if (nextPost.id === current.id) return prev;
        const next = [...prev];
        next[useSlot] = nextPost;
        swapped = useSlot;
        return next;
      });
      if (swapped >= 0) setFocusSlot(swapped);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [posts.length, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || !posts.length) return;
    setFlakes(pickFlakes(posts, FLAKE_COUNT));
    const timer = window.setInterval(() => {
      setFlakes(pickFlakes(posts, FLAKE_COUNT));
    }, 14000);
    return () => window.clearInterval(timer);
  }, [posts, reduceMotion]);

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
            随机抽取展示；每次只轮换一张，淡入切换。正文碎片会轻轻飘落。
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
                        "--flake-x": `${8 + ((i * 17 + (i % 3) * 11) % 84)}%`,
                        "--flake-delay": `${(i % 7) * 1.05}s`,
                        "--flake-dur": `${8.5 + (i % 5) * 1.15}s`,
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
                  key={post.id}
                  className="gallery-rail__slot"
                  data-focus={i === focusSlot ? "1" : "0"}
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
