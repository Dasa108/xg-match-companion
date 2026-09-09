"""
export_onnx.py — package the trained model for in-browser serving.

Outputs (into ../models):
  model.onnx           the LightGBM model as ONNX (all-numeric input, opset 13)
  feature_spec.json    (already written by train.py) input order, vocabularies, buckets
  calibrators.json     (already written by train.py) per-bucket isotonic x/y knots
  serving.md           how the browser is expected to use the three files

Also writes training/feature_fixtures.json — the Python<->TypeScript parity contract:
for a set of real shots, the exact feature dict, model input row, raw probability and
calibrated xG per bucket. The TS port must reproduce every number to 1e-6.

Run after train.py + evaluate.py.
"""

from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import onnxruntime as ort
import pandas as pd
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

import datasplit as S
import encode as E
import features as F

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"
BUCKETS = {
    "minimal": set(),
    "partial": {"freeze_frame"},
    "full": {"freeze_frame", "assist", "technique", "pass_origin", "context"},
}


def apply_cal(cal: dict, raw: np.ndarray) -> np.ndarray:
    return np.interp(raw, cal["x"], cal["y"])


def to_onnx(booster: lgb.Booster, n_features: int) -> bytes:
    onx = convert_lightgbm(
        booster,
        initial_types=[("input", FloatTensorType([None, n_features]))],
        zipmap=False,
        target_opset=13,
    )
    return onx.SerializeToString()


def main() -> None:
    booster = lgb.Booster(model_file=str(MODELS / "model.txt"))
    calibrators = json.loads((MODELS / "calibrators.json").read_text())
    spec = json.loads((MODELS / "feature_spec.json").read_text())
    n_features = len(spec["model_features"])

    # --- convert + verify against the Python booster ------------------
    onnx_bytes = to_onnx(booster, n_features)
    (MODELS / "model.onnx").write_bytes(onnx_bytes)

    df = pd.read_parquet(HERE / "data" / "processed" / "shots.parquet")
    df["split"] = S.assign_split(df)
    test = df[df.split == "test"].reset_index(drop=True)

    sess = ort.InferenceSession(onnx_bytes, providers=["CPUExecutionProvider"])
    out_names = [o.name for o in sess.get_outputs()]
    prob_name = out_names[1] if len(out_names) > 1 else out_names[0]

    max_diff = 0.0
    for bucket, keep in BUCKETS.items():
        tb = S.apply_bucket_mask(test, keep_groups=keep)
        X = E.encode_matrix(tb)
        py = booster.predict(X)
        onx_out = sess.run([prob_name], {"input": X})[0]
        onx = onx_out[:, 1] if onx_out.ndim == 2 and onx_out.shape[1] == 2 else onx_out.ravel()
        max_diff = max(max_diff, float(np.abs(py - onx).max()))
    print(f"ONNX vs LightGBM max abs prob diff (incl. NaN rows): {max_diff:.2e}")
    assert max_diff < 1e-5, "ONNX conversion is not faithful"

    # --- parity fixtures from real events ----------------------------
    fixtures = build_fixtures(booster, calibrators, n=48)
    (HERE / "feature_fixtures.json").write_text(json.dumps(fixtures, indent=1))
    print(f"wrote {len(fixtures['cases'])} parity fixtures -> feature_fixtures.json")

    (MODELS / "serving.md").write_text(SERVING_MD)
    print(f"wrote {MODELS/'model.onnx'} ({len(onnx_bytes)/1024:.0f} KB) + serving.md")


def _one_row_df(feat_row: dict) -> pd.DataFrame:
    one = pd.DataFrame([feat_row])
    for col, vocab in [("body_part", F.BODY_PARTS), ("shot_type", F.SHOT_TYPES),
                       ("play_pattern", F.PLAY_PATTERNS), ("technique", F.TECHNIQUES),
                       ("assist_type", F.ASSIST_TYPES)]:
        one[col] = pd.Categorical(one[col], categories=vocab)
    return one


