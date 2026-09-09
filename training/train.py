"""
train.py — fit the xG model.

Pipeline
--------
1. Load shots.parquet, assign train/val/test by held-out competition-season.
2. Logistic-regression baselines (the bar every model must beat).
3. LightGBM on an augmented training set (feature-group dropout + position jitter) with
   monotone constraints, early stopping on a matching augmented validation set.
4. Isotonic calibration, fit separately for the minimal / partial / full completeness
   buckets on the validation set.
5. Save model.txt, feature_spec.json, calibrators.json, and a train report.

Run:  python train.py         (writes to ../models and ./artifacts)
"""

from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import datasplit as S
import encode as E
import features as F

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
        "log_loss": float(log_loss(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "auc": float(roc_auc_score(y, p)),
        "cal_in_large": float(p.sum() / y.sum()),
        "n": int(len(y)),
        "base_rate": float(y.mean()),
    }


def run_baselines(train: pd.DataFrame, val: pd.DataFrame) -> dict:
    yv = val["is_goal"].to_numpy()
    out = {}
    feature_sets = {
        "geom_only": ["distance", "angle"],
        "geom_plus_cats": ["distance", "angle", "dist_x", "abs_y", "in_box"],
    }
    for name, num in feature_sets.items():
        if name == "geom_plus_cats":
            Xtr = pd.get_dummies(train[num + ["body_part", "shot_type", "play_pattern"]],
                                 columns=["body_part", "shot_type", "play_pattern"])
            Xva = pd.get_dummies(val[num + ["body_part", "shot_type", "play_pattern"]],
                                 columns=["body_part", "shot_type", "play_pattern"])
            Xva = Xva.reindex(columns=Xtr.columns, fill_value=0)
        else:
            Xtr, Xva = train[num], val[num]
        clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
        clf.fit(Xtr, train["is_goal"])
        out[name] = metrics(yv, clf.predict_proba(Xva)[:, 1])
    return out


def build_early_stop_val(val: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Validation set mirrored across completeness levels, matching how we train."""
    parts = [val.copy(),
             S.apply_bucket_mask(val, keep_groups=set()),
             S.random_dropout(val, rng)]
    return pd.concat(parts, ignore_index=True)


def main() -> None:
    MODELS.mkdir(exist_ok=True)
    ARTIFACTS.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)

    df = pd.read_parquet(HERE / "data" / "processed" / "shots.parquet")
    df["split"] = S.assign_split(df)
    train = df[df.split == "train"].reset_index(drop=True)
    val = df[df.split == "val"].reset_index(drop=True)
    calib = df[df.split == "calib"].reset_index(drop=True)
    test = df[df.split == "test"].reset_index(drop=True)
    print(f"train {len(train):,}  calib {len(calib):,}  val {len(val):,}  test {len(test):,}   "
          f"(goal rate train={train.is_goal.mean():.3f}  calib+val="
          f"{pd.concat([calib, val]).is_goal.mean():.3f}  test={test.is_goal.mean():.3f})")

    # --- 1. baselines -------------------------------------------------
    baselines = run_baselines(train, val)
    for k, m in baselines.items():
        print(f"  baseline {k:<16} logloss={m['log_loss']:.4f}  auc={m['auc']:.3f}")

    # --- 2. augmented training matrix ------------------------------
    train_aug = S.build_training_matrix(train, rng, n_random=3)
    es_val = build_early_stop_val(val, rng)
    print(f"  augmented train rows: {len(train_aug):,}  early-stop val rows: {len(es_val):,}")

    Xtr, ytr = E.encode_matrix(train_aug), train_aug["is_goal"].to_numpy()
    Xes, yes = E.encode_matrix(es_val), es_val["is_goal"].to_numpy()

    model = lgb.LGBMClassifier(
        objective="binary",
        n_estimators=4000,
        learning_rate=0.02,
        num_leaves=31,
        max_depth=5,
        min_child_samples=60,
        subsample=0.8,
        subsample_freq=1,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        monotone_constraints=E.MONOTONE,
        monotone_constraints_method="advanced",
        random_state=SEED,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(
        Xtr, ytr,
        eval_set=[(Xes, yes)],
        eval_metric="binary_logloss",
        callbacks=[lgb.early_stopping(120), lgb.log_evaluation(200)],
    )
    best_iter = model.best_iteration_
    print(f"  LightGBM best_iteration={best_iter}")

    # --- 3. per-bucket isotonic calibration (fit on calib + val, both unseen) ------
    cal_pool = pd.concat([calib, val], ignore_index=True)
    calibrators = {}
    val_report = {}
    for bucket, keep in BUCKETS.items():
        vb = S.apply_bucket_mask(cal_pool, keep_groups=keep)
        raw = model.predict_proba(E.encode_matrix(vb), num_iteration=best_iter)[:, 1]
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(raw, vb["is_goal"].to_numpy())
        calibrators[bucket] = {
            "x": [round(float(v), 6) for v in iso.X_thresholds_],
            "y": [round(float(v), 6) for v in iso.y_thresholds_],
        }
        cal = iso.predict(raw)
        val_report[bucket] = {
            "raw": metrics(vb["is_goal"].to_numpy(), raw),
            "calibrated": metrics(vb["is_goal"].to_numpy(), cal),
        }
        m = val_report[bucket]["calibrated"]
        print(f"  val[{bucket:<7}] calibrated logloss={m['log_loss']:.4f}  "
              f"auc={m['auc']:.3f}  cal_in_large={m['cal_in_large']:.3f}")

    # --- 4. persist -------------------------------------------------
    model.booster_.save_model(str(MODELS / "model.txt"), num_iteration=best_iter)
    (MODELS / "calibrators.json").write_text(json.dumps(calibrators, indent=2))

    feature_spec = {
        "model_features": E.MODEL_FEATURES,
        "numeric_columns": F.NUMERIC_COLUMNS,
        "onehot_columns": E.ONEHOT_COLUMNS,
        "categoricals": {c: v for c, v in [
            ("body_part", F.BODY_PARTS), ("shot_type", F.SHOT_TYPES),
            ("play_pattern", F.PLAY_PATTERNS), ("technique", F.TECHNIQUES),
            ("assist_type", F.ASSIST_TYPES)]},
        "feature_groups": F.FEATURE_GROUPS,
        "buckets": {k: sorted(v) for k, v in BUCKETS.items()},
        "monotone": E.MONOTONE,
        "penalty_xg": 0.76,
        "pitch": {"length": 120.0, "width": 80.0, "goal_y": 40.0, "post_sep": 8.0},
        "best_iteration": int(best_iter),
    }
    (MODELS / "feature_spec.json").write_text(json.dumps(feature_spec, indent=2))

    (ARTIFACTS / "train_report.json").write_text(json.dumps({
        "split_counts": {"train": len(train), "val": len(val), "test": len(test)},
        "baselines": baselines,
        "val_by_bucket": val_report,
        "best_iteration": int(best_iter),
    }, indent=2))
    print(f"\nsaved model + calibrators + feature_spec to {MODELS}")


if __name__ == "__main__":
    main()
