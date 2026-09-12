import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Service worker precaches the whole app — shell, model.onnx, the ~14 MB wasm — so once the
// site has been opened with a connection it works fully offline pitchside. No install
// prompt / add-to-home-screen (spec §10); it just registers and caches.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,onnx,json,wasm,woff2,svg,webp}"],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "xG Match Companion",
        short_name: "xG",
        description: "Log shots pitchside, get live expected goals.",
        theme_color: "#0b3d2e",
        background_color: "#0d1512",
        display: "standalone",
        icons: [],
      },
    }),
  ],
  server: { port: 5173 },
});
