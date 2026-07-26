import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  deleteGalleryAdminPost,
  fetchGalleryAdminPosts,
  fetchGalleryAdminStatus,
  loginGalleryAdmin,
  logoutGalleryAdmin,
  type GalleryAdminPost,
} from "@/api/galleryAdmin";
import { Button } from "@/components/ui/button";
import { useHubTheme } from "@/hooks/useHubTheme";
import { cn } from "@/lib/utils";

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

function truncate(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function AdminPostRow({
  post,
  busy,
  onDelete,
}: {
  post: GalleryAdminPost;
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-[var(--text)]">{post.nickname || "牛牛"}</span>
            <span className="text-xs text-[var(--text-muted)]">{shortTime(post.created_unix)}</span>
            {post.has_image ? (
              <span className="rounded bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--text)]">
                有图
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text)]">
            {post.text ? truncate(post.text) : post.has_image ? "（仅图片）" : "（空）"}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{post.id}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          disabled={busy}
          onClick={() => onDelete(post.id)}
        >
          删除
        </Button>
      </div>
    </li>
  );
}

export function AdminPage() {
  const { mode, setTheme } = useHubTheme();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["gallery-admin-status"],
    queryFn: fetchGalleryAdminStatus,
    staleTime: 30_000,
    retry: 1,
  });

  const posts = useQuery({
    queryKey: ["gallery-admin-posts"],
    queryFn: () => fetchGalleryAdminPosts(48),
    enabled: Boolean(status.data?.authenticated),
    staleTime: 15_000,
  });

  const login = useMutation({
    mutationFn: () => loginGalleryAdmin(secret),
    onSuccess: async () => {
      setSecret("");
      setLoginError(null);
      await queryClient.invalidateQueries({ queryKey: ["gallery-admin-status"] });
      await queryClient.invalidateQueries({ queryKey: ["gallery-admin-posts"] });
    },
    onError: (err: Error) => setLoginError(err.message),
  });

  const logout = useMutation({
    mutationFn: logoutGalleryAdmin,
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["gallery-admin-status"] });
      queryClient.removeQueries({ queryKey: ["gallery-admin-posts"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteGalleryAdminPost(id),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["gallery-admin-posts"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const onLogin = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  const onDelete = (id: string) => {
    if (!window.confirm("确定从公开投稿墙撤下这条？")) return;
    remove.mutate(id);
  };

  const enabled = status.data?.enabled ?? false;
  const authenticated = status.data?.authenticated ?? false;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-[var(--page-gutter)] py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">社区投稿管理</div>
            <div className="text-xs text-[var(--text-muted)]">中心运维 · 不在主导航展示</div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              回主站
            </a>
            {(["system", "light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn(
                  "rounded-[var(--radius-control)] px-2 py-1 text-[11px]",
                  mode === m ? "bg-[var(--accent-soft)] text-[var(--text)]" : "text-[var(--text-muted)]",
                )}
                onClick={() => setTheme(m)}
              >
                {m === "system" ? "系统" : m === "light" ? "浅" : "深"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-[var(--page-gutter)] py-8">
        {status.isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">检查管理状态…</p>
        ) : status.isError ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
            无法连接管理接口：{(status.error as Error).message}
          </p>
        ) : !enabled ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-sm leading-relaxed text-[var(--text-muted)]">
            管理页未启用。请在中心配置 <code className="font-mono text-[var(--text)]">GALLERY_ADMIN_SECRET</code>
            ，并确保 <code className="font-mono text-[var(--text)]">GALLERY_ENABLED</code> 为 true。
          </div>
        ) : !authenticated ? (
          <form
            onSubmit={onLogin}
            className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-5"
          >
            <h1 className="text-base font-semibold">输入运维密钥</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">验证通过后会话约 12 小时内可连续删帖。</p>
            <label className="mt-4 block text-xs text-[var(--text-muted)]" htmlFor="admin-secret">
              GALLERY_ADMIN_SECRET
            </label>
            <input
              id="admin-secret"
              type="password"
              autoComplete="current-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            {loginError ? <p className="mt-2 text-sm text-red-400">{loginError}</p> : null}
            <Button type="submit" className="mt-4" disabled={!secret.trim() || login.isPending}>
              {login.isPending ? "验证中…" : "进入管理"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-base font-semibold">已发布投稿</h1>
                <p className="text-sm text-[var(--text-muted)]">删除为软隐藏，公开墙立即不再展示。</p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void posts.refetch()}
                  disabled={posts.isFetching}
                >
                  刷新
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                >
                  退出
                </Button>
              </div>
            </div>

            {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}

            {posts.isLoading ? (
              <p className="text-sm text-[var(--text-muted)]">加载投稿…</p>
            ) : posts.isError ? (
              <p className="text-sm text-red-400">{(posts.error as Error).message}</p>
            ) : !posts.data?.posts.length ? (
              <p className="rounded-[var(--radius-md)] border border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                暂无已发布投稿
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {posts.data.posts.map((post) => (
                  <AdminPostRow
                    key={post.id}
                    post={post}
                    busy={remove.isPending}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
