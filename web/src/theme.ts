export type HubThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "pallas-hub-theme";

function readStoredMode(): HubThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

function resolveTheme(mode: HubThemeMode): "light" | "dark" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: HubThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
}

export function initHubTheme(): HubThemeMode {
  const mode = readStoredMode();
  applyTheme(mode);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readStoredMode() === "system") applyTheme("system");
  });

  return mode;
}

export function setHubTheme(mode: HubThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  applyTheme(mode);
  syncThemeToggle(mode);
}

export function bindHubThemeToggle(root: ParentNode = document): void {
  const group = root.querySelector<HTMLElement>("[data-theme-toggle]");
  if (!group) return;

  group.querySelectorAll<HTMLButtonElement>("[data-theme-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.themeMode as HubThemeMode | undefined;
      if (!mode) return;
      setHubTheme(mode);
    });
  });

  syncThemeToggle(readStoredMode());
}

function syncThemeToggle(mode: HubThemeMode): void {
  document.querySelectorAll<HTMLButtonElement>("[data-theme-mode]").forEach((btn) => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle("theme-toggle__btn--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}
