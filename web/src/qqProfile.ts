export async function openQQProfile(qq: number, profileUrl?: string): Promise<void> {
  if (isWeChatInApp()) {
    await copyQQNumber(qq, "微信内无法直接打开 QQ，已复制 QQ 号");
    return;
  }

  const url = resolveQQProfileUrl(qq, profileUrl);
  const fallbackTimer = window.setTimeout(() => {
    const hint = isMobileQQTarget()
      ? "未唤起 QQ，已复制 QQ 号，可在 QQ 内搜索添加"
      : undefined;
    void copyQQNumber(qq, hint);
  }, 1500);

  const onBlur = () => {
    window.clearTimeout(fallbackTimer);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("pagehide", onBlur);
  };
  window.addEventListener("blur", onBlur);
  window.addEventListener("pagehide", onBlur);

  if (isMobileQQTarget()) {
    navigateMobileDeepLink(url);
    return;
  }
  navigateDesktopDeepLink(url);
}

export async function copyQQNumber(qq: number, hint?: string): Promise<void> {
  const text = String(qq);
  try {
    await navigator.clipboard.writeText(text);
    showBubbleToast(hint ?? `已复制 QQ 号 ${text}`);
  } catch {
    showBubbleToast(hint ?? `请手动复制 QQ 号：${text}`);
  }
}

export function buildQQProfileDeepLink(qq: number): string {
  return isMobileQQTarget() ? buildMobileQQProfileDeepLink(qq) : buildDesktopNTQQProfileDeepLink(qq);
}

export function buildDesktopNTQQProfileDeepLink(qq: number): string {
  const params = JSON.stringify({ uin: String(qq), sourceType: "QrCodeShareBuddyLink" });
  return `tencent://ntqq-open?subCmd=profile&action=openMiniBuddyProfile&actionParams=${params}`;
}

export function buildMobileQQProfileDeepLink(qq: number): string {
  return `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${qq}&card_type=person&source=sharecard`;
}

function resolveQQProfileUrl(qq: number, profileUrl?: string): string {
  if (isMobileQQTarget()) return buildMobileQQProfileDeepLink(qq);
  const raw = profileUrl?.trim() ?? "";
  if (raw.startsWith("tencent://ntqq-open") && raw.includes("actionParams=")) return raw;
  return buildDesktopNTQQProfileDeepLink(qq);
}

function isMobileQQTarget(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPod|Mobile/i.test(ua) && !/iPad/i.test(ua);
}

function isWeChatInApp(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function navigateMobileDeepLink(url: string): void {
  window.location.assign(url);
}

function navigateDesktopDeepLink(url: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 3000);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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
