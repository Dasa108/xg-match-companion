import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Service worker precaches the whole app — shell, model.onnx, the ~14 MB wasm — so once the
// site has been opened with a connection it works fully offline pitchside. No install
// prompt / add-to-home-screen (spec §10); it just registers and caches.
//
// `base`: GitHub Pages serves a project site from a /<repo-name>/ subpath, not root, so a
// production build needs every asset URL prefixed with it — get this wrong and the page
// loads but every JS/CSS/model request 404s. Only applied for `vite build`, never `vite
// dev`/`vite preview`, so local development still runs at plain `/`.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/xg-match-companion/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,onnx,json,wasm,woff2,svg}"],
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
}));
