// Post-shot xG (PSxG) inference — optional, only invoked when the operator has tapped a
// goal-mouth placement for an on-target shot (goal / saved / post). Separate ONNX model,
// separate calibrators, lazy-loaded exactly like the pre-shot model (model.ts).

import type * as Ort from "onnxruntime-web";

import { type Calibrators, interp, pickBucket } from "./calibrate";
import { BUCKET_KEEP, maskGroups } from "./encode";
import { featuresFromInput, presentGroups } from "./features";
import { encodePsxgRow, PSXG_MODEL_FEATURES, psxgRow } from "./psxgFeatures";
import type { Bucket, GoalPoint, PsxgResult, ShotInput } from "./types";

interface Loaded {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  calibrators: Calibrators;
  inputName: string;
  probName: string;
}

let loadingP: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (!loadingP) {
    loadingP = (async () => {
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;

      const base = import.meta.env.BASE_URL ?? "/";
      const [spec, calibrators, modelBuf] = await Promise.all([
        fetch(`${base}model/psxg_feature_spec.json`).then((r) => r.json()),
        fetch(`${base}model/psxg_calibrators.json`).then((r) => r.json()),
        fetch(`${base}model/psxg_model.onnx`).then((r) => r.arrayBuffer()),
      ]);
      if (spec.model_features?.length !== PSXG_MODEL_FEATURES.length) {
        throw new Error(
          `psxg model/feature spec mismatch: onnx expects ${spec.model_features?.length}, ` +
            `TS builds ${PSXG_MODEL_FEATURES.length}`,
        );
      }
      const session = await ort.InferenceSession.create(modelBuf, { executionProviders: ["wasm"] });
      const probName = session.outputNames.includes("probabilities")
        ? "probabilities"
        : session.outputNames[session.outputNames.length - 1];
      return { ort, session, calibrators, inputName: session.inputNames[0], probName };
    })();
  }
  return loadingP;
}

/** Kick off the PSxG model download/compile early (e.g. when the placement tool opens). */
export function warmPsxgModel(): void {
  void load().catch(() => {
    /* surfaced later by predictPsxg */
  });
}

export async function predictPsxg(input: ShotInput, goalmouth: GoalPoint): Promise<PsxgResult> {
  const { ort, session, calibrators, inputName, probName } = await load();
  const preshot = featuresFromInput(input);
  const bucket: Bucket = pickBucket(presentGroups(input));
  const masked = maskGroups(preshot, BUCKET_KEEP[bucket]);
  const row = psxgRow(input, masked, goalmouth);
  const encoded = encodePsxgRow(row);
  const out = await session.run({
    [inputName]: new ort.Tensor("float32", encoded, [1, encoded.length]),
  });
  const probs = out[probName].data as Float32Array;
  const raw = probs.length === 2 ? probs[1] : probs[0];
  const cal = calibrators[bucket];
  return { psxg: interp(cal.x, cal.y, raw), raw, bucket, goalmouth };
}
