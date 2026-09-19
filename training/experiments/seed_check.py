"""
seed_check.py — is the grid-tuned LightGBM really better, or did it just draw a lucky seed?

model_comparison.py compared ONE fit of the tuned configuration against ONE fit of the shipped
configuration. A single fit has seed-to-seed noise about as large as the gap it found. This
retrains BOTH configurations with 10 different seeds each and compares them on average, so seed
luck cancels. Each member is individually calibrated (the shipped protocol); per-shot losses are
averaged across the 10 members of a configuration, then compared with the same paired cluster
bootstrap over test matches.

Run:  python experiments/seed_check.py     (~2 min; writes results/seed_check.json)
"""

from __future__ import annotations

import json

import numpy as np

import model_comparison as M

CONFIGS = {
    "shipped": {},
    "tuned": {"num_leaves": 15, "max_depth": 6, "min_child_samples": 60},
}
N_SEEDS = 10


def main() -> None:
    data = M.prepare()
    y, mids = data["y"]["test"], data["match_test"]
    seeds = [M.SEED + 101 * k for k in range(N_SEEDS)]
    loss = {c: {b: [] for b in M.BUCKET_ORDER} for c in CONFIGS}
    ll = {c: {b: [] for b in M.BUCKET_ORDER} for c in CONFIGS}
    for name, ov in CONFIGS.items():
        for s in seeds:
            pred, meta, _ = M.fit_lgbm(data, s, ov)
            fp = M.final_probs(M.predict_all(pred, data), data)
            for b in M.BUCKET_ORDER:
                v = M.shot_loss(y, fp[b])
                loss[name][b].append(v)
                ll[name][b].append(float(v.mean()))
            print(f"  {name} seed {s}: full={ll[name]['full'][-1]:.5f}  it={meta['best_iteration']}", flush=True)

    rng = np.random.default_rng(M.SEED + 5)
    out = {"n_seeds": N_SEEDS, "seeds": seeds, "configs": CONFIGS, "buckets": {}}
    for b in M.BUCKET_ORDER:
        a = np.mean(loss["tuned"][b], axis=0)
        s = np.mean(loss["shipped"][b], axis=0)
        out["buckets"][b] = {
            "shipped": {"members": [round(v, 5) for v in ll["shipped"][b]],
                        "mean": round(float(np.mean(ll["shipped"][b])), 5),
                        "sd": round(float(np.std(ll["shipped"][b], ddof=1)), 5)},
            "tuned": {"members": [round(v, 5) for v in ll["tuned"][b]],
                      "mean": round(float(np.mean(ll["tuned"][b])), 5),
                      "sd": round(float(np.std(ll["tuned"][b], ddof=1)), 5)},
            "delta_mean_ll_tuned_minus_shipped": M.cluster_boot_delta(a, s, mids, rng),
        }
        d = out["buckets"][b]["delta_mean_ll_tuned_minus_shipped"]
        print(f"{b:<8} shipped mean={out['buckets'][b]['shipped']['mean']:.5f}  "
              f"tuned mean={out['buckets'][b]['tuned']['mean']:.5f}  "
              f"Δ={d['delta']:+.5f} [{d['ci_lo']:+.5f},{d['ci_hi']:+.5f}]", flush=True)
    (M.OUT / "seed_check.json").write_text(json.dumps(out, indent=2))
    print("wrote", M.OUT / "seed_check.json")


if __name__ == "__main__":
    main()
