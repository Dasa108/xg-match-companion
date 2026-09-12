import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Service worker precaches the whole app — shell, model.onnx, the ~14 MB wasm — so once the
// site has been opened with a connection it works fully offline pitchside. No install
// prompt / add-to-home-screen (spec §10); it just registers and caches.
//
// registerType "prompt" (not "autoUpdate") + injectRegister null: a new SW version is
// fetched and put in the "waiting" state, but never silently activated — the app itself
// (src/pwa/usePwa.ts, via the virtual:pwa-register module) decides when to ask the
// operator and only calls skipWaiting on an explicit "reload" tap. "autoUpdate" would have
// swapped code out from under a live session with no warning, which is exactly the
// staleness this project ran into checking its own deploy (process.md 6.19).
//
// `base`: GitHub Pages serves a project site from a /<repo-name>/ subpath, not root, so
// that build needs every asset URL prefixed with it — get this wrong and the page loads
// but every JS/CSS/model request 404s (or, worse, silently falls back to index.html and
// the app just doesn't mount — no error, blank screen; this bit us once already).
// Gated on an explicit GH_PAGES env var, NOT on `command === "build"` — `vite preview`
// only serves whatever `vite build` already baked into dist/ as static files, it doesn't
// re-derive the base for its own server, so a build made for the Pages subpath is *always*
// broken under local `npm run preview` regardless of what command preview itself reports.
// The CI workflow sets GH_PAGES=true; a plain local `npm run build` does not, so
// build/dev/preview/test all agree on root "/" locally.
export default defineConfig(() => ({
  base: process.env.GH_PAGES ? "/xg-match-companion/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
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
