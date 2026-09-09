# process.md — build log & learning journal

**Purpose.** A running record of *how this project is built*, step by step, so you can
learn the reasoning, the commands, and the mistakes — not just read the final code.

**How to read this file.** Newest work is appended at the bottom. Each entry has:

- **What** — the concrete thing done.
- **Why** — the reasoning, and the alternatives that were rejected.
- **How** — exact commands / files / code shape.
- **Learn** — the transferable lesson.
- **Gotchas** — what bit us or would bite you.

**Companion files**
- `spec.md` — the ground truth (what we're building). Changes there come *before* code.
- `process.md` — this file (how we got there).

---

## Phase 0 — Framing & design

### 0.1 Turned a vague goal into a written spec

**What.** Wrote `spec.md`: an app where one person on the sideline logs every shot by
tapping a pitch, gets a live xG per shot, and a full-time report (team xG verdict + player
xG leaderboard).

**Why.** A model/app project fails when "what are we predicting, from what inputs, judged
how" is fuzzy. Writing it down first:
- forces the input list to be *realistic for a human on a touchline* (not a data scientist's
  wishlist);
- fixes the evaluation bar before you can be tempted to move it;
- lets the model work and the app work proceed against the same contract.

**How.** No code yet. The spec fixes: dataset, coordinate system + geometry formulas,
included/excluded features (with a reason per exclusion), model approach, acceptance
thresholds, architecture, and a milestone roadmap (M1 model → M4 hardening).

**Learn.**
- **Spec before code.** The order is: decide → write spec → build → update spec when reality
  disagrees. The spec is versioned truth, not a throwaway.
- **Design the input surface around the *user*, not the model.** We only include features a
  sideline observer can actually judge in ~25 s: shot location, body part, situation,
  pressure, rough keeper/defender positions. Things like "pass velocity" or "build-up
  xThreat" are excluded *because a human can't supply them reliably*, even though a model
  might like them.
- **Write down why you exclude things.** "No 'big chance' flag — it's labelled with
  hindsight and leaks the outcome" is a sentence that stops a future you from re-adding it.

**Gotchas.**
- xG is **pre-shot** and **shooter-agnostic** by definition. Anything known only *after* the
  ball is struck (where it went in the goal, shot speed, save/no save) belongs to a
  *different* model — post-shot xG (PSxG) — which we deferred to v2. Mixing them silently
  inflates your metrics and breaks the interpretation.

### 0.2 Key design decisions (and the alternatives we rejected)

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Training dataset | **StatsBomb Open Data** | Understat, Wyscout, Metrica | Only StatsBomb ships a per-shot `freeze_frame` (positions of keeper + nearby players), which is exactly what the operator's markers produce. Train on the signal you'll serve. |
| Handling incomplete inputs | **One adaptive model** + feature-group dropout in training + per-completeness calibration | Two fixed models ("full" / "lite"); a cascade of N models | One artifact, degrades smoothly across the *whole* spectrum of how much detail was entered, not just two rungs. LightGBM handles missing features natively. |
| What picks the fallback | **What information was captured for that shot** | A time budget ("operator has 25 s so assume X") | The model should react to actual inputs, not a guess about operator speed. 25 s stays as a UX target only. |
| Model family | **Gradient-boosted trees (LightGBM)**, with a logistic-regression baseline | Deep nets; logistic only | Tabular, ~10k–50k rows, mixed categorical/continuous → GBM is the standard strong choice. Logistic {distance, angle} is the baseline every model must beat (sanity check + interpretability floor). |
| Calibration | **Isotonic regression, per completeness bucket** | Raw model probabilities; single global calibrator | xG must be *calibrated*: sum of xG over many shots ≈ actual goals. Sparse-input shots have different error characteristics, so they get their own calibrator. |
| Penalties | **Constant xG = 0.76**, bypass the model | Let the model learn them | Only a few hundred penalties exist; conversion rate is well known and nearly context-free. Don't let a rare, near-constant case add variance. |
| Delivery | **Responsive website**, inference in the browser (onnxruntime-web), service worker for offline caching | Installable PWA; native app; server-side inference | User asked for a website, no download. Pitchside has no connectivity → model + feature code must run client-side, loaded once and cached. |
| Storage | **IndexedDB on the phone** (via Dexie) | Cloud DB; localStorage | Offline-first; matches are local data. localStorage is too small / string-only for structured event data. |
| Player attribution | **Pre-loaded team sheets** | Shirt numbers only; none | Needed for a real player xG leaderboard at full time. |

**Learn.** Every row above is a *fork in the road* with a defensible answer. When you build
your own project, make this table first — it's the cheapest artifact that prevents the most
rework.

### 0.3 Geometry: the two features that carry an xG model

**What.** Fixed a canonical pitch (105 × 68 m, attack toward x=105, goal centre (105, 34),
posts at y=30.34 and y=37.66) and two formulas:

```
distance = hypot(105 - x, y - 34)
angle    = atan2( 7.32 * (105 - x),
                  (105 - x)^2 + (y - 34)^2 - 3.66^2 )     # radians, clamp >= 0
```

**Why.** `distance` and `angle` (the angle your shot "sees" between the two posts) explain
the large majority of shot-to-goal variance. `angle` matters because a shot 6 m out but
near the byline has a tiny target; 6 m out but central sees the whole goal. Everything else
(body part, pressure, keeper) is a correction on top.

**Learn.**
- Normalise coordinates to *one* orientation and unit system early. Every data source
  (StatsBomb is 120 × 80 yards, your app pitch is pixels) gets mapped to the canonical
  metres pitch *before* any feature is computed.
- The feature-engineering code must be **identical** in training (Python) and serving
  (TypeScript in the browser). The spec mandates a shared `feature_fixtures.json` and a
  parity test asserting Python and TS agree to 1e-6. Write that harness before you trust
  any prediction.

**Gotchas.**
- `atan2` argument order and the `- 3.66^2` term: get this wrong and shots from wide angles
  get *higher* xG. Unit-test against hand-computed values (central 11 m penalty spot should
  give a wide angle; corner-of-the-box should give a narrow one).

---

## Phase 1 — Model (M1)  ✅ complete 2026-09-10

**End state.** `training/` holds a reproducible pipeline: `pull_data.py` → `build_dataset.py`
→ `train.py` → `evaluate.py` → `export_onnx.py`, with `check_fixtures.py` as the serving
parity reference. Ships `models/model.onnx` (422 KB) + `feature_spec.json` +
`calibrators.json`. Held-out test (4,988 shots): full-input log loss 0.263, AUC 0.805,
calibration-in-the-large 1.03, correlation with StatsBomb's own xG 0.90. Release gate PASS.

### 1.1 Python environment

**What.** `python3 -m venv training/.venv`; installed numpy, pandas, scikit-learn, lightgbm,
requests, tqdm, then the ONNX stack (onnx, onnxruntime, skl2onnx, onnxmltools), then
matplotlib, shap, pyarrow. Pinned exact versions to `training/requirements.lock.txt`.

**Why.** A venv isolates the project from the machine's conda base. A *lock file* (exact
`==` versions from `pip freeze`) means "clone this in a year and get the same numbers";
`requirements.txt` keeps loose lower bounds for humans.

