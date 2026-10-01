import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FastAPI serves web/dist in production; in dev, Vite proxies /api to it.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2023", chunkSizeWarningLimit: 2000 }, // tldraw is lazy-loaded
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
