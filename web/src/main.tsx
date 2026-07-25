import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import brandMarkUrl from "@/assets/brand-avatar.png?url";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-sans-sc/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@/styles/index.css";
import "@/styles/islands.css";
import "@/styles/corpus-hot.css";

function ensureFavicon(): void {
  let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    el.type = "image/png";
    document.head.appendChild(el);
  }
  el.href = brandMarkUrl;
}

ensureFavicon();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.querySelector("#root");
if (!rootEl) throw new Error("#root missing");

createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);

requestAnimationFrame(() => {
  const splash = document.querySelector("#boot-splash");
  if (!splash) return;
  splash.classList.add("boot-splash--hide");
  window.setTimeout(() => splash.remove(), 500);
});

requestAnimationFrame(() => {
  const splash = document.querySelector("#boot-splash");
  if (!splash) return;
  splash.classList.add("boot-splash--hide");
  window.setTimeout(() => splash.remove(), 500);
});