**How.** The machine had Python **3.14.6** — very new. Risk: binary wheels (lightgbm,
onnxruntime) might not exist for 3.14 yet. Checked by just installing and importing; all
current (numpy 2.5, pandas 3.0, lightgbm 4.7, onnxruntime 1.29). If a wheel had been
missing the fallback was `conda create -n xg python=3.12`.

**Learn.**
- Test the *whole* dependency stack up front, before writing code against it. The one most
  likely to break (here: ONNX on a bleading-edge Python) is the one to check first.
- Two requirements files: loose for humans, locked for reproduction.

### 1.2 Pulling the training data (`pull_data.py`)

**What.** Downloaded StatsBomb Open Data: `competitions.json` → per-competition match lists
→ per-match event streams. Cached as raw JSON under `training/data/raw/`. A curated default
selection of 17 competition-seasons (tournament-heavy, men + women, several continents),
plus an opt-in `--extra-leagues` for three full domestic-league seasons. Ended with **1,374
matches, ~4.1 GB**.

**Why these choices.**
- **Curated, not "everything".** The open data is dominated by one team's league matches
  (Barcelona / Messi). Loading all of it would skew the shot mix and cost far more disk.
  Tournaments give a diverse, team-agnostic sample — right for an xG model that must not
  encode "this team".
- **Cache raw, resumable.** Each file is written to disk on first fetch; re-runs skip what
  exists. A 1,374-file download *will* be interrupted; make that a non-event.
- **Retry with backoff.** `urllib3.Retry(total=5, backoff_factor=0.6, status_forcelist=(429,
  500,502,503,504))` on the session — transient GitHub 5xx/429s recover by themselves.
- **Parallel but polite.** `ThreadPoolExecutor(max_workers=8)` — I/O-bound work, 8 is plenty
  and doesn't hammer the host.

