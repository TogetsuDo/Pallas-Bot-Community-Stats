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

export async function fetchGalleryPosts(limit = 48): Promise<GalleryListData> {
  const params = new URLSearchParams({ limit: String(limit) });
  const resp = await fetch(`/v1/gallery/posts?${params}`);
  if (!resp.ok) throw new Error(`gallery ${resp.status}`);
  return resp.json() as Promise<GalleryListData>;
}
