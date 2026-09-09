# Model metrics — held-out test set

Test = 15% match-level holdout across all competitions (4,988 shots, 456 goals, 197 matches). Shots from a match never straddle train/test.
Baseline (geometry-only logistic) test log loss = **0.2738**.

| bucket | n | log_loss | brier | auc | pr_auc | ece | cal_in_large | corr vs SB | beats baseline |
|---|---|---|---|---|---|---|---|---|---|---|
| full | 4988 | 0.263 | 0.0709 | 0.8051 | 0.3332 | 0.013 | 1.033 | 0.9049 | yes |
| partial | 4988 | 0.2596 | 0.072 | 0.7916 | 0.305 | 0.0029 | 1.0208 | 0.8983 | yes |
| minimal | 4988 | 0.2674 | 0.0749 | 0.7703 | 0.2607 | 0.008 | 1.0421 | 0.8033 | yes |

## Pass / fail vs spec 8.6

- **full**: log_loss ✓, brier ✓, auc ✓, ece ✓, cal_in_large ✓, corr ✓, beats_baseline ✓
- **partial**: log_loss ✓, brier ✓, auc ✓, ece ✓, cal_in_large ✓, corr ✓, beats_baseline ✓
- **minimal**: log_loss ✓, brier ✓, auc ✓, ece ✓, cal_in_large ✓, corr ✓, beats_baseline ✓

- **monotonic quality** (full ≥ partial ≥ minimal): log_loss(±0.004) ✓, auc ✓, brier ✓

## Release gate: PASS ✅

Reliability diagrams: `training/artifacts/reliability_{full,partial,minimal}.png`

## Error by distance band (full inputs)

| band (units) | n | observed | predicted | log_loss |
|---|---|---|---|---|
| 0-6 | 183 | 0.3388 | 0.3848 | 0.7887 |
| 6-11 | 881 | 0.1771 | 0.1649 | 0.4287 |
| 11-16 | 1011 | 0.1266 | 0.1168 | 0.345 |
| 16-24 | 1537 | 0.0527 | 0.063 | 0.1854 |
| 24-120 | 1376 | 0.0211 | 0.0294 | 0.1136 |

## Generalization — per-competition (full inputs)

| competition | n | goals | pred xG | xG/goals | auc |
|---|---|---|---|---|---|
| 1. Bundesliga | 90 | 6 | 7.7 | 1.283 | 0.893 |
| African Cup of Nations | 133 | 13 | 11.3 | 0.871 | 0.905 |
| Copa America | 81 | 7 | 7.4 | 1.051 | 0.847 |
| FA Women's Super League | 745 | 75 | 75.8 | 1.01 | 0.77 |
| FIFA World Cup | 470 | 47 | 49.1 | 1.045 | 0.837 |
| La Liga | 240 | 29 | 27.8 | 0.96 | 0.755 |
| NWSL | 618 | 50 | 56.3 | 1.127 | 0.765 |
| Premier League | 1508 | 130 | 134.0 | 1.031 | 0.81 |
| UEFA Euro | 362 | 33 | 36.3 | 1.1 | 0.852 |
| UEFA Women's Euro | 211 | 22 | 18.8 | 0.857 | 0.758 |
| Women's World Cup | 454 | 37 | 39.8 | 1.076 | 0.802 |
