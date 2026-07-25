import { useCallback, useEffect, useState } from "react";
import {
  type HubThemeMode,
  initHubTheme,
  setHubTheme as applyHubTheme,
} from "@/theme";

export function useHubTheme() {
  const [mode, setMode] = useState<HubThemeMode>("system");

  useEffect(() => {
    setMode(initHubTheme());
  }, []);

  const setTheme = useCallback((next: HubThemeMode) => {
    applyHubTheme(next);
    setMode(next);
  }, []);

  return { mode, setTheme };
}
