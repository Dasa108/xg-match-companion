"""
model_comparison.py — does a different tree-ensemble beat the shipped LightGBM?

Scratch experiment. It never writes to ../models: the shipped model is untouched. Every
candidate is trained and judged with the *same protocol as the shipped pipeline*:

  * same match-level split (datasplit.assign_split): train / val / calib / test
  * same augmented training matrix (feature-group dropout + jitter, SEED 17, n_random=3)
  * same early-stopping validation set (val, mirrored across completeness levels)
  * same per-completeness-bucket isotonic calibration, fit on calib ∪ val
  * same test-set metrics as evaluate.py (log loss, Brier, AUC, PR-AUC, ECE,
    calibration-in-the-large, correlation vs StatsBomb xG), per bucket

Candidates
  lgbm_current     the shipped configuration, refit (harness check: must reproduce shipped)
  lgbm_tuned       small grid over depth / leaves / min-child, chosen on val
  lgbm_seedbag5    5 LightGBM members, different seeds, probabilities averaged
  lgbm_matchbag5   5 LightGBM members, each on a bootstrap resample of training MATCHES
  xgb_tuned        XGBoost, small grid, chosen on val (monotone constraints kept)
  rf_tuned         random forest (bagged deep trees), small grid, chosen on val

Hyper-parameter choices use val only (calibrators fit on calib, scored on val — both unseen
by the model). The test set is touched once per candidate, at the end. Uncertainty on the
test set comes from a paired cluster bootstrap over test *matches* (shots inside a match
are not independent), so a difference is only called real if its CI excludes zero.

Run:  python experiments/model_comparison.py            (full)
      python experiments/model_comparison.py --smoke    (tiny grids, ~1 min, harness check)
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
import time
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

TRAIN_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TRAIN_DIR))

import datasplit as S  # noqa: E402
import encode as E  # noqa: E402
from evaluate import ece  # noqa: E402
from train import BUCKETS, SEED, build_early_stop_val  # noqa: E402

# The shipped train.py uses LightGBM's `eval_set=` argument; newer LightGBM warns it is
# deprecated. Kept identical here on purpose (reproducing the shipped call is the point) —
# the warning is just noise, once per fit.
warnings.filterwarnings("ignore", message="The argument 'eval_set' is deprecated")

OUT = Path(__file__).resolve().parent / "results"
MODELS = TRAIN_DIR.parent / "models"
EPS = 1e-7
BUCKET_ORDER = ["full", "partial", "minimal"]


# ---------------------------------------------------------------- data ----------
def prepare():
    df = pd.read_parquet(TRAIN_DIR / "data" / "processed" / "shots.parquet")
    df["split"] = S.assign_split(df)
    part = {k: df[df.split == k].reset_index(drop=True) for k in ["train", "val", "calib", "test"]}

    rng = np.random.default_rng(SEED)  # identical RNG consumption order to train.py
    train_aug = S.build_training_matrix(part["train"], rng, n_random=3)
    es_val = build_early_stop_val(part["val"], rng)

    data = {
        "Xtr": E.encode_matrix(train_aug),
        "ytr": train_aug["is_goal"].to_numpy(),
        "match_tr": train_aug["match_id"].to_numpy(),
        "Xes": E.encode_matrix(es_val),
        "yes": es_val["is_goal"].to_numpy(),
        "X": {},  # X[split][bucket]
        "y": {},  # y[split]
    }
    for split in ["calib", "val", "test"]:
        f = part[split]
        data["y"][split] = f["is_goal"].to_numpy()
        data["X"][split] = {
            b: E.encode_matrix(S.apply_bucket_mask(f, keep_groups=k)) for b, k in BUCKETS.items()
        }
    test = part["test"]
    data["sb_xg"] = test["sb_xg"].to_numpy(dtype="float64")
    data["match_test"] = test["match_id"].to_numpy()
    return data


# ------------------------------------------------------------- prediction -------
def predict_all(predict, data) -> dict:
    """Raw P(goal) for every (split, bucket) we will need. calib∪val is derived, not recomputed."""
    return {s: {b: predict(data["X"][s][b]) for b in BUCKETS} for s in ["calib", "val", "test"]}


def avg_preds(members: list[dict]) -> dict:
    return {s: {b: np.mean([m[s][b] for m in members], axis=0) for b in BUCKETS}
            for s in ["calib", "val", "test"]}


def _iso(raw, y):
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(raw, y)
    return iso


def val_score(P: dict, data) -> float:
    """Selection metric: calibrators fit on calib, log loss on val, mean over the 3 buckets."""
    ll = []
    for b in BUCKETS:
        iso = _iso(P["calib"][b], data["y"]["calib"])
        p = np.clip(iso.predict(P["val"][b]), EPS, 1 - EPS)
        ll.append(log_loss(data["y"]["val"], p, labels=[0, 1]))
    return float(np.mean(ll))


def final_probs(P: dict, data) -> dict:
    """Shipped protocol: isotonic per bucket, fit on calib ∪ val, applied to test."""
    y_pool = np.concatenate([data["y"]["calib"], data["y"]["val"]])
    out = {}
    for b in BUCKETS:
        raw_pool = np.concatenate([P["calib"][b], P["val"][b]])
        iso = _iso(raw_pool, y_pool)
        out[b] = np.clip(iso.predict(P["test"][b]), EPS, 1 - EPS)
    return out


def shot_loss(y, p):
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def test_metrics(y, p, sb) -> dict:
    m = ~np.isnan(sb)
    return {
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier": float(brier_score_loss(y, p)),
        "auc": float(roc_auc_score(y, p)),
        "pr_auc": float(average_precision_score(y, p)),
        "ece": float(ece(y, p)),
        "cal_in_large": float(p.sum() / y.sum()),
        "corr_vs_statsbomb": float(np.corrcoef(p[m], sb[m])[0, 1]),
    }


def cluster_boot_delta(vec_a, vec_b, match_ids, rng, B=4000):
    """Paired cluster bootstrap over matches of mean(vec_a) - mean(vec_b)."""
    uniq, inv = np.unique(match_ids, return_inverse=True)
    M = len(uniq)
    d_sum = np.bincount(inv, weights=vec_a - vec_b, minlength=M)
    n = np.bincount(inv, minlength=M).astype(float)
    W = rng.multinomial(M, np.full(M, 1.0 / M), size=B).astype(float)
    boot = (W @ d_sum) / (W @ n)
    return {"delta": float((vec_a - vec_b).mean()),
            "ci_lo": float(np.percentile(boot, 2.5)),
            "ci_hi": float(np.percentile(boot, 97.5))}


# --------------------------------------------------------------- learners -------
LGBM_BASE = dict(objective="binary", n_estimators=4000, learning_rate=0.02, num_leaves=31,
                 max_depth=5, min_child_samples=60, subsample=0.8, subsample_freq=1,
                 colsample_bytree=0.8, reg_lambda=1.0, monotone_constraints=E.MONOTONE,
                 monotone_constraints_method="advanced", n_jobs=-1, verbose=-1)


def fit_lgbm(data, seed, overrides=None, weight=None):
    t0 = time.time()
    m = lgb.LGBMClassifier(**{**LGBM_BASE, **(overrides or {}), "random_state": seed})
    m.fit(data["Xtr"], data["ytr"], sample_weight=weight,
          eval_set=[(data["Xes"], data["yes"])], eval_metric="binary_logloss",
          callbacks=[lgb.early_stopping(120, verbose=False)])
    it = m.best_iteration_
    nodes = int(len(m.booster_.trees_to_dataframe()))
    return (lambda X: m.predict_proba(X, num_iteration=it)[:, 1],
            {"best_iteration": int(it), "tree_nodes": nodes, "fit_s": round(time.time() - t0, 1)},
            m)


def fit_xgb(data, seed, cfg):
    t0 = time.time()
    m = xgb.XGBClassifier(
        objective="binary:logistic", eval_metric="logloss", tree_method="hist",
        n_estimators=4000, learning_rate=0.02, subsample=0.8, colsample_bytree=0.8,
        reg_lambda=1.0, monotone_constraints=tuple(E.MONOTONE), early_stopping_rounds=120,
        random_state=seed, n_jobs=-1, **cfg)
    m.fit(data["Xtr"], data["ytr"], eval_set=[(data["Xes"], data["yes"])], verbose=False)
    it = m.best_iteration + 1
    nodes = int(len(m.get_booster()[:it].trees_to_dataframe()))
    return (lambda X: m.predict_proba(X, iteration_range=(0, it))[:, 1],
            {"best_iteration": int(it), "tree_nodes": nodes, "fit_s": round(time.time() - t0, 1)})


def fit_rf(data, seed, cfg, n_trees):
    t0 = time.time()
    m = RandomForestClassifier(n_estimators=n_trees, n_jobs=6, random_state=seed, **cfg)
    m.fit(data["Xtr"], data["ytr"])
    nodes = int(sum(t.tree_.node_count for t in m.estimators_))
    return (lambda X: m.predict_proba(X)[:, 1],
            {"tree_nodes": nodes, "fit_s": round(time.time() - t0, 1)})


def match_bootstrap_weights(match_tr, rng):
    uniq, inv = np.unique(match_tr, return_inverse=True)
    counts = rng.multinomial(len(uniq), np.full(len(uniq), 1.0 / len(uniq)))
    return counts[inv].astype(float)


# ------------------------------------------------------------------- main -------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    smoke = args.smoke
    OUT.mkdir(exist_ok=True)
    t_start = time.time()

    print("preparing data …", flush=True)
    data = prepare()
    print(f"  train_aug {data['Xtr'].shape}  es {data['Xes'].shape}  "
          f"test shots {len(data['y']['test']):,}  test matches {len(np.unique(data['match_test']))}",
          flush=True)

    cands: dict[str, dict] = {}   # name -> {"P": preds, "meta": {...}, "label": str}
    grids: dict[str, list] = {}   # name -> [{"cfg":..., "val_ll":...}]
    members: dict[str, list] = {}

    # ---- 1. lgbm_current + harness check against the shipped model --------------------
    print("\n[1] lgbm_current (refit) …", flush=True)
    pred, meta, model = fit_lgbm(data, SEED)
    P_cur = predict_all(pred, data)
    cands["lgbm_current"] = {"P": P_cur, "meta": meta, "label": "LightGBM (shipped config)"}
    shipped = lgb.Booster(model_file=str(MODELS / "model.txt"))
    diff = float(np.max(np.abs(shipped.predict(data["X"]["test"]["full"]) - P_cur["test"]["full"])))
    print(f"  best_iter={meta['best_iteration']} fit={meta['fit_s']}s  "
          f"max|refit − shipped| raw prob (test/full) = {diff:.2e}", flush=True)
    harness = {"refit_vs_shipped_max_abs_diff": diff,
               "shipped_best_iteration": int(json.loads((MODELS / "feature_spec.json").read_text())["best_iteration"]),
               "refit_best_iteration": meta["best_iteration"]}

    # ---- 2. lgbm_tuned ----------------------------------------------------------------
    print("\n[2] lgbm grid …", flush=True)
    g = {"num_leaves": [15, 31], "max_depth": [4, 5, 6], "min_child_samples": [30, 60, 120]}
    if smoke:
        g = {"num_leaves": [31], "max_depth": [5], "min_child_samples": [60, 120]}
    rows, best = [], None
    for vals in itertools.product(*g.values()):
        cfg = dict(zip(g.keys(), vals))
        pr, mt, _ = fit_lgbm(data, SEED, cfg)
        P = predict_all(pr, data)
        v = val_score(P, data)
        rows.append({"cfg": cfg, "val_ll": round(v, 5), "best_iteration": mt["best_iteration"]})
        print(f"  {cfg}  val_ll={v:.5f}  it={mt['best_iteration']}", flush=True)
        if best is None or v < best[0]:
            best = (v, cfg, P, mt)
    grids["lgbm_tuned"] = rows
    cands["lgbm_tuned"] = {"P": best[2], "meta": {**best[3], "chosen_cfg": best[1]},
                           "label": "LightGBM (grid-tuned on val)"}

    # ---- 3. bagging: seed-average and match-bootstrap ---------------------------------
    n_mem = 2 if smoke else 5
    print(f"\n[3] lgbm_seedbag{n_mem} …", flush=True)
    seeds = [SEED + 101 * k for k in range(n_mem)]      # member 0 == the shipped seed
    sb_members = []
    for s in seeds:
        pr, mt, _ = fit_lgbm(data, s)
        sb_members.append({"P": predict_all(pr, data), "meta": mt, "seed": s})
        print(f"  seed {s}: it={mt['best_iteration']}  fit={mt['fit_s']}s", flush=True)
    members["lgbm_seedbag5"] = sb_members
    cands["lgbm_seedbag5"] = {
        "P": avg_preds([m["P"] for m in sb_members]),
        "meta": {"members": n_mem,
                 "tree_nodes": sum(m["meta"]["tree_nodes"] for m in sb_members),
                 "fit_s": round(sum(m["meta"]["fit_s"] for m in sb_members), 1)},
        "label": f"LightGBM × {n_mem} seeds (averaged)"}

    print(f"\n[3b] lgbm_matchbag{n_mem} …", flush=True)
    brng = np.random.default_rng(SEED + 7)
    mb_members = []
    for k in range(n_mem):
        w = match_bootstrap_weights(data["match_tr"], brng)
        pr, mt, _ = fit_lgbm(data, SEED + 101 * k, weight=w)
        mb_members.append({"P": predict_all(pr, data), "meta": mt})
        print(f"  member {k}: it={mt['best_iteration']}  fit={mt['fit_s']}s", flush=True)
    members["lgbm_matchbag5"] = mb_members
    cands["lgbm_matchbag5"] = {
        "P": avg_preds([m["P"] for m in mb_members]),
        "meta": {"members": n_mem,
                 "tree_nodes": sum(m["meta"]["tree_nodes"] for m in mb_members),
                 "fit_s": round(sum(m["meta"]["fit_s"] for m in mb_members), 1)},
        "label": f"LightGBM × {n_mem} match-bootstrap bags"}

    # ---- 4. XGBoost -------------------------------------------------------------------
    print("\n[4] xgboost grid …", flush=True)
    gx = {"max_depth": [4, 5, 6], "min_child_weight": [2, 5, 10]}
    if smoke:
        gx = {"max_depth": [5], "min_child_weight": [5]}
    rows, best = [], None
    for vals in itertools.product(*gx.values()):
        cfg = dict(zip(gx.keys(), vals))
        pr, mt = fit_xgb(data, SEED, cfg)
        P = predict_all(pr, data)
        v = val_score(P, data)
        rows.append({"cfg": cfg, "val_ll": round(v, 5), "best_iteration": mt["best_iteration"]})
        print(f"  {cfg}  val_ll={v:.5f}  it={mt['best_iteration']}", flush=True)
        if best is None or v < best[0]:
            best = (v, cfg, P, mt)
    grids["xgb_tuned"] = rows
    cands["xgb_tuned"] = {"P": best[2], "meta": {**best[3], "chosen_cfg": best[1]},
                          "label": "XGBoost (grid-tuned on val)"}

    # ---- 5. Random forest -------------------------------------------------------------
    print("\n[5] random forest grid …", flush=True)
    gr = {"min_samples_leaf": [25, 60, 120], "max_features": [0.3, 0.6]}
    n_trees = 300
    if smoke:
        gr, n_trees = {"min_samples_leaf": [120], "max_features": [0.3]}, 40
    rows, best = [], None
    for vals in itertools.product(*gr.values()):
        cfg = dict(zip(gr.keys(), vals))
        pr, mt = fit_rf(data, SEED, cfg, n_trees)
        P = predict_all(pr, data)
        v = val_score(P, data)
        rows.append({"cfg": cfg, "val_ll": round(v, 5), "tree_nodes": mt["tree_nodes"]})
        print(f"  {cfg}  val_ll={v:.5f}  nodes={mt['tree_nodes']:,}  fit={mt['fit_s']}s", flush=True)
        if best is None or v < best[0]:
            best = (v, cfg, P, mt)
    grids["rf_tuned"] = rows
    cands["rf_tuned"] = {"P": best[2], "meta": {**best[3], "chosen_cfg": best[1]},
                         "label": f"Random forest ({n_trees} trees, grid-tuned on val)"}

    # ---- 6. evaluate every candidate on test (once) ----------------------------------
    print("\n[6] test evaluation + paired cluster bootstrap …", flush=True)
    y = data["y"]["test"]
    mids = data["match_test"]
    brng = np.random.default_rng(SEED + 99)
    final = {n: final_probs(c["P"], data) for n, c in cands.items()}
    results = {}
    for n, c in cands.items():
        results[n] = {"label": c["label"], "meta": c["meta"], "buckets": {}}
        for b in BUCKET_ORDER:
            m = test_metrics(y, final[n][b], data["sb_xg"])
            if n != "lgbm_current":
                m["delta_ll_vs_current"] = cluster_boot_delta(
                    shot_loss(y, final[n][b]), shot_loss(y, final["lgbm_current"][b]), mids, brng)
                m["delta_brier_vs_current"] = cluster_boot_delta(
                    (final[n][b] - y) ** 2, (final["lgbm_current"][b] - y) ** 2, mids, brng)
            results[n]["buckets"][b] = m

    # seed noise floor: each member individually calibrated
    floor = {}
    for label, mem in members.items():
        per_bucket = {}
        for b in BUCKET_ORDER:
            lls = []
            for m in mem:
                fp = final_probs(m["P"], data)[b]
                lls.append(float(log_loss(y, fp, labels=[0, 1])))
            per_bucket[b] = {"members": [round(v, 5) for v in lls],
                             "mean": round(float(np.mean(lls)), 5),
                             "sd": round(float(np.std(lls, ddof=1)), 5) if len(lls) > 1 else None,
                             "range": round(max(lls) - min(lls), 5)}
        floor[label] = per_bucket

    # ensemble-size curves (test log loss, calibrated ensemble of the first k members)
    curves = {}
    for label, mem in members.items():
        curves[label] = {}
        for b in BUCKET_ORDER:
            pts = []
            for k in range(1, len(mem) + 1):
                fp = final_probs(avg_preds([m["P"] for m in mem[:k]]), data)[b]
                pts.append(round(float(log_loss(y, fp, labels=[0, 1])), 5))
            curves[label][b] = pts

    out = {"harness": harness, "test_shots": int(len(y)), "test_goals": int(y.sum()),
           "test_matches": int(len(np.unique(mids))), "candidates": results,
           "seed_noise_floor": floor, "ensemble_size_curves": curves, "grids": grids,
           "smoke": smoke, "total_seconds": round(time.time() - t_start, 1)}
    path = OUT / ("model_comparison_smoke.json" if smoke else "model_comparison.json")
    path.write_text(json.dumps(out, indent=2, default=lambda o: o if not isinstance(o, np.generic) else o.item()))
    print(f"\nwrote {path}  (total {out['total_seconds']}s)", flush=True)

    print("\nFULL-bucket test log loss:")
    for n, r in results.items():
        f = r["buckets"]["full"]
        d = f.get("delta_ll_vs_current")
        ds = f"  Δ={d['delta']:+.5f} [{d['ci_lo']:+.5f},{d['ci_hi']:+.5f}]" if d else ""
        print(f"  {n:<16} ll={f['log_loss']:.5f} auc={f['auc']:.4f} cal={f['cal_in_large']:.3f}{ds}")


if __name__ == "__main__":
    main()
