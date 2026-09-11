"""check_psxg_fixtures.py — reference serving path for PSxG, run against
psxg_feature_fixtures.json, using ONLY the shipped psxg_model.onnx + psxg_calibrators.json."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"


def calibrate(cal: dict, raw: float) -> float:
    return float(np.interp(raw, cal["x"], cal["y"]))


def main() -> None:
    fx = json.loads((HERE / "psxg_feature_fixtures.json").read_text())
    calibrators = json.loads((MODELS / "psxg_calibrators.json").read_text())
    sess = ort.InferenceSession(str(MODELS / "psxg_model.onnx"), providers=["CPUExecutionProvider"])
    prob_name = [o.name for o in sess.get_outputs()][1]

    flat = [(c["shot_id"], b, d) for c in fx["cases"] for b, d in c["buckets"].items()]
    rows = np.array([[np.nan if v is None else v for v in d["row"]] for _, _, d in flat], dtype=np.float32)
    out = sess.run([prob_name], {"input": rows})[0][:, 1]

    worst_raw = worst_xg = 0.0
    for (_sid, bucket, d), r in zip(flat, out):
        worst_raw = max(worst_raw, abs(float(r) - d["raw"]))
        worst_xg = max(worst_xg, abs(calibrate(calibrators[bucket], float(r)) - d["xg"]))

    print(f"max abs diff  raw={worst_raw:.2e}  xg={worst_xg:.2e}   over {len(flat)} rows")
    assert worst_raw < 1e-5 and worst_xg < 1e-4, "PSxG serving path does not reproduce the fixtures"
    print(f"OK — {len(fx['cases'])} PSxG fixtures reproduced from psxg_model.onnx + psxg_calibrators.json")


if __name__ == "__main__":
    main()