**Learn.**
- A data-pull script's real job is *idempotence and resumability*, not raw speed. Cache
  keyed by the natural id (match_id), skip-if-exists, retry transient errors.
- Keep the selection **declarative and readable** — `(competition_id, "2022")` pairs
  resolved against `competitions.json` at runtime, not magic season-id integers in code.

**Gotchas.**
- StatsBomb reuses one `season_id` across competitions for the same calendar season (Euro
  2024 and Copa América 2024 are both `season_id 282`). Resolve by `(competition_id,
  season_name)`, never `season_id` alone.
- `tqdm` writes carriage-return progress to stderr; `... 2>&1 | tail` then floods you with
  every progress frame. Run long jobs with `TQDM_DISABLE=1` or `nohup ... > log 2>&1 &` and
  `grep` the summary line.

### 1.3 One shot → one row (`features.py`, `encode.py`)

**What.** `features.py` is a **pure** module (stdlib + `math` only): `shot_geometry(x, y)`,
`freeze_frame_features(...)`, and `build_shot_row(event, key_pass, prev_event)` which maps a
StatsBomb shot event to a flat feature dict + label. `encode.py` (pandas/numpy) turns the
feature table into an all-numeric matrix. `build_dataset.py` walks every raw event file and
writes `data/processed/shots.parquet` — **34,809 shots, 9.6% conversion, 100% with freeze
frames, 72% with a detectable assist**.

**Why it's split this way.**
- **Purity = portability.** The exact geometry/freeze-frame maths has to run again in
  TypeScript in the browser. A module with no pandas, no I/O, no globals is one you can port
  line-for-line and pin with fixtures. Anything pandas-shaped lives in `encode.py`, which
  the browser does differently anyway.
- **Coordinate system: StatsBomb 120×80 units, not metres.** The spec originally said
  rescale to 105×68 m. Dropped that: the data is native in 120×80, an 8-unit goal doesn't
  scale to 7.32 m cleanly, and the browser only has to map a tap into the *same* frame — the
  physical unit is irrelevant. Fewer transforms = fewer places to disagree.
- **Angle via the law of cosines**, not `atan2`: `acos((a²+b²−c²)/(2ab))` with the argument
  clamped to `[−1,1]`. Same value, but unambiguous and hard to get subtly wrong.
- **One-hot the categoricals into fixed columns** (`encode.py`) rather than use LightGBM's
  native categorical splits. Reason: ONNX export of categorical splits is fragile; an
  all-numeric model converts cleanly and the browser encoding becomes "set one dummy to 1,
  or all-zero if unknown". A dropped feature group is then just "all its dummies 0 / its
  numerics NaN" — an unambiguous "not provided".
- **Feature groups** (`core`, `freeze_frame`, `assist`, `technique`, `context`,
  `pass_origin`) are declared once in `FEATURE_GROUPS` and drive both training-time dropout
  and the completeness buckets. One definition, used everywhere.

**Excluded, deliberately.** StatsBomb ships `shot.statsbomb_xg` (kept only as an evaluation
yardstick, never a feature), and post-contact fields like `shot.deflected` / `end_location`
(those are post-shot information → PSxG, not pre-shot xG). Penalties are dropped from the
table entirely and handled as a constant 0.76 downstream.

**Learn.**
- Decide the serve-time story *before* writing features. "This has to run in a browser in
  TypeScript" is why the module is pure, why categoricals are one-hot, and why there's a
  fixtures file. Retrofitting any of that is painful.
- Sanity-check the built dataset immediately: conversion rate ≈ 9–10% ✓, and **Σ
  StatsBomb-xG / goals ≈ 1.00** ✓ — that one number confirms the label extraction and the
  join are correct before a single model is trained.

**Gotchas.**
- The assisting pass isn't on the shot — it's a *separate event* linked by
  `shot.key_pass_id`. Build an `{id: event}` map for the match and look it up; that's where
  `assist_type` and the pass-origin location come from.
- StatsBomb flags like `first_time` / `one_on_one` are present only when *true* (absent =
  false). That absent-means-false is real information; "operator didn't say" (NaN) is a
  *different* state. The dataset stores the real value; dropout later injects the NaN.

### 1.4 Split, dropout, jitter (`datasplit.py`)

**What.** `assign_split` puts each shot in train / val / calib / test by a deterministic
hash of `match_id`. `build_training_matrix` augments each training row into 5 copies: one
full, one fully-blanked (`minimal`), and three with independent per-group random dropout +
positional jitter. `apply_bucket_mask` / `random_dropout` / `jitter_freeze_frame` are the
primitives.

