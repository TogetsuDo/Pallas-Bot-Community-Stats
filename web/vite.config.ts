import { defineConfig } from "vite";

export default defineConfig({
  server: {
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
