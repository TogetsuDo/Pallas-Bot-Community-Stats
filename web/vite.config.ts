import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": src,
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5199,
    proxy: {
      "/v1": {
        target: process.env.VITE_STATS_PROXY ?? "https://stats.pallasbot.top",
        changeOrigin: true,
        secure: true,
      },
      "/health": {
        target: process.env.VITE_STATS_PROXY ?? "https://stats.pallasbot.top",
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/d3")) return "d3";
        },
      },
    },
  },
});