**Why.**
- **Split by match, not by shot.** Two shots from the same match are correlated (same teams,
  same conditions); splitting them across train/test leaks. Hashing `match_id` is stable
  across runs — re-run training and the test set doesn't move.
- **Feature-group dropout is how one model covers every input level.** LightGBM already
  handles missing values; dropout during training *teaches* it to, by showing it the same
  shot with the freeze-frame gone, or the assist gone, etc. The augmented set (~108k rows
  from ~22k) makes "minimal inputs" a first-class case, not an afterthought.
- **Jitter** (σ ≈ 1.7 units ≈ 1.5 m on the distance features) models the reality that a
  sideline tap is not a motion-capture coordinate. *Approximation used:* noise added to the
  derived distance features, not re-computed from jittered raw positions — the proper
  version (keep raw coords, recompute) is a noted v2 improvement.

**Learn.**
- Grouped splitting is not optional for event data. If rows share a latent cause, group on
  it.
- If your model must tolerate missing / noisy inputs at serve time, **train it on missing /
  noisy inputs** — don't just hope `NaN` handling saves you.

### 1.5 The split-methodology bug (worth its own entry)

**What happened.** First version held out *whole competitions* for test (WC 2022, WWC 2019,
FA WSL 18/19) — "score it on tournaments it's never seen". Metrics came back with
**calibration-in-the-large ≈ 0.91–0.95** (model under-predicting total goals by 5–9%),
failing the spec's 0.95–1.05 gate, even though log loss / AUC / Brier all passed.

**Why.** Those held-out competitions convert at ~0.10–0.11; the training + calibration data
sat at ~0.091. An isotonic calibrator fit on 9.1%-conversion data and applied to
10.5%-conversion data *will* under-predict. The whole-competition holdout had baked a
**base-rate shift** between the calibration set and the test set.

**Fix.** Switched to a match-level hash split so every competition appears in every split →
train and test are the same population → calibration is meaningful again
(cal-in-large 1.02–1.04). Kept the "unseen competition" idea as a *reported diagnostic*:
`evaluate.py` prints per-competition xG/goals and AUC on the test set.

**Learn.**
- **Calibration is a property relative to a population.** Check it on data drawn like the
  data you calibrated on. Check *ranking* (AUC) and *generalisation* on genuinely unseen
  slices — those are what a distribution-shifted holdout actually tests.
- A metric failing while related metrics pass is a clue about *which* stage is wrong (here:
  discrimination fine, calibration off → the calibration data was the problem).

### 1.6 Baseline, model, calibration (`train.py`)

**What.**
- **Baselines:** logistic regression on `{distance, angle}` (test log loss 0.274) and on
  `+ body_part + shot_type + play_pattern` one-hots. The bar.
- **Model:** `LGBMClassifier`, 4000 trees w/ early stopping (stopped ~290), `lr 0.02`,
  `num_leaves 31`, `max_depth 5`, `min_child_samples 60`, subsample/colsample 0.8,
  `reg_lambda 1`, **monotone constraints** (xG ↓ in distance & defenders-in-cone, ↑ in
  angle & nearest-defender-distance & one-on-one & open-goal), trained on the augmented
  matrix, early-stopped on a val set mirrored across completeness levels.
- **Calibration:** `IsotonicRegression` per bucket, fit on `calib ∪ val` (both unseen by
  the model), each masked to that bucket. Stored as `{x: knots, y: knots}` in
  `calibrators.json` for a trivial `interp` at serve time.

**Why.**
- **Baseline first, always.** If the GBM can't beat `distance + angle` logistic, something
  is wrong with the features or the target, and you want to know that in 2 seconds.
- **Monotone constraints** buy robustness and trust for free: the model *cannot* learn
  "further out = higher xG" from a noisy data pocket, and the app can defend every number.
- **No oversampling.** The classes are ~9:1 but log loss on the true distribution is exactly
  what we want to minimise; resampling would distort the probabilities and force a
  re-calibration anyway.
- **Calibrate on held-out, not on train.** The model's predictions on its own training rows
  are optimistic; calibration must see out-of-sample scores or it learns the wrong mapping.

**Learn.**
- The pipeline order is load → **baseline** → augment → fit w/ early stopping → **calibrate
  on held-out** → evaluate on frozen test. Each stage has a guard you can eyeball.
- Persist everything the serve path needs as *data*, not code: `feature_spec.json` (column
  order, vocabularies, buckets, monotone list), `calibrators.json` (knots). The browser
  never re-implements training, only this.

### 1.7 Evaluation & the release gate (`evaluate.py`, `models/metrics.md`)

