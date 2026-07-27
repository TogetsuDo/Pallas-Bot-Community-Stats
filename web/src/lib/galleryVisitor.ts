const VISITOR_KEY = "pallas-gallery-visitor-id";

export function getGalleryVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY)?.trim();
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
