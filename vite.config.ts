import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `wrangler dev` serves web/dist and the API. Vite proxies /api to that Worker.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2023", chunkSizeWarningLimit: 2000 }, // tldraw is lazy-loaded
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
