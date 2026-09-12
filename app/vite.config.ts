import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Service worker precaches the whole app — shell, model.onnx, the ~14 MB wasm — so once the
// site has been opened with a connection it works fully offline pitchside. No install
// prompt / add-to-home-screen (spec §10); it just registers and caches.
//
// registerType "autoUpdate": a new SW version activates and reloads the page automatically
// the moment it's detected, no prompt. injectRegister stays `null` even so — registration
// is still done by hand in src/pwa/usePwa.ts (via virtual:pwa-register), because that's the
// only way a runtime preference (the offline-mode toggle) can decide whether to register at
// all; the plugin's own auto-injected script can't consult localStorage. What auto-update
// can't fix is being offline — no connection means no way to check for anything newer, so
// usePwa also tracks that and the UI flags it passively (process.md 6.19/6.21).
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
      registerType: "autoUpdate",
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
