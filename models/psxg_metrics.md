# PSxG model metrics — held-out on-target test set

Test = 1,753 on-target shots (match-level holdout, same split as the pre-shot model). Pre-shot-xG-only baseline (recalibrated for this population): log loss **0.5069**, AUC **0.772**.

| bucket | n | log_loss | brier | auc | pr_auc | ece | cal_in_large | beats pre-shot baseline |
|---|---|---|---|---|---|---|---|---|
| full | 1753 | 0.3723 | 0.1185 | 0.8789 | 0.7192 | 0.0236 | 0.9836 | yes |
| partial | 1753 | 0.3776 | 0.1204 | 0.8762 | 0.707 | 0.0258 | 0.9807 | yes |
| minimal | 1753 | 0.4091 | 0.1294 | 0.8576 | 0.6646 | 0.0313 | 0.9956 | yes |

## Pass / fail

- **full**: log_loss ✓, auc ✓, cal_in_large ✓, beats_preshot_baseline ✓
- **partial**: log_loss ✓, auc ✓, cal_in_large ✓, beats_preshot_baseline ✓
- **minimal**: log_loss ✓, auc ✓, cal_in_large ✓, beats_preshot_baseline ✓

- **monotonic quality**: log_loss ✓, auc ✓

## Release gate: PASS ✅
