"""
export_psxg_onnx.py — package the PSxG model for in-browser serving, same pattern as
export_onnx.py. Outputs (into ../models): psxg_model.onnx, psxg_feature_spec.json
(written by psxg_train.py), psxg_calibrators.json (written by psxg_train.py).
Also writes training/psxg_feature_fixtures.json, the TS parity contract.
"""

from __future__ import annotations

import json
import math
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
import psxg_features as P

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"
BUCKETS = {"minimal": set(), "partial": {"freeze_frame"},
          "full": {"freeze_frame", "assist", "technique", "pass_origin", "context"}}


def apply_cal(cal: dict, raw: np.ndarray) -> np.ndarray:
    return np.interp(raw, cal["x"], cal["y"])


def to_onnx(booster: lgb.Booster, n_features: int) -> bytes:
    onx = convert_lightgbm(booster, initial_types=[("input", FloatTensorType([None, n_features]))],
                           zipmap=False, target_opset=13)
    return onx.SerializeToString()


def main() -> None:
    booster = lgb.Booster(model_file=str(MODELS / "psxg_model.txt"))
    calibrators = json.loads((MODELS / "psxg_calibrators.json").read_text())
    n_features = len(P.PSXG_MODEL_FEATURES)

    onnx_bytes = to_onnx(booster, n_features)
    (MODELS / "psxg_model.onnx").write_bytes(onnx_bytes)

    df = pd.read_parquet(HERE / "data" / "processed" / "psxg_shots.parquet")
    df["split"] = S.assign_split(df)
    test = df[df.split == "test"].reset_index(drop=True)

    sess = ort.InferenceSession(onnx_bytes, providers=["CPUExecutionProvider"])
    prob_name = [o.name for o in sess.get_outputs()][1]

    max_diff = 0.0
    for bucket, keep in BUCKETS.items():
        tb = S.apply_bucket_mask(test, keep_groups=keep)
        X = P.psxg_encode_matrix(tb)
        py = booster.predict(X)
        onx = sess.run([prob_name], {"input": X})[0][:, 1]
        max_diff = max(max_diff, float(np.abs(py - onx).max()))
    print(f"ONNX vs LightGBM max abs prob diff: {max_diff:.2e}")
    assert max_diff < 1e-5, "ONNX conversion is not faithful"

    fixtures = build_fixtures(booster, calibrators, n=32)
    (HERE / "psxg_feature_fixtures.json").write_text(json.dumps(fixtures, indent=1))
    print(f"wrote {len(fixtures['cases'])} PSxG parity fixtures -> psxg_feature_fixtures.json")
    print(f"wrote {MODELS/'psxg_model.onnx'} ({len(onnx_bytes)/1024:.0f} KB)")


def _one_row_df(feat_row: dict) -> pd.DataFrame:
    one = pd.DataFrame([feat_row])
    for col, vocab in [("body_part", F.BODY_PARTS), ("shot_type", F.SHOT_TYPES),
                       ("play_pattern", F.PLAY_PATTERNS), ("technique", F.TECHNIQUES),
                       ("assist_type", F.ASSIST_TYPES)]:
        one[col] = pd.Categorical(one[col], categories=vocab)
    return one


def build_fixtures(booster: lgb.Booster, calibrators: dict, n: int) -> dict:
    raw_dir = HERE / "data" / "raw" / "events"
    files = sorted(raw_dir.glob("*.json"))
    cases = []
    for f in files:
        events = json.loads(f.read_text())
        by_id = {e["id"]: e for e in events if "id" in e}
        for i, ev in enumerate(events):
            if (ev.get("type") or {}).get("name") != "Shot":
                continue
            shot = ev.get("shot") or {}
            outcome = (shot.get("outcome") or {}).get("name")
            end_loc = shot.get("end_location")
            if outcome not in P.ON_TARGET_OUTCOMES or not end_loc or len(end_loc) != 3:
                continue
            kp = by_id.get(shot.get("key_pass_id"))
            prev = events[i - 1] if i > 0 else None
            inp = F.event_to_input(ev, kp, prev)
            if inp is None:
                continue
            gm_y, gm_z = float(end_loc[1]), float(end_loc[2])
            feat_row = P.psxg_row_from_input(inp, gm_y, gm_z)
            feat = {k: (None if isinstance(v, float) and math.isnan(v) else v)
                    for k, v in feat_row.items() if k in F.FEATURE_COLUMNS + P.GOALMOUTH_COLUMNS}
            one = _one_row_df(feat_row)

            buckets = {}
            for bucket, keep in BUCKETS.items():
                mb = S.apply_bucket_mask(one, keep_groups=keep)
                enc = P.psxg_encode_matrix(mb)[0].tolist()
                mrow = [None if math.isnan(v) else round(float(v), 6) for v in enc]
                pred_in = np.array([[np.nan if v is None else v for v in mrow]], dtype=np.float32)
                r = float(booster.predict(pred_in)[0])
                buckets[bucket] = {"row": mrow, "raw": r,
                                   "xg": float(apply_cal(calibrators[bucket], np.array([r]))[0])}
            cases.append({"shot_id": ev.get("id"), "input": inp,
                         "goalmouth": [gm_y, gm_z], "features": feat, "buckets": buckets})
            if len(cases) >= n:
                return {"model_features": P.PSXG_MODEL_FEATURES, "cases": cases}
    return {"model_features": P.PSXG_MODEL_FEATURES, "cases": cases}


if __name__ == "__main__":
    main()
