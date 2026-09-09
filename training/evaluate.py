"""
evaluate.py — score the trained model on the untouched test set (held-out competitions).

For each completeness bucket (minimal / partial / full) it masks the test rows the same way
the app would see them, applies that bucket's calibrator, and reports the spec 8.6 metrics
plus a reliability diagram. Writes ../models/metrics.md and PNGs under ./artifacts.
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
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, log_loss,
                             roc_auc_score)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import datasplit as S
import encode as E

HERE = Path(__file__).parent
MODELS = HERE.parent / "models"
ARTIFACTS = HERE / "artifacts"

# spec 8.6 acceptance thresholds
TARGETS = {
    "full":    {"log_loss": 0.30, "brier": 0.085, "auc": 0.79, "corr": 0.85},
    "partial": {"log_loss": 0.31, "brier": 0.087, "auc": 0.77, "corr": 0.82},
    "minimal": {"log_loss": 0.32, "brier": 0.090, "auc": 0.76, "corr": 0.80},
}
BUCKETS = {
    "minimal": set(),
    "partial": {"freeze_frame"},
    "full": {"freeze_frame", "assist", "technique", "pass_origin", "context"},
}


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


def reliability_plot(y: np.ndarray, p: np.ndarray, path: Path, title: str) -> None:
    edges = np.linspace(0, 1, 11)
    idx = np.clip(np.digitize(p, edges) - 1, 0, 9)
    xs, ys = [], []
    for b in range(10):
        m = idx == b
        if m.sum() >= 15:
            xs.append(p[m].mean())
            ys.append(y[m].mean())
    fig, ax = plt.subplots(figsize=(4, 4))
    ax.plot([0, 1], [0, 1], "--", color="gray", lw=1)
    ax.plot(xs, ys, "o-", color="#2f6f4f")
    ax.set_xlabel("predicted xG"); ax.set_ylabel("observed goal rate")
    ax.set_title(title); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.tight_layout(); fig.savefig(path, dpi=110); plt.close(fig)


def by_distance_band(y: np.ndarray, p: np.ndarray, dist: np.ndarray) -> list[dict]:
    bands = [(0, 6), (6, 11), (11, 16), (16, 24), (24, 120)]
    rows = []
    for lo, hi in bands:
        m = (dist >= lo) & (dist < hi)
        if m.sum() >= 20:
            rows.append({"band": f"{lo}-{hi}", "n": int(m.sum()),
                         "obs": round(float(y[m].mean()), 4),
                         "pred": round(float(p[m].mean()), 4),
                         "log_loss": round(float(log_loss(y[m], np.clip(p[m], 1e-7, 1 - 1e-7),
                                                          labels=[0, 1])), 4)})
    return rows


def by_competition(y: np.ndarray, p: np.ndarray, comp: np.ndarray) -> list[dict]:
    rows = []
    for c in sorted(set(comp)):
        m = comp == c
        if m.sum() >= 50:
            rows.append({"competition": str(c), "n": int(m.sum()),
                         "obs_goals": int(y[m].sum()), "pred_xg": round(float(p[m].sum()), 1),
                         "ratio": round(float(p[m].sum() / max(y[m].sum(), 1)), 3),
                         "auc": round(float(roc_auc_score(y[m], p[m])), 3)
                         if 0 < y[m].sum() < m.sum() else None})
    return rows


def main() -> None:
    df = pd.read_parquet(HERE / "data" / "processed" / "shots.parquet")
    df["split"] = S.assign_split(df)
    train = df[df.split == "train"].reset_index(drop=True)
    test = df[df.split == "test"].reset_index(drop=True)

    booster = lgb.Booster(model_file=str(MODELS / "model.txt"))
    calibrators = json.loads((MODELS / "calibrators.json").read_text())

    # baseline (geometry-only logistic) refit on train, scored on test — the bar to beat
    base = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    base.fit(train[["distance", "angle"]], train["is_goal"])
    yb = test["is_goal"].to_numpy()
    base_ll = log_loss(yb, np.clip(base.predict_proba(test[["distance", "angle"]])[:, 1],
                                   1e-7, 1 - 1e-7))

    results = {}
    for bucket, keep in BUCKETS.items():
        tb = S.apply_bucket_mask(test, keep_groups=keep)
        y = tb["is_goal"].to_numpy()
        raw = booster.predict(E.encode_matrix(tb))
        p = np.clip(apply_calibrator(calibrators[bucket], raw), 1e-7, 1 - 1e-7)

        sb = tb["sb_xg"].to_numpy(dtype="float64")
        sb_mask = ~np.isnan(sb)
        corr = float(np.corrcoef(p[sb_mask], sb[sb_mask])[0, 1])

        results[bucket] = {
            "n": int(len(y)),
            "log_loss": round(float(log_loss(y, p)), 4),
            "brier": round(float(brier_score_loss(y, p)), 4),
            "auc": round(float(roc_auc_score(y, p)), 4),
            "pr_auc": round(float(average_precision_score(y, p)), 4),
            "ece": round(ece(y, p), 4),
            "cal_in_large": round(float(p.sum() / y.sum()), 4),
            "corr_vs_statsbomb": round(corr, 4),
            "beats_baseline": bool(log_loss(y, p) < base_ll),
            "by_distance": by_distance_band(y, p, tb["distance"].to_numpy()),
            "by_competition": by_competition(y, p, tb["competition_name"].to_numpy()),
        }
        reliability_plot(y, p, ARTIFACTS / f"reliability_{bucket}.png",
                         f"Reliability — {bucket} inputs (test)")

    # "richer inputs never do meaningfully worse". Log loss is noisy on a few-thousand-row
    # test set, so allow a small tolerance there; AUC and Brier must be strictly ordered.
    TOL = 0.004
    mono_ll = (results["full"]["log_loss"] <= results["partial"]["log_loss"] + TOL
               <= results["minimal"]["log_loss"] + 2 * TOL)
    mono_auc = results["full"]["auc"] >= results["partial"]["auc"] >= results["minimal"]["auc"]
    mono_brier = results["full"]["brier"] <= results["partial"]["brier"] <= results["minimal"]["brier"]

    # --- write metrics.md -----------------------------------------
    lines = ["# Model metrics — held-out test set", "",
             f"Test = 15% match-level holdout across all competitions "
             f"({len(test):,} shots, {test.is_goal.sum()} goals, {test.match_id.nunique()} matches). "
             f"Shots from a match never straddle train/test.",
             f"Baseline (geometry-only logistic) test log loss = **{base_ll:.4f}**.", ""]
    hdr = "| bucket | n | log_loss | brier | auc | pr_auc | ece | cal_in_large | corr vs SB | beats baseline |"
    lines += [hdr, "|" + "---|" * 11]
    for b in ["full", "partial", "minimal"]:
        r = results[b]
        lines.append(f"| {b} | {r['n']} | {r['log_loss']} | {r['brier']} | {r['auc']} | "
                     f"{r['pr_auc']} | {r['ece']} | {r['cal_in_large']} | {r['corr_vs_statsbomb']} | "
                     f"{'yes' if r['beats_baseline'] else 'NO'} |")
    lines += ["", "## Pass / fail vs spec 8.6", ""]
    all_pass = True
    for b in ["full", "partial", "minimal"]:
        r, t = results[b], TARGETS[b]
        checks = {
            "log_loss": r["log_loss"] <= t["log_loss"],
            "brier": r["brier"] <= t["brier"],
            "auc": r["auc"] >= t["auc"],
            "ece": r["ece"] <= 0.03,
            "cal_in_large": 0.95 <= r["cal_in_large"] <= 1.05,
            "corr": r["corr_vs_statsbomb"] >= t["corr"],
            "beats_baseline": r["beats_baseline"],
        }
        all_pass &= all(checks.values())
        lines.append(f"- **{b}**: " + ", ".join(
            f"{k} {'✓' if v else '✗'}" for k, v in checks.items()))
    lines += ["",
              f"- **monotonic quality** (full ≥ partial ≥ minimal): "
              f"log_loss(±{TOL}) {'✓' if mono_ll else '✗'}, auc {'✓' if mono_auc else '✗'}, "
              f"brier {'✓' if mono_brier else '✗'}",
              "",
              f"## Release gate: "
              f"{'PASS ✅' if (all_pass and mono_ll and mono_auc and mono_brier) else 'FAIL ❌'}",
              "",
              "Reliability diagrams: `training/artifacts/reliability_{full,partial,minimal}.png`",
              "", "## Error by distance band (full inputs)", "",
              "| band (units) | n | observed | predicted | log_loss |",
              "|---|---|---|---|---|"]
    for r in results["full"]["by_distance"]:
        lines.append(f"| {r['band']} | {r['n']} | {r['obs']} | {r['pred']} | {r['log_loss']} |")

    lines += ["", "## Generalization — per-competition (full inputs)", "",
              "| competition | n | goals | pred xG | xG/goals | auc |",
              "|---|---|---|---|---|---|"]
    for r in results["full"]["by_competition"]:
        lines.append(f"| {r['competition']} | {r['n']} | {r['obs_goals']} | {r['pred_xg']} | "
                     f"{r['ratio']} | {r['auc']} |")

    (MODELS / "metrics.md").write_text("\n".join(lines) + "\n")
    (ARTIFACTS / "test_metrics.json").write_text(json.dumps(
        {"baseline_log_loss": base_ll, "buckets": results, "monotonic_log_loss": mono_ll,
         "monotonic_auc": mono_auc, "monotonic_brier": mono_brier}, indent=2))

    print(f"baseline test log loss: {base_ll:.4f}")
    for b in ["full", "partial", "minimal"]:
        r = results[b]
        print(f"  {b:<8} logloss={r['log_loss']}  brier={r['brier']}  auc={r['auc']}  "
              f"ece={r['ece']}  cal={r['cal_in_large']}  corrSB={r['corr_vs_statsbomb']}")
    print(f"  monotonic: log_loss={mono_ll}  auc={mono_auc}")
    print(f"\nwrote {MODELS/'metrics.md'}")


if __name__ == "__main__":
    main()
