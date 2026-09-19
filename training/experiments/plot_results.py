"""
plot_results.py — turn results/model_comparison.json into the report's figures.

  results/delta_logloss.png   paired Δ log loss vs the shipped model, 95% cluster-bootstrap CI,
                              per completeness bucket (left of zero = better than shipped)
  results/ensemble_size.png   full-bucket test log loss as bagged ensembles grow from 1 to 5
                              members, against the shipped single model and the seed-to-seed spread

Run:  python experiments/plot_results.py
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

RES = Path(__file__).resolve().parent / "results"
d = json.loads((RES / "model_comparison.json").read_text())
C = d["candidates"]

ORDER = ["lgbm_tuned", "lgbm_seedbag5", "lgbm_matchbag5", "xgb_tuned", "rf_tuned"]
LABEL = {
    "lgbm_tuned": "LightGBM, grid-tuned",
    "lgbm_seedbag5": "LightGBM × 5 seeds",
    "lgbm_matchbag5": "LightGBM × 5 match-bags",
    "xgb_tuned": "XGBoost, grid-tuned",
    "rf_tuned": "Random forest",
}
GREEN, RED, GREY = "#2f6f4f", "#b3413a", "#8a8f94"

# ---- figure 1: forest plot of paired deltas --------------------------------------------
fig, axes = plt.subplots(1, 3, figsize=(12, 3.6), sharey=True)
for ax, bucket in zip(axes, ["full", "partial", "minimal"]):
    for i, name in enumerate(ORDER):
        dd = C[name]["buckets"][bucket]["delta_ll_vs_current"]
        sig = dd["ci_lo"] > 0 or dd["ci_hi"] < 0
        col = (GREEN if dd["delta"] < 0 else RED) if sig else GREY
        y = len(ORDER) - 1 - i
        ax.plot([dd["ci_lo"], dd["ci_hi"]], [y, y], color=col, lw=2.2, solid_capstyle="round")
        ax.plot(dd["delta"], y, "o", color=col, ms=6)
    ax.axvline(0, color="black", lw=1)
    ax.set_title(f"{bucket} inputs")
    ax.set_xlabel("Δ log loss vs shipped model\n(← better   worse →)")
    ax.grid(axis="x", alpha=0.25)
    ax.set_yticks(range(len(ORDER)))
    ax.set_yticklabels([LABEL[n] for n in ORDER][::-1])
fig.suptitle(
    f"Paired Δ log loss vs the shipped model — cluster bootstrap over {d['test_matches']} test "
    f"matches, 95% CI (grey = CI crosses zero, coloured = clearly better/worse)", fontsize=10)
fig.tight_layout()
fig.savefig(RES / "delta_logloss.png", dpi=130)
plt.close(fig)

# ---- figure 2: ensemble size ----------------------------------------------------------
fig, ax = plt.subplots(figsize=(6.2, 3.8))
cur = C["lgbm_current"]["buckets"]["full"]["log_loss"]
floor = d["seed_noise_floor"]["lgbm_seedbag5"]["full"]
for key, lab, col in [("lgbm_seedbag5", "seed-averaged", GREEN), ("lgbm_matchbag5", "match-bootstrap bags", "#3b6ea5")]:
    ys = d["ensemble_size_curves"][key]["full"]
    ax.plot(range(1, len(ys) + 1), ys, "o-", label=lab, color=col)
ax.axhline(cur, color="black", lw=1, ls="--", label=f"shipped single model ({cur:.4f})")
mem = floor["members"]
ax.axhspan(min(mem), max(mem), color=GREY, alpha=0.18,
           label=f"range of 5 single LightGBM seeds ({min(mem):.4f}–{max(mem):.4f})")
ax.set_xlabel("members in the ensemble")
ax.set_ylabel("full-input test log loss (lower is better)")
ax.set_xticks(range(1, len(ys) + 1))
ax.legend(fontsize=7.5, loc="best")
ax.set_title("Full-input test log loss as the ensemble grows", fontsize=10)
fig.tight_layout()
fig.savefig(RES / "ensemble_size.png", dpi=130)
plt.close(fig)
print("wrote", RES / "delta_logloss.png", "and", RES / "ensemble_size.png")