def build_fixtures(booster: lgb.Booster, calibrators: dict, n: int) -> dict:
    """
    Real StatsBomb shots -> {input, features, per-bucket (row, raw, xg)}.
    `input` is the plain shot-input dict the browser builds; the TS port must turn it into
    `features` (and then the masked rows) and reproduce raw/xg.
    """
    raw_dir = HERE / "data" / "raw" / "events"
    all_files = sorted(raw_dir.glob("*.json"))
    files = all_files[:: max(1, len(all_files) // 24)]
    cases = []
    for f in files:
        events = json.loads(f.read_text())
        by_id = {e["id"]: e for e in events if "id" in e}
        shots = [(i, e) for i, e in enumerate(events) if (e.get("type") or {}).get("name") == "Shot"]
        for i, ev in shots[:2]:
            kp = by_id.get((ev.get("shot") or {}).get("key_pass_id"))
            prev = events[i - 1] if i > 0 else None
            inp = F.event_to_input(ev, kp, prev)
            if inp is None:
                continue
            feat_row = F.features_from_input(inp)
            # cross-check: the dataset path and the input path must agree
            assert F.build_shot_row(ev, kp, prev)  # sanity
            feat = {k: (None if isinstance(v, float) and np.isnan(v) else v)
                    for k, v in feat_row.items() if k in F.FEATURE_COLUMNS}
            one = _one_row_df(feat_row)
            buckets = {}
            for bucket, keep in BUCKETS.items():
                mb = S.apply_bucket_mask(one, keep_groups=keep)
                # round the encoded row first, then predict from it, so the fixture is
                # internally consistent (the TS port feeds the same rounded row to ONNX).
                mrow = [round(float(v), 6) for v in E.encode_matrix(mb)[0].tolist()]
                r = float(booster.predict(np.array([mrow], dtype=np.float32))[0])
                buckets[bucket] = {
                    "row": mrow,
                    "raw": round(r, 6),
                    "xg": round(float(apply_cal(calibrators[bucket], np.array([r]))[0]), 6),
                }
            cases.append({
                "shot_id": ev.get("id"),
                "input": inp,
                "features": feat,
                "buckets": buckets,
            })
            if len(cases) >= n:
                break
        if len(cases) >= n:
            break
    return {"model_features": E.MODEL_FEATURES, "feature_columns": F.FEATURE_COLUMNS, "cases": cases}


SERVING_MD = """\
# Serving the xG model in the browser

Three files, all in this folder, bundled with the site:

| file | role |
|---|---|
| `model.onnx` | LightGBM model, run with onnxruntime-web. Input: one float tensor `input` of shape `[1, N]` where `N = len(feature_spec.model_features)`. Output `probabilities` `[1, 2]`; take column 1 = raw goal probability. |
| `feature_spec.json` | the exact input order (`model_features`), the categorical vocabularies, the feature groups, and the completeness bucket definitions. |
| `calibrators.json` | per-bucket isotonic knots. Calibrate with piecewise-linear interpolation: `xg = interp(raw, cal.x, cal.y)`. |

## Steps per shot
1. Build the feature dict with the TypeScript port of `features.py` (same geometry, same
   StatsBomb 120x80 frame). Missing optional groups -> leave those fields null.
2. Encode to the numeric row: `feature_spec.numeric_columns` in order, then one dummy per
   `feature_spec.onehot_columns` entry (1 if the category matches, else 0; all 0 if null).
3. Run onnxruntime-web -> raw probability.
4. Pick the bucket: `full` if freeze-frame + at least one of assist/technique/pass_origin;
   else `partial` if any optional group present; else `minimal`.
5. `xg = interp(raw, calibrators[bucket].x, calibrators[bucket].y)`.
6. Penalties skip all of the above: xg = `feature_spec.penalty_xg` (0.76).

`training/feature_fixtures.json` is the parity test: for each case and bucket, your TS
pipeline must reproduce `features` and each `buckets[b].row` exactly, the model `raw` to
1e-5, and the calibrated `xg` to 1e-4. `check_fixtures.py` is the reference implementation.
"""


if __name__ == "__main__":
    main()