**What.** On the frozen test set, for each of `minimal` / `partial` / `full` (test rows
masked to that level): log loss, Brier, ROC-AUC, PR-AUC, ECE (10-bin), calibration-in-the-
large, correlation vs StatsBomb xG, "beats baseline?", reliability diagram PNG, error by
distance band, and xG/goals + AUC per competition. Writes a human-readable `metrics.md` with
a **PASS/FAIL against every spec §8.6 threshold** and a monotonic-quality check.

**Result:** every cell passes. `full`: LL 0.263 / Brier 0.071 / AUC 0.805 / ECE 0.013 /
cal 1.03 / corr 0.90. `partial` and `minimal` also pass. Monotone: AUC & Brier strictly
ordered `full > partial > minimal`; log loss ordered within a ±0.004 tolerance (it's noisy
on ~5k rows — the tolerance is deliberate and documented).

**Learn.**
- Bake the acceptance thresholds into a script that prints ✓/✗, so "is the model good
  enough?" is not a judgement call each time. Re-runnable, diffable, hard to fudge.
- Report **per-slice** (distance band, competition), not just the headline. The headline can
  hide a band that's badly wrong.

### 1.8 Export for the browser (`export_onnx.py`, `check_fixtures.py`, `models/serving.md`)

**What.** `convert_lightgbm(booster, FloatTensorType([None, N]), zipmap=False)` →
`models/model.onnx` (422 KB). Verified: ONNX vs LightGBM raw probability agree to **1.9e-7**
across all buckets including NaN rows. Wrote `feature_fixtures.json`: 48 real shots ×
3 buckets, each with the feature dict, the exact encoded row, the model `raw`, and the
calibrated `xg`. `check_fixtures.py` re-derives all of it from *only* the three shipped
files — the reference the TS port must match (`raw` to 1e-5, `xg` to 1e-4).

**Why.**
- **onnxruntime-web** runs this file in the browser with no server — the pitchside offline
  requirement. An all-numeric model is why the conversion is clean.
- **A parity fixture set is the contract** between the Python training code and the
  TypeScript serving code. Without it, "the browser xG is a bit different from the notebook"
  becomes an un-debuggable complaint. With it, CI fails on the exact case that diverged.

**Gotchas.**
- Fixtures must be *internally consistent*. First cut stored one full-precision row and
  per-bucket predictions computed from *un-rounded* features → re-predicting from the
  rounded stored row disagreed by ~2e-4 (a tree split boundary flips under a 1e-6 nudge).
  Fix: round the row first, then predict from the rounded row, and store both.
- The calibrated `xg` carries one extra piecewise-linear step whose knots can be steep, so
  its parity tolerance (1e-4) is looser than the model `raw` (1e-5). Still far below any
  xG precision anyone reports.

### 1.9 Repo hygiene

**What.** `.gitignore` (venv, `data/raw`, `data/processed`, `artifacts` — all regenerable),
`git init`, committed M1 on branch `m1-model`. Tracked footprint: ~1.4 MB (code + the
422 KB model + JSON), not the 4 GB of raw JSON.

**Learn.** Commit the *recipe and the result* (scripts + released model + metrics), never
the *scratch* (raw downloads, venv, intermediate parquet). Anyone can regenerate the scratch
from `pull_data.py`.

---

### How to reproduce M1 from scratch

```bash
cd training
python3 -m venv .venv && .venv/bin/pip install -r requirements.lock.txt
.venv/bin/python pull_data.py --extra-leagues     # ~4 GB, resumable
.venv/bin/python build_dataset.py                 # -> data/processed/shots.parquet
.venv/bin/python train.py                         # -> ../models/{model.txt,calibrators,feature_spec}
.venv/bin/python evaluate.py                      # -> ../models/metrics.md  (check: gate PASS)
.venv/bin/python export_onnx.py                   # -> ../models/model.onnx + feature_fixtures.json
.venv/bin/python check_fixtures.py                # serving-path parity (must pass)
```

### Open items carried into M2

- Positional jitter is approximate (noise on derived distances). Proper version: persist raw
  freeze-frame coords, recompute features under jitter. v2.
- SHAP-based `reason` strings (spec §8.5 step 6) not built yet — deferred to M2/M3 where the
  UI consumes them.
- `models/model.txt` is committed for now (692 KB, human-diffable); could switch to
  ONNX-only once the TS path is trusted.

---

## Phase 2 — Logging app (M2)  🚧 in progress

