"""
psxg_evaluate.py — score the PSxG model on the frozen on-target test set.

The release gate here is comparative: PSxG (even at `minimal` pre-shot completeness, since
the goalmouth group is always present when invoked) must clearly beat the pre-shot xG
model's own re-calibrated prediction — that's the entire point of a post-shot model.
"""

from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

import datasplit as S
import encode as E
import psxg_features as P

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"
ARTIFACTS = HERE / "artifacts"

TARGETS = {  # looser than the pre-shot gate: much smaller sample, single-domain task
    "full": {"log_loss": 0.40, "auc": 0.85}, "partial": {"log_loss": 0.42, "auc": 0.84},
    "minimal": {"log_loss": 0.44, "auc": 0.83},
}
BUCKETS = {"minimal": set(), "partial": {"freeze_frame"},
          "full": {"freeze_frame", "assist", "technique", "pass_origin", "context"}}


def ece(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    tot = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            tot += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(tot)


def apply_calibrator(cal: dict, raw: np.ndarray) -> np.ndarray:
    return np.interp(raw, cal["x"], cal["y"])


def reliability_plot(y, p, path, title) -> None:
    edges = np.linspace(0, 1, 11)
    idx = np.clip(np.digitize(p, edges) - 1, 0, 9)
    xs, ys = [], []
    for b in range(10):
        m = idx == b
        if m.sum() >= 10:
            xs.append(p[m].mean())
            ys.append(y[m].mean())
    fig, ax = plt.subplots(figsize=(4, 4))
    ax.plot([0, 1], [0, 1], "--", color="gray", lw=1)
    ax.plot(xs, ys, "o-", color="#a855f7")
    ax.set_xlabel("predicted PSxG"); ax.set_ylabel("observed goal rate")
    ax.set_title(title); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.tight_layout(); fig.savefig(path, dpi=110); plt.close(fig)


def main() -> None:
    df = pd.read_parquet(HERE / "data" / "processed" / "psxg_shots.parquet")
    df["split"] = S.assign_split(df)
    train_cal = df[df.split.isin(["train", "calib", "val"])].reset_index(drop=True)
    test = df[df.split == "test"].reset_index(drop=True)

    booster = lgb.Booster(model_file=str(MODELS / "psxg_model.txt"))
    calibrators = json.loads((MODELS / "psxg_calibrators.json").read_text())

    # baseline: pre-shot model recalibrated on train+calib+val, scored on test
    base_booster = lgb.Booster(model_file=str(MODELS / "model.txt"))
    base_iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    base_iso.fit(base_booster.predict(E.encode_matrix(train_cal)), train_cal["is_goal"].to_numpy())
    base_p = base_iso.predict(base_booster.predict(E.encode_matrix(test)))
    base_ll = float(log_loss(test["is_goal"], np.clip(base_p, 1e-7, 1 - 1e-7)))
    base_auc = float(roc_auc_score(test["is_goal"], base_p))

    results = {}
    for bucket, keep in BUCKETS.items():
        tb = S.apply_bucket_mask(test, keep_groups=keep)
        y = tb["is_goal"].to_numpy()
        raw = booster.predict(P.psxg_encode_matrix(tb))
        p = np.clip(apply_calibrator(calibrators[bucket], raw), 1e-7, 1 - 1e-7)
        results[bucket] = {
            "n": int(len(y)), "log_loss": round(float(log_loss(y, p)), 4),
            "brier": round(float(brier_score_loss(y, p)), 4),
            "auc": round(float(roc_auc_score(y, p)), 4),
            "pr_auc": round(float(average_precision_score(y, p)), 4),
            "ece": round(ece(y, p), 4), "cal_in_large": round(float(p.sum() / y.sum()), 4),
            "beats_preshot_baseline": bool(log_loss(y, p) < base_ll),
        }
        reliability_plot(y, p, ARTIFACTS / f"psxg_reliability_{bucket}.png",
                         f"PSxG reliability — {bucket} inputs (test)")

    mono_ll = results["full"]["log_loss"] <= results["partial"]["log_loss"] + 0.01 <= results["minimal"]["log_loss"] + 0.02
    mono_auc = results["full"]["auc"] >= results["partial"]["auc"] >= results["minimal"]["auc"]

    lines = ["# PSxG model metrics — held-out on-target test set", "",
             f"Test = {len(test):,} on-target shots (match-level holdout, same split as the "
             f"pre-shot model). Pre-shot-xG-only baseline (recalibrated for this population): "
             f"log loss **{base_ll:.4f}**, AUC **{base_auc:.3f}**.", "",
             "| bucket | n | log_loss | brier | auc | pr_auc | ece | cal_in_large | beats pre-shot baseline |",
             "|---|---|---|---|---|---|---|---|---|"]
    for b in ["full", "partial", "minimal"]:
        r = results[b]
        lines.append(f"| {b} | {r['n']} | {r['log_loss']} | {r['brier']} | {r['auc']} | "
                     f"{r['pr_auc']} | {r['ece']} | {r['cal_in_large']} | "
                     f"{'yes' if r['beats_preshot_baseline'] else 'NO'} |")
    lines += ["", "## Pass / fail", ""]
    all_pass = True
    for b in ["full", "partial", "minimal"]:
        r, t = results[b], TARGETS[b]
        checks = {"log_loss": r["log_loss"] <= t["log_loss"], "auc": r["auc"] >= t["auc"],
                 "cal_in_large": 0.9 <= r["cal_in_large"] <= 1.1,
                 "beats_preshot_baseline": r["beats_preshot_baseline"]}
        all_pass &= all(checks.values())
        lines.append(f"- **{b}**: " + ", ".join(f"{k} {'✓' if v else '✗'}" for k, v in checks.items()))
    lines += ["", f"- **monotonic quality**: log_loss {'✓' if mono_ll else '✗'}, auc {'✓' if mono_auc else '✗'}",
             "", f"## Release gate: {'PASS ✅' if (all_pass and mono_ll and mono_auc) else 'FAIL ❌'}"]

    (MODELS / "psxg_metrics.md").write_text("\n".join(lines) + "\n")
    (ARTIFACTS / "psxg_test_metrics.json").write_text(json.dumps(
        {"baseline_log_loss": base_ll, "baseline_auc": base_auc, "buckets": results,
         "monotonic_log_loss": mono_ll, "monotonic_auc": mono_auc}, indent=2))

    print(f"baseline: logloss={base_ll:.4f} auc={base_auc:.3f}")
    for b in ["full", "partial", "minimal"]:
        r = results[b]
        print(f"  {b:<8} logloss={r['log_loss']}  auc={r['auc']}  ece={r['ece']}  "
              f"cal={r['cal_in_large']}  beats_baseline={r['beats_preshot_baseline']}")
    print(f"  monotonic: log_loss={mono_ll}  auc={mono_auc}")
    print(f"\nwrote {MODELS/'psxg_metrics.md'}")


if __name__ == "__main__":
    main()
