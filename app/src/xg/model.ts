// In-browser xG inference: onnxruntime-web + per-bucket isotonic calibration.
// The three artefacts under /model/ are produced by training/export_onnx.py.

import * as ort from "onnxruntime-web";

import { type Calibrators, interp, pickBucket } from "./calibrate";
import { BUCKET_KEEP, encodeRow, maskGroups, MODEL_FEATURES } from "./encode";
import { featuresFromInput, presentGroups } from "./features";
import type { ShotInput, XgResult } from "./types";

export { interp, pickBucket } from "./calibrate";

// Let the bundler resolve onnxruntime-web's own wasm/mjs assets. (Do NOT set
// ort.env.wasm.wasmPaths to a /public path — Vite refuses to transform files there.)

interface Loaded {
  session: ort.InferenceSession;
  calibrators: Calibrators;
  penaltyXg: number;
  inputName: string;
  probName: string;
}

let loadingP: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (!loadingP) {
    loadingP = (async () => {
      const base = import.meta.env.BASE_URL ?? "/";
      const [spec, calibrators, modelBuf] = await Promise.all([
        fetch(`${base}model/feature_spec.json`).then((r) => r.json()),
        fetch(`${base}model/calibrators.json`).then((r) => r.json()),
        fetch(`${base}model/model.onnx`).then((r) => r.arrayBuffer()),
      ]);
      if (spec.model_features?.length !== MODEL_FEATURES.length) {
        throw new Error(
          `model/feature spec mismatch: onnx expects ${spec.model_features?.length}, ` +
            `TS builds ${MODEL_FEATURES.length}`,
        );
      }
      const session = await ort.InferenceSession.create(modelBuf, {
        executionProviders: ["wasm"],
      });
      const probName = session.outputNames.includes("probabilities")
        ? "probabilities"
        : session.outputNames[session.outputNames.length - 1];
      return {
        session,
        calibrators,
        penaltyXg: spec.penalty_xg ?? 0.76,
        inputName: session.inputNames[0],
        probName,
      };
    })();
  }
  return loadingP;
}

/** Kick off model download/compile early (e.g. on app mount). */
export function warmModel(): void {
  void load().catch(() => {
    /* surfaced later by predictXg */
  });
}

export async function predictXg(input: ShotInput): Promise<XgResult> {
  const { session, calibrators, penaltyXg, inputName, probName } = await load();
  const features = featuresFromInput(input);

  if (input.shot_type === "penalty") {
    return { xg: penaltyXg, raw: null, bucket: "penalty", features };
  }

  const bucket = pickBucket(presentGroups(input));
  const row = encodeRow(maskGroups(features, BUCKET_KEEP[bucket]));
  const out = await session.run({
    [inputName]: new ort.Tensor("float32", row, [1, row.length]),
  });
  const probs = out[probName].data as Float32Array;
  const raw = probs.length === 2 ? probs[1] : probs[0];
  const cal = calibrators[bucket];
  return { xg: interp(cal.x, cal.y, raw), raw, bucket, features };
}