**End state so far.** `app/` is a Vite + React + TypeScript project. The whole xG
serve path — feature engineering, encoding, the ONNX model, per-bucket calibration — is
ported to TypeScript and **checked against the Python pipeline by 340 automated
assertions**. A working demo screen computes live xG from a tapped pitch. Still to do:
team sheets, the match lifecycle, IndexedDB persistence, the end-of-match report.

### 2.1 Refactor first: one contract for two languages

**What.** Before writing any TypeScript, split `training/features.py` into
`event_to_input()` (StatsBomb-specific parsing) and `features_from_input()` (pure
input-dict → feature-dict maths). `build_shot_row()` is now just the two composed.

**Why.** The browser never sees a StatsBomb event — it has operator taps. The thing the
TS port must reproduce is *only* the input→features maths. Isolating that into one pure
function makes it a portable spec, and lets `feature_fixtures.json` carry the
operator-shaped `input` dict so the TS test can go input → features → row → xg end to end.

**Learn.** When the same logic has to run in two languages, first carve it down to the
*smallest pure core* that actually needs to cross the boundary. Verified the refactor
changed nothing: rebuilt the dataset, retrained — identical `best_iteration` (290) and
identical test metrics.

### 2.2 The app scaffold

**What.** `package.json` (Vite 6, React 18, vitest), `vite.config.ts` (+ a *separate*
`vitest.config.ts`), `tsconfig.json`, `scripts/sync-assets.mjs`.

**Why the choices.**
- **`sync-assets.mjs`** copies the three model files from `models/` into
  `app/public/model/`, the fixtures into `src/xg/__fixtures__/`, and onnxruntime-web's
  wasm into `public/ort/`. It runs before `dev`/`build`/`test`. The app never reaches
  across the repo at runtime; the model is a build input, and all the synced paths are
  `.gitignore`d (single source of truth stays in `models/` + `training/`).
- **Two config files.** Importing `defineConfig` from `vitest/config` to get the `test`
  key pulls a *second, nested* copy of Vite's types, and `tsc` then rejects the React
  plugin as "a different `Plugin` type". Fix: `vite.config.ts` imports from `vite`,
  `vitest.config.ts` imports from `vitest/config`. Vitest picks up its own file.

**Gotcha.** Vite bundled a 27 MB `ort-wasm-simd-threaded.jsep` file into `dist/` because
`onnxruntime-web`'s entry pulls the WebGPU build into the import graph. Runtime still uses
the smaller wasm from `/ort/` (`ort.env.wasm.wasmPaths`). Trimming the bundle to the plain
wasm backend is an M4 hardening task.

### 2.3 The TypeScript port (`src/xg/`)

| file | mirror of | notes |
|---|---|---|
| `features.ts` | `features.py` | `shotGeometry`, `freezeFrameFeatures`, `featuresFromInput`, `presentGroups`. Pure. Vocabularies + `FEATURE_GROUPS` duplicated here (a test asserts they equal `feature_spec.json`). |
| `encode.ts` | `encode.py` | `MODEL_FEATURES` order, `encodeRow` (numeric cols then one-hot), `maskGroups` (= `apply_bucket_mask`), `BUCKET_KEEP`. |
| `calibrate.ts` | isotonic `interp` + `completeness_bucket` | kept ORT-free so tests don't load a runtime. `interp` matches `numpy.interp` (flat extrapolation, binary search). |
| `model.ts` | serving path | `onnxruntime-web` session (lazy, cached), `predictXg(input)`: features → pick bucket → mask → encode → ONNX → calibrate. Penalties short-circuit to 0.76. |

**Learn.**
- Port the *contract constants* (feature order, vocab, group membership) explicitly and
  then **test that they equal the JSON the model shipped with**. Drift between the two
  languages is the whole risk; make it a red test, not a production surprise.
- `NaN` isn't valid JSON. `json.dumps` writes a bare `NaN` token that `JSON.parse`
  rejects. Fixtures now emit `null` for missing numerics; the loaders on both sides turn
  `null` back into `NaN` before the model sees it.
- Represent "feature not provided" as exactly one thing per type — numeric `NaN`,
  categorical `null`/all-zero-one-hot — and make the Python and TS encoders agree on it.

### 2.4 The parity suite (`src/xg/*.test.ts`) — 340 assertions

- **`features.test.ts`** (node env): for all 48 fixtures — `featuresFromInput(input)` ==
  `features` (numbers to 1e-6, strings/nulls exact); `encodeRow(maskGroups(...))` ==
  each bucket's stored `row`; `interp(calibrator, raw)` == stored `xg`;
  `MODEL_FEATURES` == `feature_spec.json`.
