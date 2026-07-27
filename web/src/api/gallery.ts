export type GalleryPost = {
  id: string;
  text: string;
  source: "manual" | "local_corpus";
  keywords: string;
  nickname: string;
  avatar_url: string;
  qq?: number | null;
  image_url?: string | null;
  created_at: string;
  created_unix: number;
};

export type GalleryListData = {
  as_of: string;
  posts: GalleryPost[];
  next_cursor: string | null;
};

export type GalleryCreateResult = {
  id: string;
  created_at: string;
  status: "published" | "pending" | "hidden";
};

const GALLERY_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function fetchGalleryPosts(limit = 48): Promise<GalleryListData> {
  const params = new URLSearchParams({ limit: String(limit) });
  const resp = await fetch(`/v1/gallery/posts?${params}`);
  if (!resp.ok) throw new Error(`gallery ${resp.status}`);
  return resp.json() as Promise<GalleryListData>;
}

export function isGalleryImageType(type: string): boolean {
  return GALLERY_IMAGE_TYPES.has(type);
}

export async function createPublicGalleryPost(opts: {
  visitorId: string;
  image: File;
  nickname?: string;
  text?: string;
}): Promise<GalleryCreateResult> {
  const form = new FormData();
  form.append("visitor_id", opts.visitorId);
  form.append("image", opts.image, opts.image.name || "upload");
  if (opts.nickname?.trim()) form.append("nickname", opts.nickname.trim());
  if (opts.text?.trim()) form.append("text", opts.text.trim());

  const resp = await fetch("/v1/gallery/public/posts", {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    let detail = `投稿失败（${resp.status}）`;
    try {
      const body = (await resp.json()) as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    } catch {
      /* ignore */
    }
    if (resp.status === 429) detail = "投稿太频繁，请稍后再试";
    if (resp.status === 422) detail = "内容未通过审核，请更换图片后重试";
    throw new Error(detail);
  }
  return resp.json() as Promise<GalleryCreateResult>;
}
