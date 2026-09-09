import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// onnxruntime-web ships its own wasm; we serve it from /ort/ (copied by sync-assets.mjs)
// and exclude it from dep pre-bundling so the worker/wasm URLs resolve correctly.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  server: { port: 5173 },
});
