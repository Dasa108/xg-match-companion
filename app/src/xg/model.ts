// In-browser xG inference: onnxruntime-web + per-bucket isotonic calibration.
// The three artefacts under /model/ are produced by training/export_onnx.py.
//
// onnxruntime-web is a large module (its wasm is ~MBs). It is loaded lazily via dynamic
// import on the first prediction, so the match-list / setup screens never pay for it and
// it lands in its own bundle chunk.

import type * as Ort from "onnxruntime-web";

import { type Calibrators, interp, pickBucket } from "./calibrate";
import { BUCKET_KEEP, encodeRow, maskGroups, MODEL_FEATURES } from "./encode";
import { featuresFromInput, presentGroups } from "./features";
import type { ShotInput, XgResult } from "./types";

export { interp, pickBucket } from "./calibrate";

interface Loaded {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  calibrators: Calibrators;
  penaltyXg: number;
  inputName: string;
  probName: string;
}

let loadingP: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (!loadingP) {
    loadingP = (async () => {
      const ort = await import("onnxruntime-web");
      // Single-threaded wasm: the threaded build needs SharedArrayBuffer / cross-origin
      // isolation. One thread is plenty for a ~420 KB model, one inference per shot.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;

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
        ort,
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

/** Kick off model download/compile early (e.g. when the Live screen mounts). */
export function warmModel(): void {
  void load().catch(() => {
    /* surfaced later by predictXg */
  });
}

export async function predictXg(input: ShotInput): Promise<XgResult> {
  const { ort, session, calibrators, penaltyXg, inputName, probName } = await load();
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
