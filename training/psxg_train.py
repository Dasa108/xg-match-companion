"""
psxg_train.py — train the post-shot xG (PSxG) model.

Same split / completeness-bucket / calibration machinery as train.py, reused on the
on-target subset with the goal-mouth placement appended. The baseline here is not a
logistic regression — it's the *pre-shot xG model itself*, re-calibrated for the on-target
population. That isolates the question PSxG exists to answer: does knowing where the shot
went beat knowing only the situation it was taken in?

Run:  python psxg_train.py   (writes ../models/psxg_*.{txt,json} and ./artifacts)
"""

from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

import datasplit as S
import encode as E
import psxg_features as P

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"
ARTIFACTS = HERE / "artifacts"
SEED = 17
BUCKETS = {
    "minimal": set(),
    "partial": {"freeze_frame"},
    "full": {"freeze_frame", "assist", "technique", "pass_origin", "context"},
}


def metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    p = np.clip(p, 1e-7, 1 - 1e-7)
    return {
        "log_loss": float(log_loss(y, p)), "brier": float(brier_score_loss(y, p)),
        "auc": float(roc_auc_score(y, p)) if 0 < y.mean() < 1 else float("nan"),
        "cal_in_large": float(p.sum() / y.sum()), "n": int(len(y)), "base_rate": float(y.mean()),
    }


def preshot_baseline_calibrator(df: pd.DataFrame, cal_mask: np.ndarray) -> IsotonicRegression:
    """Pre-shot model's own raw score, re-isotonic-calibrated for the on-target population."""
    booster = lgb.Booster(model_file=str(MODELS / "model.txt"))
    raw = booster.predict(E.encode_matrix(df))
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(raw[cal_mask], df.loc[cal_mask, "is_goal"].to_numpy())
    return iso


def main() -> None:
    MODELS.mkdir(exist_ok=True)
    ARTIFACTS.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)

    df = pd.read_parquet(HERE / "data" / "processed" / "psxg_shots.parquet")
    df["split"] = S.assign_split(df)
    train = df[df.split == "train"].reset_index(drop=True)
    calib = df[df.split == "calib"].reset_index(drop=True)
    val = df[df.split == "val"].reset_index(drop=True)
    test = df[df.split == "test"].reset_index(drop=True)
    print(f"train {len(train):,}  calib {len(calib):,}  val {len(val):,}  test {len(test):,}   "
          f"(goal rate train={train.is_goal.mean():.3f}  test={test.is_goal.mean():.3f})")

    # --- baseline: pre-shot model re-calibrated for the on-target population ----------
    cal_pool = pd.concat([calib, val], ignore_index=True)
    df_reset = df.reset_index(drop=True)
    base_iso = preshot_baseline_calibrator(df_reset, (df_reset["split"].isin(["calib", "val"])).to_numpy())
    base_booster = lgb.Booster(model_file=str(MODELS / "model.txt"))
    base_raw_test = base_booster.predict(E.encode_matrix(test))
    base_p_test = base_iso.predict(base_raw_test)
    base_metrics = metrics(test["is_goal"].to_numpy(), base_p_test)
    print(f"  baseline (pre-shot xG only, recalibrated): logloss={base_metrics['log_loss']:.4f} "
          f"auc={base_metrics['auc']:.3f} cal={base_metrics['cal_in_large']:.3f}")

    # --- augmented training matrix (pre-shot dropout/jitter; goalmouth untouched) ------
    train_aug = S.build_training_matrix(train, rng, n_random=3)
    es_val = pd.concat([val, S.apply_bucket_mask(val, keep_groups=set()),
                        S.random_dropout(val, rng)], ignore_index=True)
    print(f"  augmented train rows: {len(train_aug):,}  early-stop val rows: {len(es_val):,}")

    Xtr, ytr = P.psxg_encode_matrix(train_aug), train_aug["is_goal"].to_numpy()
    Xes, yes = P.psxg_encode_matrix(es_val), es_val["is_goal"].to_numpy()

    model = lgb.LGBMClassifier(
        objective="binary", n_estimators=3000, learning_rate=0.02, num_leaves=31,
        max_depth=5, min_child_samples=40, subsample=0.8, subsample_freq=1,
        colsample_bytree=0.8, reg_lambda=1.0, monotone_constraints=P.PSXG_MONOTONE,
        monotone_constraints_method="advanced", random_state=SEED, n_jobs=-1, verbose=-1,
    )
    model.fit(Xtr, ytr, eval_set=[(Xes, yes)], eval_metric="binary_logloss",
             callbacks=[lgb.early_stopping(120), lgb.log_evaluation(200)])
    best_iter = model.best_iteration_
    print(f"  LightGBM best_iteration={best_iter}")

    # --- per-bucket calibration (calib + val, unseen by the model) --------------------
    calibrators: dict[str, dict] = {}
    val_report: dict[str, dict] = {}
    for bucket, keep in BUCKETS.items():
        vb = S.apply_bucket_mask(cal_pool, keep_groups=keep)
        raw = model.predict_proba(P.psxg_encode_matrix(vb), num_iteration=best_iter)[:, 1]
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(raw, vb["is_goal"].to_numpy())
        calibrators[bucket] = {"x": [round(float(v), 6) for v in iso.X_thresholds_],
                               "y": [round(float(v), 6) for v in iso.y_thresholds_]}
        cal_p = iso.predict(raw)
        val_report[bucket] = metrics(vb["is_goal"].to_numpy(), cal_p)
        m = val_report[bucket]
        print(f"  val[{bucket:<7}] logloss={m['log_loss']:.4f}  auc={m['auc']:.3f}  "
              f"cal={m['cal_in_large']:.3f}")

    # --- persist ------------------------------------------------------------------
    model.booster_.save_model(str(MODELS / "psxg_model.txt"), num_iteration=best_iter)
    (MODELS / "psxg_calibrators.json").write_text(json.dumps(calibrators, indent=2))
    feature_spec = {
        "model_features": P.PSXG_MODEL_FEATURES,
        "preshot_model_features": E.MODEL_FEATURES,
        "goalmouth_columns": P.GOALMOUTH_COLUMNS,
        "buckets": {k: sorted(v) for k, v in BUCKETS.items()},
        "monotone": P.PSXG_MONOTONE,
        "goal_frame": {"y_lo": P.GOAL_Y_LO, "y_hi": P.GOAL_Y_HI,
                      "z_ground": P.GOAL_Z_GROUND, "z_bar": P.GOAL_Z_BAR},
        "best_iteration": int(best_iter),
    }
    (MODELS / "psxg_feature_spec.json").write_text(json.dumps(feature_spec, indent=2))
    (ARTIFACTS / "psxg_train_report.json").write_text(json.dumps({
        "split_counts": {"train": len(train), "calib": len(calib), "val": len(val), "test": len(test)},
        "preshot_baseline": base_metrics, "val_by_bucket": val_report, "best_iteration": int(best_iter),
    }, indent=2))
    print(f"\nsaved psxg model + calibrators + feature_spec to {MODELS}")


if __name__ == "__main__":
    main()
