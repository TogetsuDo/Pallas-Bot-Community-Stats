import type { GalleryPost } from "@/api/gallery";

export type GalleryAdminStatus = {
  ok: boolean;
  enabled: boolean;
  authenticated: boolean;
};

export type GalleryAdminPost = GalleryPost & {
  deployment_id: string;
  has_image: boolean;
};

export type GalleryAdminListData = {
  as_of: string;
  posts: GalleryAdminPost[];
  next_cursor: string | null;
};

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

export async function fetchGalleryAdminPosts(limit = 48, cursor?: string | null): Promise<GalleryAdminListData> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
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
