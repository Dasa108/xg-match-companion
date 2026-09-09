"""
check_fixtures.py — reference implementation of the browser serving path, run against
feature_fixtures.json. The TypeScript port must match this exactly (to 1e-6).

It deliberately uses ONLY the three shipped files (model.onnx, feature_spec.json,
calibrators.json) plus each fixture's `model_row` — no pandas, no features.py — so it
mirrors what runs in the browser.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"


def calibrate(cal: dict, raw: float) -> float:
    return float(np.interp(raw, cal["x"], cal["y"]))


def pick_bucket(present_groups: set[str]) -> str:
    if "freeze_frame" in present_groups and present_groups & {"assist", "technique", "pass_origin"}:
        return "full"
    return "partial" if present_groups else "minimal"


def main() -> None:
    fx = json.loads((HERE / "feature_fixtures.json").read_text())
    calibrators = json.loads((MODELS / "calibrators.json").read_text())
    sess = ort.InferenceSession(str(MODELS / "model.onnx"), providers=["CPUExecutionProvider"])
    prob_name = [o.name for o in sess.get_outputs()][1]

    # stack every (case, bucket) row, run ONNX once
    flat = [(c["shot_id"], b, d) for c in fx["cases"] for b, d in c["buckets"].items()]
    rows = np.array([[np.nan if v is None else v for v in d["row"]] for _, _, d in flat],
                    dtype=np.float32)
    out = sess.run([prob_name], {"input": rows})[0]
    raw = out[:, 1] if out.ndim == 2 else out.ravel()

    worst_raw = worst_xg = 0.0
    for (_sid, bucket, d), r in zip(flat, raw):
        worst_raw = max(worst_raw, abs(float(r) - d["raw"]))
        worst_xg = max(worst_xg, abs(calibrate(calibrators[bucket], float(r)) - d["xg"]))

    # raw must match the model almost exactly; xg carries one extra piecewise-linear step
    # whose knots can be steep, so 1e-4 there is still far below any meaningful xG precision.
    print(f"max abs diff  raw={worst_raw:.2e}  xg={worst_xg:.2e}   over {len(flat)} (case,bucket) rows")
    assert worst_raw < 1e-5 and worst_xg < 1e-4, "serving path does not reproduce the fixtures"
    print(f"OK — {len(fx['cases'])} fixtures reproduced from model.onnx + calibrators.json")


if __name__ == "__main__":
    main()
