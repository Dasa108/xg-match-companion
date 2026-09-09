// Copy the model artifacts and the parity fixtures out of the training side of the repo
// into the app, and stage onnxruntime-web's wasm so inference works fully offline.
// Runs before dev / build / test.
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const repo = join(app, "..");

const jobs = [
  [join(repo, "models", "model.onnx"), join(app, "public", "model", "model.onnx")],
  [join(repo, "models", "feature_spec.json"), join(app, "public", "model", "feature_spec.json")],
  [join(repo, "models", "calibrators.json"), join(app, "public", "model", "calibrators.json")],
  [join(repo, "training", "feature_fixtures.json"), join(app, "src", "xg", "__fixtures__", "feature_fixtures.json")],
];

for (const [src, dst] of jobs) {
  if (!existsSync(src)) {
    console.error(`sync-assets: missing ${src} — run the training pipeline first`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`  ${src.replace(repo + "/", "")} -> ${dst.replace(app + "/", "")}`);
}

// onnxruntime-web wasm/js runtime -> public/ort/ (referenced via ort.env.wasm.wasmPaths)
const ortDist = join(app, "node_modules", "onnxruntime-web", "dist");
if (existsSync(ortDist)) {
  const outDir = join(app, "public", "ort");
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(ortDist)) {
    if (f.endsWith(".wasm") || f.endsWith(".mjs")) {
      copyFileSync(join(ortDist, f), join(outDir, f));
    }
  }
  console.log(`  onnxruntime-web runtime -> public/ort/`);
} else {
  console.log("  (onnxruntime-web not installed yet — run npm install, then npm run sync-assets)");
}
