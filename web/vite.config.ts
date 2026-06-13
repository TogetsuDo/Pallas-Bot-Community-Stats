import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5199,
    proxy: {
      "/v1": { target: "http://127.0.0.1:8099", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8099", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
