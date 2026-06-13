export async function openQQProfile(qq: number, profileUrl?: string): Promise<void> {
  const url = profileUrl?.trim() || buildQQProfileDeepLink(qq);
  const fallbackTimer = window.setTimeout(() => {
    void copyQQFallback(qq);
  }, 1500);

  const onBlur = () => {
    window.clearTimeout(fallbackTimer);
    window.removeEventListener("blur", onBlur);
  };
  window.addEventListener("blur", onBlur);
  navigateTencentDeepLink(url);
}

function navigateTencentDeepLink(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    window.location.assign(url);
  }, 80);
}

function buildQQProfileDeepLink(qq: number): string {
  const params = JSON.stringify({ uin: String(qq), sourceType: "QrCodeShareBuddyLink" });
  return `tencent://ntqq-open?subCmd=profile&action=openMiniBuddyProfile&actionParams=${encodeURIComponent(params)}`;
}

async function copyQQFallback(qq: number): Promise<void> {
  const text = String(qq);
  try {
    await navigator.clipboard.writeText(text);
    showBubbleToast(`未检测到 QQ 客户端，已复制 QQ 号 ${text}`);
  } catch {
    showBubbleToast(`请手动复制 QQ 号：${text}`);
  }
}

function showBubbleToast(message: string): void {
  document.querySelector(".bubble-toast")?.remove();
  const el = document.createElement("div");
  el.className = "bubble-toast";
  el.textContent = message;
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}
