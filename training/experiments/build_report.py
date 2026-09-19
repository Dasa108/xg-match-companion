"""
build_report.py — write REPORT.md from results/*.json.

Every number in the tables comes from the JSON; the prose is the same findings text used by
the results page (results/artifact_copy.json), so the two can't drift apart.

Run:  python experiments/build_report.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RES = HERE / "results"
d = json.loads((RES / "model_comparison.json").read_text())
fu = json.loads((RES / "seed_check.json").read_text())
copy = json.loads((RES / "artifact_copy.json").read_text())
C = d["candidates"]

ORDER = ["lgbm_current", "lgbm_tuned", "lgbm_seedbag5", "lgbm_matchbag5", "xgb_tuned", "rf_tuned"]
NAME = {"lgbm_current": "LightGBM (shipped)", "lgbm_tuned": "LightGBM, tuned",
        "lgbm_seedbag5": "LightGBM × 5 seeds", "lgbm_matchbag5": "LightGBM × 5 match-bags",
        "xgb_tuned": "XGBoost, tuned", "rf_tuned": "Random forest"}
BUCKETS = ["full", "partial", "minimal"]
cur_nodes = C["lgbm_current"]["meta"]["tree_nodes"]


def sg(v, n=4):
    return f"{'+' if v > 0 else '−' if v < 0 else '±'}{abs(v):.{n}f}"


def verdict(dd):
    return "worse" if dd["ci_lo"] > 0 else "better" if dd["ci_hi"] < 0 else "no clear difference"


L = ["# Boosting vs Bagging — does another tree ensemble beat the shipped xG model?", "",
     f"Run on the held-out test set: {d['test_shots']:,} shots, {d['test_goals']} goals, "
     f"{d['test_matches']} matches. Scripts: `model_comparison.py` (main run), `seed_check.py` "
     f"(10-seed follow-up), `plot_results.py`, `build_artifact.py`, this file via `build_report.py`. "
     f"Raw output: `results/`.", "",
     "![Δ log loss](results/delta_logloss.png)", "",
     "## Findings", ""]
for f in copy["findings"]:
    L += [f"**{f['h']}** {f['p']}", ""]

L += ["## Scoreboard", "",
      "Same protocol as the shipped model (match-level split, same augmentation, same per-bucket "
      "isotonic calibration on calibration ∪ validation). Δ is paired (candidate − shipped): "
      "lower log loss is better; the interval is a 95% cluster bootstrap over test matches.", ""]
for b in BUCKETS:
    L += [f"### {b} inputs", "",
          "| model | log loss | Δ vs shipped [95% CI] | verdict | Brier | AUC | cal-in-large | tree nodes | fit |",
          "|---|---|---|---|---|---|---|---|---|"]
    for n in ORDER:
        m = C[n]["buckets"][b]
        dd = m.get("delta_ll_vs_current")
        dtxt = f"{sg(dd['delta'])} [{sg(dd['ci_lo'])}, {sg(dd['ci_hi'])}]" if dd else "reference"
        L.append(f"| {NAME[n]} | {m['log_loss']:.4f} | {dtxt} | {verdict(dd) if dd else '—'} | "
                 f"{m['brier']:.4f} | {m['auc']:.4f} | {m['cal_in_large']:.3f} | "
                 f"{C[n]['meta']['tree_nodes']:,} ({C[n]['meta']['tree_nodes'] / cur_nodes:.1f}×) | "
                 f"{C[n]['meta']['fit_s']}s |")
    L.append("")

L += ["## Seed noise (the yardstick)", "",
      "Retraining the same model with only the random seed changed, each member calibrated "
      "individually. Full-input test log loss:", "",
      "| set | seeds | mean | sd | range |", "|---|---|---|---|---|"]
sf = d["seed_noise_floor"]["lgbm_seedbag5"]["full"]
L.append(f"| shipped config, first run | 5 | {sf['mean']:.5f} | {sf['sd']:.5f} | {sf['range']:.5f} |")
s10 = fu["buckets"]["full"]["shipped"]
t10 = fu["buckets"]["full"]["tuned"]
L.append(f"| shipped config, follow-up | {fu['n_seeds']} | {s10['mean']:.5f} | {s10['sd']:.5f} | "
         f"{max(s10['members']) - min(s10['members']):.5f} |")
L.append(f"| tuned config, follow-up | {fu['n_seeds']} | {t10['mean']:.5f} | {t10['sd']:.5f} | "
         f"{max(t10['members']) - min(t10['members']):.5f} |")
L += ["", "![ensemble size](results/ensemble_size.png)", "",
      "## Follow-up: tuned vs shipped LightGBM, 10 seeds each", "",
      "| inputs | shipped mean ± sd | tuned mean ± sd | tuned − shipped [95% CI] | verdict |",
      "|---|---|---|---|---|"]
for b in BUCKETS:
    v = fu["buckets"][b]
    dd = v["delta_mean_ll_tuned_minus_shipped"]
    L.append(f"| {b} | {v['shipped']['mean']:.4f} ± {v['shipped']['sd']:.4f} | "
             f"{v['tuned']['mean']:.4f} ± {v['tuned']['sd']:.4f} | "
             f"{sg(dd['delta'])} [{sg(dd['ci_lo'])}, {sg(dd['ci_hi'])}] | {verdict(dd)} |")

L += ["", "## Tuning grids (validation log loss, mean over the 3 buckets)", ""]
for k, rows in d["grids"].items():
    best = min(r["val_ll"] for r in rows)
    keys = list(rows[0]["cfg"])
    L += [f"### {NAME[k].split(',')[0] if k != 'rf_tuned' else 'Random forest'}", "",
          "| " + " | ".join(keys) + " | val log loss |", "|" + "---|" * (len(keys) + 1)]
    for r in rows:
        mark = " ◂ chosen" if r["val_ll"] == best else ""
        L.append("| " + " | ".join(str(r["cfg"][c]) for c in keys) + f" | {r['val_ll']:.5f}{mark} |")
    L.append("")

L += ["## Method and limits", "",
      f"- The refit of the shipped configuration reproduces the shipped model exactly "
      f"(max prediction difference {d['harness']['refit_vs_shipped_max_abs_diff']}, best iteration "
      f"{d['harness']['refit_best_iteration']} = shipped {d['harness']['shipped_best_iteration']}).",
      "- Bagging two ways: seed-averaging, and match-bootstrap bagging (each member trained on a "
      "resample of whole training matches, via multiplicity weights). Probabilities are averaged "
      "then calibrated once.",
      "- Monotone constraints kept for LightGBM and XGBoost. The random forest ran unconstrained "
      "(scikit-learn does not support monotone constraints with missing values).",
      "- The validation set that picks each grid winner is also the early-stopping set for the "
      "boosted models, which flatters them slightly. The test set was looked at twice (the "
      "six-model comparison, then the 10-seed follow-up). One split, one test set of "
      f"{d['test_goals']} goals.",
      "- Not tried: CatBoost, stacking, feature changes, tuning beyond these small grids, a second "
      "random split.", ""]
(HERE / "REPORT.md").write_text("\n".join(L))
print("wrote", HERE / "REPORT.md")