- **`model.node.test.ts`**: loads `model.onnx` with `onnxruntime-node`, runs every
  fixture row through the *same call shape* `model.ts` uses, checks `raw` < 1e-5 and
  calibrated `xg` < 1e-4 vs the fixtures. (Browser wasm path is exercised when the app
  runs; the API surface — `InferenceSession.create(bytes)`, `Tensor`, `run` — is
  identical between `onnxruntime-node` and `-web`.)

**Learn.** Split the "is my maths right" test (fast, pure, runs everywhere) from the "does
the model binary load and run" test (needs a runtime). Both matter; coupling them makes
the fast one slow and flaky.

### 2.5 The demo screen (`App.tsx`, `pitch/Pitch.tsx`)

**What.** An SVG attacking-half pitch (StatsBomb 120×80 `viewBox`). Tap tool = shot /
keeper / defender. Chips for body part, situation, pressure, optional assist and context.
Every change rebuilds the `ShotInput` and calls `predictXg`; the xG, the completeness
bucket, and the raw model probability render live.

**Why.** Proves the entire offline serve path in a real browser before any of the
match-management UI is built. The number on screen is the same number the parity tests
check.

**Learn.** Get the risky, cross-cutting slice (model in the browser) working end to end
*first*, on a throwaway screen. The CRUD around it (matches, players, storage) is
well-trodden and can come after.

### 2.6 Match lifecycle + persistence

**What.** A `setup → live → finished` state machine backed by IndexedDB, plus the
end-of-match analytics.

- **`db/schema.ts`** — Dexie tables `matches` / `players` / `shots`. `createMatch`,
  `startMatch`, `finishMatch`, `reopenMatch`, `deleteMatch` (cascades to players + shots
  in one transaction). A start/pause match clock stored as
  `clockAccumMs + (clockStartedAt ? now − clockStartedAt : 0)` so it survives reloads and
  needs no timer in the DB.
- **`db/hooks.ts`** — `useLiveQuery` wrappers; any write re-renders every screen showing
  that data.
- **`xg/verdict.ts`** (pure, unit-tested) — `teamAggs`, the spec §9 `verdictLine`
  ("Deserved result" / "Smash-and-grab" / "should have won" / …), `playerLeaderboard`
  (xG, xG/shot, biggest chance, goals, `G−xG`), `bestXgPlayer`, `efficiencyPick`
  (≥ 3 shots).
- **Screens** — `MatchListScreen` (create / open / delete), `SetupScreen` (two
  `TeamSheet` editors → *Kick off*), `LiveScreen` (scoreboard with running team xG +
  clock, `ShotEntry`, reverse-chronological shot log, *Full time*), `ReportScreen` (FT
  score, xG line + verdict, player table, SVG shot map, *reopen*).
- **`App.tsx`** — no router library; the screen is a pure function of `match.status`, and
  the last-opened match id is kept in `localStorage` (wrapped in try/catch for private
  mode).

**Why.**
- **Status is the single source of navigation truth.** `startMatch` flips the row to
  `live`; the live query re-fires; `App` renders `LiveScreen`. No separate nav state to
  keep in sync with the data.
- **Team folded into Match.** Spec §7 lists a `Team` table, but there are always exactly
  two and they're identified by `side`. `homeName`/`awayName` on the match + a `side` enum
  on players/shots is less machinery for the same information. (Noted as a deliberate
  deviation.)
- **The clock is data, not a running timer.** Storing an anchor timestamp + accumulated ms
  means a page reload, a backgrounded tab, or reopening the app all compute the right
  minute with no drift.

**Learn.**
- Model elapsed time as `(anchor, accumulated)` rather than ticking a counter — the UI
  timer becomes cosmetic (a 1 s interval just to repaint) and the truth is always
  recomputable.
- With a reactive store (Dexie live queries), "navigation" for a status-driven flow is
  often just `switch (row.status)`. Reach for a router when URLs/back-button matter.
- Put the analytics/verdict logic in a pure module and test it with hand-built rows —
  the wording rules in spec §9 have several branches and are exactly the kind of thing
  that rots silently.

### 2.7 Testing without a browser

The Claude-in-Chrome extension wasn't connected in this session, so the UI wasn't
clicked through live. Covered instead by:
- `db/schema.test.ts` — the full lifecycle (create → players → kick off → clock → shots →
  aggregate → full time → reopen → delete-cascade) against `fake-indexeddb`.
- `xg/verdict.test.ts` — every branch of the verdict string + the leaderboard maths.
- `npm run build` type-checks all screens; `vite preview` + `curl` confirms the bundle
  serves and `/model/*` + `/ort/*.wasm` resolve.
