// Validates the PSxG ONNX serving path in JS against psxg_feature_fixtures.json, using
// onnxruntime-node (same call shape psxgModel.ts uses with onnxruntime-web).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as ort from "onnxruntime-node";
import { beforeAll, describe, expect, it } from "vitest";

import { interp } from "./calibrate";

const here = new URL(".", import.meta.url).pathname;
const fixtures = JSON.parse(readFileSync(join(here, "__fixtures__/psxg_feature_fixtures.json"), "utf8"));
const calibrators = JSON.parse(readFileSync(join(here, "../../public/model/psxg_calibrators.json"), "utf8"));
const modelBytes = readFileSync(join(here, "../../public/model/psxg_model.onnx"));

let session: ort.InferenceSession;
let inputName: string;
let probName: string;

beforeAll(async () => {
  session = await ort.InferenceSession.create(modelBytes);
  inputName = session.inputNames[0];
  probName = session.outputNames.includes("probabilities")
    ? "probabilities"
    : session.outputNames[session.outputNames.length - 1];
});

describe("PSxG ONNX inference parity", () => {
  it("reproduces raw + calibrated psxg for every fixture case/bucket", async () => {
    let worstRaw = 0;
    let worstXg = 0;
    for (const c of fixtures.cases) {
      for (const bucket of ["minimal", "partial", "full"] as const) {
        const b = c.buckets[bucket];
        const row = Float32Array.from(b.row.map((v: number | null) => (v === null ? NaN : v)));
        const out = await session.run({
          [inputName]: new ort.Tensor("float32", row, [1, row.length]),
        });
        const probs = out[probName].data as Float32Array;
        const raw = probs.length === 2 ? probs[1] : probs[0];
        const psxg = interp(calibrators[bucket].x, calibrators[bucket].y, raw);
        worstRaw = Math.max(worstRaw, Math.abs(raw - b.raw));
        worstXg = Math.max(worstXg, Math.abs(psxg - b.xg));
      }
    }
    expect(worstRaw).toBeLessThan(1e-5);
    expect(worstXg).toBeLessThan(1e-4);
  });
});
