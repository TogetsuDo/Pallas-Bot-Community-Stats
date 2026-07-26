import type { GalleryPost } from "@/api/gallery";

export type GalleryAdminStatus = {
  ok: boolean;
  enabled: boolean;
  authenticated: boolean;
};

export type GalleryAdminPostStatus = "published" | "pending" | "hidden";

export type GalleryAdminPost = GalleryPost & {
  deployment_id: string;
  has_image: boolean;
  status: GalleryAdminPostStatus;
};

export type GalleryAdminListData = {
  as_of: string;
  posts: GalleryAdminPost[];
  next_cursor: string | null;
};

export type GalleryAdminListFilter = "published" | "pending" | "all";

async function readErrorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { detail?: string };
    if (typeof body.detail === "string" && body.detail) return body.detail;
  } catch {
    /* ignore */
  }
  return `admin ${resp.status}`;
}

export async function fetchGalleryAdminStatus(): Promise<GalleryAdminStatus> {
  const resp = await fetch("/v1/gallery/admin/status", { credentials: "include" });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
  return resp.json() as Promise<GalleryAdminStatus>;
}

export async function loginGalleryAdmin(secret: string): Promise<void> {
  const resp = await fetch("/v1/gallery/admin/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
}

export async function logoutGalleryAdmin(): Promise<void> {
  const resp = await fetch("/v1/gallery/admin/logout", {
    method: "POST",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
}

export async function fetchGalleryAdminPosts(
  limit = 48,
  opts?: { cursor?: string | null; status?: GalleryAdminListFilter },
): Promise<GalleryAdminListData> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.status) params.set("status", opts.status);
  const resp = await fetch(`/v1/gallery/admin/posts?${params}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
  return resp.json() as Promise<GalleryAdminListData>;
}

export async function deleteGalleryAdminPost(id: string): Promise<void> {
  const resp = await fetch(`/v1/gallery/admin/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
}

export async function approveGalleryAdminPost(id: string): Promise<void> {
  const resp = await fetch(`/v1/gallery/admin/posts/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
}

export async function rejectGalleryAdminPost(id: string): Promise<void> {
  const resp = await fetch(`/v1/gallery/admin/posts/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp));
}