- **350 tests total, all green.** Still worth a manual `npm run dev` click-through before
  calling M2 done.

### Still to build / polish in M2

- Manual browser pass of the full flow.
- Optional-detail inputs from spec §5.2 step 6 (technique, keeper-state, pass-origin
  marker) — the model already accepts them; the UI only exposes a subset.
- CSV/JSON export from the report.
- Trim the 27 MB onnxruntime-web bundle to the plain wasm backend; add the service worker
  (M4).

---

---

## Phase 3 — Reporting (M3)  ✅

**End state.** The end-of-match report is complete: FT score, xG verdict, player
leaderboard with best-xG + efficiency picks, SVG shot map, cumulative xG timeline,
chance-quality histogram, per-shot reason + confidence band, and JSON/CSV export. All the
logic is in pure, unit-tested modules; the screens just draw it. **356 tests, all green.**

### 3.1 Pure modules first, charts second

| module | does | tested |
|---|---|---|
| `xg/verdict.ts` | team aggregates, spec §9 verdict string, player leaderboard | `verdict.test.ts` |
| `xg/report.ts` | `cumulativeXgSeries` (step series per side), `xgHistogram` (banded counts) | `report.test.ts` |
| `xg/reason.ts` | rule-of-thumb explanation + confidence band | `report.test.ts` |
| `xg/exportMatch.ts` | `matchToJson`, `shotsToCsv`, `downloadText` | `report.test.ts` |
| `components/Charts.tsx` | inline-SVG `XgTimeline`, `XgHistogram`, `ShotMap` | (visual) |

**Why.** Every number in the report is produced by a function that takes `Shot[]` and
returns data — so it's testable with three hand-built rows, and the SVG components are
dumb: given points, draw points. The charts use no library (spec: no CDN, small bundle);
a step-line path and grouped `<rect>` bars are ~15 lines each.

**Learn.**
- A chart is *two* problems — shape the data, then draw it. Keep them in separate files.
  The data shaping is where bugs and off-by-ones live, and that half needs no DOM to test.
- Cumulative step series: emit a point at each event carrying the *running* total, and a
  synthetic end point so the line reaches full time. The "step" is drawn by the path
  (horizontal to the new x at the old y, then vertical), not by the data.

### 3.2 The reason string is honest about what it is

**What.** `explainXg(features, bucket)` returns e.g. *"point-blank range, one-on-one with
the keeper, the keeper off his line"* — the top few of a weighted phrase list read off the
feature values. `confidenceBand` returns `xg ± {0.025, 0.04, 0.06}` for full / partial /
minimal.

**Why not SHAP.** Spec originally said "SHAP values per prediction". SHAP needs the model
to emit per-feature contributions, which the ONNX export doesn't. Rather than ship a
fake "SHAP" label, v1 ships a transparent rule-of-thumb and the spec now says so (§5.2
step 8, §8.5 step 6). The band widths are labelled *illustrative of the measured
bucket accuracy gap*, not calibrated intervals — a real interval needs quantile models
(v2).

**Learn.** When you can't build the thing the spec named, change the spec to describe what
you *did* build and why — don't relabel a simpler thing with the fancier name. A reader
who sees "SHAP" will trust it as attribution; "rule-of-thumb read of the features" sets
the right expectation.

### 3.3 Export

`matchToJson` emits `{schema:"xg-match-companion/v1", match, summary, players, leaderboard,
shots}`; `shotsToCsv` emits one row per shot with RFC-4180 quoting (`"O'Neil, A"`).
`downloadText` makes a `Blob`, clicks a temporary `<a download>`, revokes the URL. That
anchor trick is inert inside the Artifact sandbox but fine here — this app is the user's
own page, not a hosted artifact.

### 3.4 Spec deviations recorded this phase

- `Team` table folded into `Match` (`homeName`/`awayName` + `side` enum) — §7.
- `reason` is heuristic, not SHAP — §5.2 step 8, §8.5 step 6.
- Confidence band widths are illustrative, not calibrated — §5.2 step 8.
- Histogram is per-band shot *counts* per side (grouped bars), matching "shots by chance
  quality".

### Still open before M4

- Manual browser click-through (Chrome extension not connected this session).
- Full optional-detail inputs in `ShotEntry` (technique, keeper-state, pass-origin marker).
- Trim the 27 MB `ort-wasm-simd-threaded.jsep` from the bundle; service worker.

---

### How to run the app

```bash
cd app
npm install
npm run dev        # http://localhost:5173  — sync-assets runs first
npm test           # 356 parity + lifecycle + report tests
npm run build      # type-check + production bundle in dist/
```
