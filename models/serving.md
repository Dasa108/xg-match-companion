# Serving the xG model in the browser

Three files, all in this folder, bundled with the site:

| file | role |
|---|---|
| `model.onnx` | LightGBM model, run with onnxruntime-web. Input: one float tensor `input` of shape `[1, N]` where `N = len(feature_spec.model_features)`. Output `probabilities` `[1, 2]`; take column 1 = raw goal probability. |
| `feature_spec.json` | the exact input order (`model_features`), the categorical vocabularies, the feature groups, and the completeness bucket definitions. |
| `calibrators.json` | per-bucket isotonic knots. Calibrate with piecewise-linear interpolation: `xg = interp(raw, cal.x, cal.y)`. |

## Steps per shot
1. Build the feature dict with the TypeScript port of `features.py` (same geometry, same
   StatsBomb 120x80 frame). Missing optional groups -> leave those fields null.
2. Encode to the numeric row: `feature_spec.numeric_columns` in order, then one dummy per
   `feature_spec.onehot_columns` entry (1 if the category matches, else 0; all 0 if null).
3. Run onnxruntime-web -> raw probability.
4. Pick the bucket: `full` if freeze-frame + at least one of assist/technique/pass_origin;
   else `partial` if any optional group present; else `minimal`.
5. `xg = interp(raw, calibrators[bucket].x, calibrators[bucket].y)`.
6. Penalties skip all of the above: xg = `feature_spec.penalty_xg` (0.76).

`training/feature_fixtures.json` is the parity test: for each case and bucket, your TS
pipeline must reproduce `features` and each `buckets[b].row` exactly, the model `raw` to
1e-5, and the calibrated `xg` to 1e-4. `check_fixtures.py` is the reference implementation.
