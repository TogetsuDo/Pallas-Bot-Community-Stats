import { useCallback, useEffect, useMemo, useState, type ClipboardEvent, type DragEvent } from "react";
import { createPublicGalleryPost, isGalleryImageType } from "@/api/gallery";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { useHubTheme } from "@/hooks/useHubTheme";
import { getGalleryVisitorId } from "@/lib/galleryVisitor";
import { cn } from "@/lib/utils";

function pickClipboardImage(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const file of Array.from(dt.files || [])) {
    if (isGalleryImageType(file.type)) return file;
  }
  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== "file" || !isGalleryImageType(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export function SubmitPage() {
  const { mode, setTheme } = useHubTheme();
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<"published" | "pending" | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const imagePreviewUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => {
    if (!imagePreviewUrl) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  const applyImageFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!isGalleryImageType(file.type)) {
      setError("仅支持 JPEG / PNG / WebP / GIF");
      return;
    }
    setError(null);
    setImage(file);
    setSuccess(null);
  }, []);

  const onPasteImage = useCallback(
    (e: ClipboardEvent) => {
      const file = pickClipboardImage(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      applyImageFile(file);
    },
    [applyImageFile],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = Array.from(e.dataTransfer.files || []).find((f) => isGalleryImageType(f.type));
      applyImageFile(file);
    },
    [applyImageFile],
  );

  async function onSubmit() {
    if (!image) {
      setError("请先选择或粘贴一张图片");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await createPublicGalleryPost({
        visitorId: getGalleryVisitorId(),
        image,
      });
      setSuccess(result.status === "pending" ? "pending" : "published");
      setImage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]" onPaste={onPasteImage}>
      <SiteHeader
        subtitle="投稿图片到社区墙"
        themeMode={mode}
        onThemeChange={setTheme}
      />
      <main className="mx-auto max-w-[var(--content-max)] px-[var(--page-gutter)] py-8 sm:py-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Submit
            </p>
            <h1 className="text-xl font-semibold text-[var(--text)]">我要投稿</h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--text-muted)]">
              上传截图或梗图，审核通过后会出现在首页「社区投稿」墙。提交即公开展示，请勿上传含隐私信息的截图。
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/#gallery">返回投稿墙</a>
          </Button>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          <div className="space-y-3">
            <div className="text-sm font-medium text-[var(--text)]">图片</div>
            <label
              className={cn(
                "flex min-h-[240px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed px-4 py-8 text-center transition-colors",
                dragOver
                  ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  : "border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_3%,transparent)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--border))]",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => applyImageFile(e.target.files?.[0])}
              />
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt="投稿预览"
                  className="max-h-64 max-w-full rounded-[var(--radius-sm)] object-contain"
                />
              ) : (
                <>
                  <div className="text-sm text-[var(--text)]">点击选择、拖拽或 Ctrl+V 粘贴图片</div>
                  <div className="text-xs text-[var(--text-muted)]">JPEG / PNG / WebP / GIF，最大约 3MB</div>
                </>
              )}
            </label>
            {image ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setImage(null)}>
                移除图片
              </Button>
            ) : null}
          </div>

          {error ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              {success === "pending"
                ? "已提交，正在审核中；通过后会在首页投稿墙展示。"
                : "投稿成功！可返回首页查看。"}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              每人每日投稿次数有限；通过后会出现在首页投稿墙。
            </p>
            <Button type="button" size="lg" disabled={busy || !image} onClick={() => void onSubmit()}>
              {busy ? "提交中…" : "投稿到社区中心"}
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
