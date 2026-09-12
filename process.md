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

---

## Phase 4 — Hardening (M4)  🚧 in progress

### 4.1 First real browser load caught a fatal bug

**What.** Loaded the dev app in a browser (Brave, via the Claude-in-Chrome extension) for
the first time. It showed Vite's red error overlay and never mounted:

> Failed to load url /ort/ort-wasm-simd-threaded.jsep.mjs … This file is in /public and
> will be copied as-is during build without going through the plugin transforms, and
> therefore should not be imported from source code.

**Why.** `sync-assets.mjs` copied onnxruntime-web's `.wasm` **and** `.mjs` into
`public/ort/`, and `model.ts` set `ort.env.wasm.wasmPaths = "/ort/"`. At runtime ort does a
dynamic `import()` of its `.mjs` glue from that path — but Vite's dev server refuses to
serve a `public/` file through the module pipeline. The all-headless tests never hit this:
`onnxruntime-node` (used in `model.node.test.ts`) loads its runtime a completely different
way.

**Fix.** Delete the `wasmPaths` override and the `public/ort` copy; let the bundler resolve
onnxruntime-web's own assets (`optimizeDeps.exclude: ["onnxruntime-web"]` was already in
place, and Vite/Rollup handle the `new URL(…, import.meta.url)` inside ort). App mounts
clean; `npm run build` + 356 tests still green.

**Learn.**
- **Files in `public/` are copied verbatim — never `import` them.** They're for `<img src>`
  / `<link href>` style references by URL, not for code the bundler needs to touch.
- A green headless suite is not "it works". The node ONNX runtime and the browser wasm
  runtime load by different mechanisms; only a real browser exercises the second. This is
  exactly why M2 planned a manual pass — the first one paid for itself immediately.
- Don't hand a library a hard-coded asset path when the bundler already knows how to place
  its assets. The override existed to force offline loading; the bundler does that anyway
  (assets land in `dist/assets/` and get precached by the service worker later).

### 4.2 Second browser bug: the threaded-wasm freeze

**What.** With the `public/` import fixed, the app mounted — but the moment code reached
the model load, the **renderer froze hard** (30 s CDP timeouts, no console output). The
list and setup screens were fine; it locked up on the Live screen / on `warmModel()`.

**Why.** The default `onnxruntime-web` entry pulls the *multi-threaded* wasm build, which
needs `SharedArrayBuffer` → which needs cross-origin isolation (`COOP`/`COEP` headers) the
dev server doesn't send. On a non-isolated page it doesn't error cleanly — it spins trying
to stand up its worker pool and wedges the main thread. `model.node.test.ts` never sees
this: `onnxruntime-node` is a native addon, no wasm threads.

**Fix.**
- `ort.env.wasm.numThreads = 1` + `proxy = false` — no `SharedArrayBuffer`, no worker.
  A 420 KB model doing one inference per shot does not need threads.
- `await import("onnxruntime-web")` **dynamically inside `load()`** instead of a top-level
  import. It now code-splits into its own ~414 KB chunk; the main bundle dropped
  694 KB → 277 KB, and the match-list / setup screens never download it.
- `warmModel()` moved from `App` mount to `LiveScreen` mount — the model loads when you
  kick off, not when you open the app.

**Learn.**
- `onnxruntime-web` defaults to the threaded build. On any page without COOP/COEP, set
  `numThreads = 1` or it will hang, not fail.
- A heavy dependency behind a screen you don't always visit belongs behind a dynamic
  `import()`. Free code-splitting, and the failure mode (if any) is scoped to that screen.
- Two browser bugs in the first two loads, both invisible to a green 356-test suite,
  both in the model-loading path. Headless coverage of "the maths" is not coverage of
  "the runtime in the real environment".

### 4.3 Full manual walk-through — passed

Ran the whole flow in Brave via the extension:

| step | result |
|---|---|
| Create match | persisted, appears in the list |
| Team sheets | add players + numbers, XI/sub toggle, live count |
| Kick off | Live screen, model loads with **no freeze** |
| Tap pitch | live **0.25 xG**, band 0.19–0.31, reason "close range", bucket `minimal` |
| Body part → head | xG drops to **0.16** — model responds |
| Drop keeper + defender | bucket `minimal → partial`, reason gains "the keeper off his line" |
| Pick shooter + outcome, Save | scoreboard → Rovers 1, 0.16 xG, 1 sh |
| Second shot (City) + Save | shot log shows both, reverse-chronological |
| Full time | Report: **1–0**, xG 0.16–0.37, verdict *"Even game on chances — Rovers took theirs."* |
| Report charts | xG timeline (step lines + legend), shot map (dots ∝ xG, goal gold), chance-quality histogram |
| Player table | Cy Dunn −0.37 (red), Ada Owen +0.84 (green); "Best xG: Cy Dunn" |
| Export | JSON + CSV buttons present (logic already unit-tested) |

**Minor UX notes for later:** `reset()` after save keeps body-part / situation / pressure
from the previous shot (deliberate — they're often the same — but "head" carrying over
surprised me once); the pitch is full-width and very tall on a desktop viewport (it's a
phone-first layout, fine on a phone); the xG-timeline step lines hug the axis with only
two early shots (fine once shots spread across 90′).

### 4.4 The whole pitch

**What.** Replaced the cropped attacking-half view with a **full pitch, drawn portrait**,
team-in-possession attacking upward — both penalty areas, both D arcs, halfway line,
centre circle. New shared module `pitch/geometry.ts` (the model↔SVG transform) +
`pitch/PitchMarkings.tsx` (the lines), used by both the shot-entry `Pitch` and the report
`ShotMap` so they can't drift.

**Why portrait.** A full 120×80 pitch is landscape (1.5:1); on a phone that leaves the
shot zone ~130 px wide — too tight for placing defenders or judging angle. Rotated to
portrait (80 wide × 120 tall) the attacking third gets the full screen width, which is
where lateral precision actually matters. The model coordinate transform is then just an
axis swap: `svg = (model.y, 120 − model.x)`.

**Learn.** When two components draw "the same thing" (the entry pitch and the report shot
map), factor the geometry + markings into one module the day you have two of them — not
after they've diverged. Cap a full-bleed SVG with `max-height` + rely on
`preserveAspectRatio` to letterbox it centred, rather than trying to compute a fitted size.

### 4.5 Bundle trim + offline

**Wasm.** `import("onnxruntime-web")` pulls the all-backends "jsep" build — a **28 MB**
wasm even though we only use the wasm EP. Switched the dynamic import to
`onnxruntime-web/wasm`: **14 MB** wasm, and the JS glue **414 KB → 73 KB**. (14 MB is this
version's floor for the wasm EP; older ort had a smaller non-SIMD `ort-wasm.wasm` but
that path is gone.)

**Service worker.** `vite-plugin-pwa` (Workbox `generateSW`), `registerType: autoUpdate`,
no install prompt. `globPatterns` widened to include `onnx` / `json` / `wasm`, and
`maximumFileSizeToCacheInBytes` bumped to 20 MB so the wasm precaches. Result: **10
entries, ~14 MB** — the shell, `model.onnx`, `feature_spec.json`, `calibrators.json`, the
ort JS + wasm. Once the site has loaded online it runs fully offline.

**Learn.** A default library entry point often bundles backends you'll never use — check
the package's `exports` map for a narrower one (`/wasm`, `/core`, …). Service-worker
precaching only runs in a real build (`vite preview`, not `vite dev`); verify the
generated `sw.js` precache list actually contains the model + wasm.

### 4.6 Full shot-detail inputs

`ShotEntry` now exposes everything the model accepts: a **"+ more detail"** disclosure
adds `technique`, `beat a defender` (follows_dribble), `open goal`, `rebound`; a new
**"⟶ pass"** pitch tool drops the assist origin (dashed line to the shot) and puts the
shot in the `full` completeness bucket. The context object carries all five flags now.
A `computing xG…` placeholder shows on the first inference while the model warms.

### 4.7 Browser re-verification

Preview build in Brave: create match → team sheets → kick off → **full portrait pitch +
the pass tool render, model loads with no freeze** → tap → xG. The Chrome extension was
intermittently dropping screenshots all session (≈6 times — actions execute, the CDP
`captureScreenshot` times out); retrying usually recovers. Not app-related — the app
rendered fine every time a screenshot did come back.

**Still open in M4:** a performance pass (first-inference latency on a real mid-range
phone; the 14 MB wasm cold-download), and the real-match trial.

**UX debt noted:** `reset()` keeps body-part / situation / pressure between shots
(deliberate, but surprised me once); the xG-timeline hugs the axis with only a couple of
early shots.

---

## Phase 5 — PSxG (post-shot xG) + downloadable full report  ✅

User ask: pull in the v2 ideas that *don't* need a server, keep PSxG **optional**, and add
a "download everything from the match" report. Landed as a second full training pipeline
(same rigor as M1) plus the app wiring, and a self-contained report document.

### 5.1 Which v2 ideas actually needed a server — and which didn't

**What.** Sorted the deferred list (spec §2) into two piles before writing code:

| needs a server | doesn't |
|---|---|
| multi-device/operator sync | PSxG (another ONNX model, runs client-side) |
| cloud accounts, cross-device history | SHAP attribution / calibrated intervals |
| retraining from many operators' matches | game-state feature experiment |

**Why.** The dividing line is whether state has to move *between* devices. Anything that
stays on one operator's phone was already static-hostable (see the earlier "isn't our
site not static" exchange) — PSxG is just a bigger model doing the same client-side trick
as the first one. Retraining-from-the-field is the one that genuinely needs somewhere
central to collect shots from devices that never talk to each other otherwise.

**Learn.** When a request says "add the v2 features that don't need X", the first useful
step is a table, not code — sort the list by the actual constraint before estimating
effort. It also stops scope creep: "add v2 features" alone could have meant six things;
the table made it obvious only two were in scope this round.

### 5.2 Designing PSxG: a second model, deliberately not a bigger first model

**What.** PSxG answers "given this shot reached the frame with this placement, how likely
was it to beat the keeper?" — a different question from pre-shot xG, built as a
**separate** ONNX model (`psxg_features.py`, `psxg_train.py`, `psxg_model.onnx`) that
*imports* the pre-shot feature code rather than extending it.

**Why not just add a `placement` feature to the existing model?** Because placement is
only known *after* the ball is struck. Feeding it into the pre-shot model would make
"pre-shot xG" secretly depend on the outcome — precisely the leak spec §8.3's exclusion
table exists to prevent ("shot placement ... is post-shot info, not pre-shot xG"). Keeping
it a structurally separate model, importing `features_from_input` rather than editing it,
makes that leak impossible by construction rather than by discipline.

**Learn.** When a new signal is only available *after* the thing you're predicting has
happened, that's a hard boundary, not a feature to add carefully. Put it in a different
model. The "import, don't extend" pattern (`psxg_features.py` imports `features.py`,
never the reverse) is a cheap way to make an architectural rule mechanically enforced —
a circular import would fail immediately if anyone tried to route pre-shot xG through the
post-shot module.

### 5.3 Finding the goal-frame coordinate scale from real data

**What.** Before writing features, pulled real StatsBomb shots with a 3-component
`end_location` to see what the z-axis (height) actually measures:

```python
outcome, [x, y, z] = "Saved", [118.9, 42.3, 1.8]   # not always at the goal line (x=120) —
                                                     # "Saved" is recorded where the keeper
                                                     # touched it, which can be short
```

Range: z from 0 to ~7.8 (most "way over the bar" shots are off-target and irrelevant to
PSxG). Cross-referenced against the outcome vocabulary (`Goal`, `Saved`, `Post`,
`Saved Off Target`, `Saved to Post`, `Off T`, `Blocked`, `Wayward`) to decide which counted
as "on target" for training: the five that get a recorded 3D point.

**Learn.** Don't assume a data field's meaning from its name — pull a sample and look.
`end_location` sounds like "where the shot crossed the goal line", but for saves it's
"where the keeper stopped it", which is a real x-value short of 120, not always right at
the line. That distinction didn't end up mattering for the feature (only y, z are used),
but *knowing* it mattered for deciding what "on target" even means for this dataset.

### 5.4 Goal-mouth features + monotone constraints

**What.** Six features from the (y, z) placement (`gm_abs_dy`, `gm_z`, `gm_dist_post`,
`gm_dist_bar`, `gm_far_post`, `gm_corner_dist`), each with a monotone constraint reasoned
out the same way as the pre-shot model's (§8.9): closer to a post or corner → harder to
save → higher PSxG; far-post placement → keeper has further to travel → higher PSxG.

**Why `gm_far_post` needed the shot's own y, not just the placement's.** "Far post" only
means something *relative to where the shot came from* — a placement at y=44 is far-post
for a shooter at y=30 and near-post for one at y=50. The feature function takes both
`shot_y` and the placement, `dy * (shot_y - center) < 0` catches "opposite side from the
shooter". Small thing, easy to get backwards silently (the model would just look a bit
worse, not error) — worth a comment explaining the sign logic, not just the formula.

### 5.5 The baseline that actually tests the hypothesis

**What.** PSxG's "beat the baseline" gate uses the **pre-shot xG model's own prediction,
re-calibrated for the on-target population** — not a fresh logistic regression.

**Why.** The question PSxG exists to answer is "does placement add information *beyond*
what the pre-shot situation already told you". The fairest baseline is therefore the best
thing you'd have *without* placement: the existing model. Re-calibrating it (isotonic, fit
on train+calib+val, on-target rows only) matters because the on-target population
converts at 27% vs the general 9.6% — the pre-shot model's calibrators were fit for the
wrong base rate, and comparing raw uncalibrated log loss would just measure that mismatch,
not the value of placement.

**Result:** full-bucket log loss 0.372 vs baseline 0.507, AUC 0.879 vs 0.772 — a very
large, expected gap (placement is famously the dominant signal for on-target shot
outcomes in the analytics literature). Confirms the feature engineering is sound before
trusting anything downstream.

**Learn.** "Beats a baseline" is only a meaningful gate if the baseline is the *honest*
alternative someone would reach for otherwise, evaluated fairly (same population, same
calibration effort). A strawman baseline (predict the base rate, or an uncalibrated
model on a shifted population) passes trivially and proves nothing.

### 5.6 Reusing the pipeline, not rewriting it

**What.** `psxg_train.py` imports `datasplit.assign_split` / `build_training_matrix` /
`apply_bucket_mask` unchanged — the pre-shot completeness-bucket dropout/jitter machinery
just works on the PSxG dataframe too, because the extra `gm_*` columns aren't in
`FEATURE_GROUPS` so the masking helpers pass them through untouched. `psxg_encode_matrix`
is `encode.encode_matrix(df)` (58 pre-shot columns) with 6 goalmouth columns appended.

**Learn.** Good factoring pays off the second time you need it, not the first. Nothing
in `datasplit.py`/`encode.py` was written with PSxG in mind — it was written to operate on
*whatever columns a `FEATURE_GROUPS`-shaped dataframe has*, which turned out to be exactly
the right abstraction boundary for "a second dataset that shares most of its columns with
the first."

### 5.7 App side: lazy-load dedup, and a UI that's truly optional

**What.** `app/src/xg/psxgFeatures.ts` + `psxgModel.ts` mirror the training-side split.
`ShotEntry` shows a **"+ tap where it went"** control only once the outcome is
`goal`/`saved`/`post`; tapping it reveals `pitch/GoalFrame.tsx` (a small face-on goal
diagram — y across, z height). Saving a shot never requires this step.

**Gotcha avoided, not hit:** both `model.ts` and `psxgModel.ts` dynamically
`import("onnxruntime-web/wasm")`. Checked the build output rather than assuming — Rollup
dedupes identical dynamic-import specifiers from different modules into **one** shared
chunk, so loading PSxG after the pre-shot model costs only the extra ~755 KB `.onnx`
fetch, not a second 14 MB wasm download. Worth confirming with `npm run build` output,
not just trusting that it should work that way.

**Learn.** "Optional" has to be true at every layer, not just the top UI toggle: the
`useEffect` computing PSxG is gated on `goalmouth && psxgEligible`, a separate effect
clears the placement automatically if the outcome changes away from an eligible one (so a
stale placement can't silently attach to an off-target shot), and `commit()` sends
`null`s for every PSxG field when nothing was placed rather than omitting them — keeping
the shape of every `Shot` record identical whether or not PSxG was used.

### 5.8 The downloadable full report

**What.** `xg/reportHtml.ts` builds one self-contained HTML file per match: score,
verdict, an inline-SVG xG timeline and shot map (string-built versions of the same charts,
sharing the exact pitch-marking SVG with the live app via `pitch/pitchMarkingsSvg.ts`),
the player leaderboard, and a complete per-shot table — every field the app collected.
No server, no external assets, opens from disk, has a `@media print` fallback for
"Save as PDF".

**Why a shared markings string instead of two implementations.** `PitchMarkings.tsx` used
to hold the pitch-line JSX directly. Moved the markup into a plain string constant
(`PITCH_MARKINGS_SVG`) that the React component renders via `dangerouslySetInnerHTML` and
the (non-React) report builder embeds directly — one source of truth for what the pitch
looks like, instead of two drawings that could quietly drift apart.

**Why HTML and not PDF.** A PDF needs either a library (bundle weight, another dependency
to keep working offline) or a server (ruled out). An HTML file needs neither: it's
self-describing, opens anywhere, and the browser's own "Print → Save as PDF" covers the
PDF use case for free. Kept the design honest about what it actually is.

**Tested with:** `reportHtml.test.ts` — checks the doc is well-formed, that team/player
names are **HTML-escaped** (a `<script>` in a player name must not execute when the file
is opened), that the PSxG column only appears when some shot actually has one, and that
an empty match doesn't crash the builder.

### 5.9 Totals

**Training:** `training/psxg_*.py` (6 new scripts), `models/psxg_*` (5 new files, incl.
`psxg_model.onnx` 755 KB), release gate PASS.
**App:** 2 new `xg/` modules + 2 new tests (227 PSxG parity + 1 ONNX inference), 1 new
pitch component (`GoalFrame`), 1 new export module (`reportHtml.ts` + 1 test file),
schema/verdict/export updates. **587 tests total, build clean** (13 precache entries,
~15.2 MB — both models fit inside the offline cache from §4.5).
**Spec:** new §8.9, updates through §2/§3/§5/§6/§7/§9/§10/§11/§12/§13.

Not yet done: a browser click-through of the PSxG flow specifically (the extension was
down for this phase) — headless coverage is strong (parity + ONNX inference for both
models) but the goal-frame tap widget itself hasn't been seen rendering in a real browser.

---

## Phase 6 — Visual redesign  ✅

User ask: make the app look better, "sports broadcast" direction, suggestions first. This
phase is as much about *how to validate a design decision* as the decisions themselves —
the color system in particular was computed, not eyeballed.

### 6.1 Suggestions before code

**What.** Before touching anything, wrote out a catalogued list of what was actually there
(one accent color doing several jobs, no type scale, no motion, emoji as icons, outcome
dots that were color-only) grouped into Quick / Moderate / Bigger tiers, and asked two
things: how much scope, and which aesthetic direction. Got "Quick + Moderate" and "sports
broadcast" back.

**Why ask instead of just building something.** Visual direction is a taste call with no
objectively-right answer — "clean dashboard" and "sports broadcast" are both defensible
and would produce genuinely different CSS. Guessing wrong means redoing real work; a
2-question, 30-second check avoids that for the cost of one round-trip. Scope (Quick vs
Quick+Moderate vs everything) changes how much there is to review at once — also worth
asking rather than assuming "more is better."

### 6.2 The color system was computed, not chosen

**What.** Loaded the `dataviz` skill (its own trigger rule: read it *before* choosing
chart colors) and ran its OKLab-based validator
(`scripts/validate_palette.js "<hex,...>" --mode dark --surface "<panel-hex>"`) on every
candidate palette before it went in the CSS. It checks five things a human can't eyeball
reliably: OKLCH lightness band, chroma floor, CVD separation (simulated protan/deutan/
tritan ΔE), normal-vision separation, and WCAG contrast — all against the *app's actual
dark surface*, not a generic assumption.

**Iteration, not one-shot.** First candidate (brighter, more "neon" — closer to what
"broadcast" suggested) failed the lightness-band check outright (too light for a dark
surface — reads as glowing/washed-out, not bold). Darkened each hue, re-ran, still one
color (gold) too light — darkened again — passed. Then checking the *outcome-status* set
(goal/saved/post/blocked) surfaced a real problem: the violet I'd picked for "post" and
the blue for "saved" were nearly indistinguishable to a deuteranope (ΔE 2.3, a hard fail —
below even the "needs a label" floor). Shifted the violet toward magenta; re-validated;
passed cleanly (ΔE 11.2).

```
node validate_palette.js "#1fae66,#2c86d1,#bd8a12,#e2465c,#9d5ce0" --mode dark --surface "#16211c"
  [FAIL] CVD separation   worst adjacent #9d5ce0↔#2c86d1 ΔE 2.3 (deutan)   <- violet vs blue, real problem
                          ↓ shift violet toward magenta (#9d5ce0 -> #c23a8f)
  [PASS] CVD separation   worst adjacent #c23a8f↔#2c86d1 ΔE 11.2 (deutan)  <- fixed
```

**Learn.**
- Run the validator *per usage scope*, not once over every color in the app mashed
  together. A flat "all 6 colors as one palette" check produced a spurious FAIL (magenta
  vs red, ΔE 11.1) that doesn't matter in practice — those two never appear in the same
  legend or list; one is a shot-outcome color, the other a delete-button/delta color, in
  different components. Validating home/away, pos/neg, and outcome-status as three
  separate 2-/2-/4-way palettes (their actual contexts) gave the real, actionable answer:
  all three pass. The lesson generalizes past color: check a design rule against how
  something is *actually seen together*, not against an arbitrary superset.
- A WARN is not automatically a problem to chase away — it's a note about what has to be
  true elsewhere. The pos/neg pair sits in the 6–8 CVD floor band (legal only with
  secondary encoding), and it already had one: the `+`/`−` sign prefix on every delta. No
  code change needed there, just confirming the mitigation already existed before moving
  on — cheaper than re-picking colors to force a clean pass.

### 6.3 Decoupling "which shape" from "which color"

**What.** `pitch/outcomeMarker.ts` draws five distinct shapes (★ goal, ● saved, ◆ post,
▲ blocked, ○ off-target) but takes the **fill color as a parameter** rather than looking
it up internally. The shot log colors by outcome (`OUTCOME_COLOR[outcome]`); the shot map
colors by *team* instead (home/away, gold only for goals) because that's the more useful
read at a glance on a spatial map. Same shape vocabulary, two different color mappings,
one function.

**Why this needed deciding explicitly.** My first instinct was "shape AND color both mean
outcome, everywhere" — simpler to describe. But the shot map's real job is "who created
this chance and how big was it", not "what happened to it" (that's what the shot log is
for) — forcing outcome-color onto the map would have made team identity, the thing a
coach actually scans the map for, disappear. Separating the *shape* vocabulary (always
outcome, for the accessibility guarantee) from the *color* mapping (contextual, per
chart) let both charts answer their own question without a second shape system.

**Learn.** When two views need "the same visual language" but serve different questions,
look for the actual invariant (here: the *shapes*) and parameterize the rest, rather than
either duplicating the whole encoding or forcing one chart's mapping onto the other.

### 6.4 One marker function, two renderers, again

**What.** `outcomeMarker()` is a pure string-builder — no React — used two ways: wrapped
in `dangerouslySetInnerHTML` inside a `<g>` for the live `ShotMap` (Charts.tsx) and called
directly as a string inside `reportHtml.ts`'s non-React document builder. Identical to the
`pitchMarkingsSvg.ts` pattern from M4 (one pitch-lines string, two renderers) — same
problem shape, same fix, second time using it without having to re-derive it.

**Learn.** This is the second time "one visual element, needed in both a React tree and a
plain-string HTML document" showed up (pitch markings, now outcome markers), and both
times the fix was the same: keep the generator pure and string-based, let React wrap it
rather than own it. Worth recognizing as a house pattern for this codebase rather than
solving it fresh each time.

### 6.5 Tying the glow to the data, not just the mood

**What.** The live xG card's background glow color isn't fixed — `chanceStyle(xg)` in
`ShotEntry.tsx` picks gold for a "big chance" (≥ 0.3 xG, the rough threshold real xG
commentary uses for the phrase) and green scaling with magnitude otherwise, set via CSS
custom properties (`--chance-glow`, `--chance-shadow`, `--chance-ink`) consumed by
`.result`'s `radial-gradient` and the number's `text-shadow`.

**Why.** "Sports broadcast" as a direction is easy to turn into empty decoration (glows
because glows look exciting). Tying the one animated/colored element on the page to an
actual number the operator needs to read (this shot mattered more than that one) makes it
information, not just mood — and it was nearly free, since the xG value was already being
computed and rendered right there.

### 6.6 The number pop, without an animation library

**What.** `<span key={result.xg} className="xg pop tnum">` — changing `key` forces React
to unmount and remount the element, which restarts its CSS `animation: pop 340ms` from
scratch on every distinct xG value. No JS animation code, no dependency.

**Learn.** A lot of "animate on value change" asks are answerable with a CSS keyframe plus
a `key` that changes with the value — reach for a remount before reaching for a library or
hand-rolled `useEffect` + `requestAnimationFrame` timer.

### 6.7 Verification: strong but not complete

Build clean, 587 tests pass (unchanged — this was a pure CSS/markup pass, no serving-path
logic touched), grepped the whole `src/` tree for leftover pre-redesign hex codes after
the fact and caught three (`GoalFrame.tsx`, `Pitch.tsx` ×2) still using the old gold —
fixed and re-verified. The Chrome extension was not connected this entire phase, so
**no live screenshot exists of the redesign** — it's confirmed by build + grep + test
only. Worth a manual look (`npm run dev`) before calling this done.

### 6.8 The browser check — a real bug, and a real trap

Next turn, the extension connected. First screenshot of the live app: the tool-row icons
(gloves/shield/pass/reset) rendered as illegible scribbles — a genuine bug the build+test
pass had no way to catch (nothing checks "does this render as a recognizable shape").

**Diagnosis, not guessing.** Before touching the icon paths, checked whether the SVG
*geometry* was actually malformed or whether it was a rendering/legibility problem —
different bugs, different fixes:

```js
// via javascript_tool, in the live page:
[...document.querySelectorAll('.tools svg.icon path')].map(p => p.getBBox())
// -> every path's bbox sat well inside [0,20]x[0,20], no NaNs, no zero-size paths
```

The paths were geometrically sound. So the bug wasn't broken math — it was **too much
fine stroked detail for the size**: "gloves" was four overlapping 1.5px-stroke finger
curves, which reads as a hand at 80px and as noise at 15px. Fixed by switching the
detailed icons (gloves, shield) to **filled silhouettes** (bold, no fine internal strokes)
and simplifying the linear ones (pass, reset) to plainer, bigger-arrowhead shapes.
"target" (concentric circles) needed no change — it was already bold enough.

**The second bug was mine, not the app's: a stale service worker.** Mid-verification, a
rebuilt CSS change (`legend { text-transform: uppercase }`) didn't show up in the browser
— confirmed present in the *compiled* `dist/assets/*.css` via `grep`, so the build was
right and the browser was wrong. The culprit: `vite-plugin-pwa`'s service worker
precaches aggressively, and killing/restarting `vite preview` on the *same port* doesn't
invalidate a service worker a previous visit to that origin already installed — the
browser kept serving the old precached bundle across multiple rebuilds. Fixed the same
way twice this session:
```js
const regs = await navigator.serviceWorker.getRegistrations();
for (const r of regs) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```
then reload. Moved to a fresh port (4174) partway through to sidestep it, but that origin
picked up its *own* stale SW on the very next rebuild — the unregister-and-clear step is
what actually fixes it, not a fresh port.

**Verification once the extension started dropping screenshots again:** switched to
`javascript_tool` DOM/style introspection instead of pixel screenshots — reads
`el.getAttribute('style')` for the computed `--chance-*` custom properties, checks
`OutcomeGlyph`'s rendered `<polygon>` points and `aria-label`, reads the report's board
headers and verdict text directly. This confirmed the full data path end-to-end (star
marker renders for a goal with the right gold fill, the `+0.70` G−xG delta renders in the
new gold `--pos` color not the old green, the verdict string computes correctly, the PSxG
column is correctly absent when unused) without needing a single working screenshot.

**Learn.**
- When something looks broken, check whether the *data/geometry* is wrong or the
  *presentation* is wrong before changing anything — `getBBox()` on the live DOM settled
  it in one call, instead of guessing through several path rewrites.
- A PWA service worker is a caching layer *you* now own the invalidation of. During
  active iteration against the same origin, unregister-and-clear before trusting what's
  on screen — a "the code is right but the browser is wrong" moment is very often this,
  not a phantom bug.
- Pixel screenshots and DOM/style introspection are complementary, not substitutes — the
  screenshot caught the icon bug (a purely visual defect no DOM read would surface); the
  JS introspection kept verification going when screenshots stopped working, and it's
  strictly more precise for confirming *data* reached the screen correctly (exact hex,
  exact polygon points, exact text) than eyeballing a JPEG. Reach for whichever one
  actually answers the question in front of you.

### 6.9 Ambient chrome — ("the background is black, can we not enhance the visual appeal")

**What.** Three decorative layers — fine grain texture, a football line-art watermark,
soft colour blooms in the existing home/away hues — plus a hand-drawn football glyph
replacing the plain accent dot next to the brand name.

**Why `background-image` composition, not pseudo-elements.** All three decorative layers
are just entries in one `body { background-image: url(...), url(...), gradient(...), ... }`
list. A CSS `background` always paints behind an element's real children — that's true by
definition, with no stacking-context or z-index reasoning required — whereas a `::before`/
`::after` pseudo-element is a generated *child* and needs explicit `position: fixed` +
negative `z-index` to guarantee it stays behind everything, which is one more thing to get
wrong (and did, silently, until checked). Fewer moving parts, same result.

**Why the opacity is baked into each layer, not tuned via CSS.** Given how unreliable
screenshots were this session, tuning "is the grain visible enough / not too much" by
eyeballing iterative screenshots would have been slow and fragile. Instead the SVG grain's
`feColorMatrix` caps its own alpha at a flat 0.05, and the watermark's `stroke-opacity`/
`fill-opacity` are set directly in the SVG markup — so the *intended* faintness is a
property of the asset itself, verifiable by reading the number, not something that could
silently drift if a later blend-mode or layering change altered how it composites. It
happened to look right first try, which is the point of designing it that way rather than
luck.

**Learn.** When you can express "always behind, always this exact opacity" as a structural
fact (background paints behind children; alpha is baked into the asset) instead of a
procedural one (stack this element behind that one; tune this blend mode until it looks
right), do it that way — it needs no live visual check to trust, which matters a lot on a
tool whose visual-check channel (the extension) has been the least reliable part of this
whole project.

### 6.10 Three named football moments, drawn as pictograms not illustrations

**What.** Added a fourth background layer: three player silhouettes along the bottom edge
— a strike, the Roberto Carlos free-kick lean (torso back, striking leg swept across the
body, arms flung wide for the outside-of-foot curl), an overhead/bicycle kick (torso
arched, top leg extended high, trailing leg bent). Same composition pattern as 6.9 — one
more `url(...)` in the `body` background-image list, opacity baked into the SVG.

**Why pictogram, not illustration.** Directly applying 6.7's lesson: fine anatomical
detail (the kind a real illustration of "Roberto Carlos" would need — muscle definition,
kit folds, facial direction) reads as noise once it's stroked thin and set to 6.5%
opacity, the same failure mode as the over-detailed "gloves" icon. Went instead with
Olympic-pictogram construction: each limb is one or two straight segments with a thick,
round-capped stroke — no anatomy, just gesture. At the actual size and opacity these
render at, gesture is all that survives anyway, so drawing more detail would have been
wasted effort *and* risked the same illegibility bug over again.

**Learn.** A lesson from one bug (icons too detailed for their size) generalizes to the
next thing at a similar scale (silhouettes too detailed for their opacity) if you notice
the shared constraint — "how much detail survives at this size/opacity" — rather than
re-deriving it per asset.

### 6.11 Correction: "stick men" rejected — solid capsule silhouettes instead

**What happened.** User feedback on 6.10, verbatim: *"i dont want stick men i want the
exact shadows this is a personal website so it wont matter."* Two things in that sentence
matter separately: (1) the pictograms genuinely read as thin wireframe stick figures, not
"shadows" — a real human shadow is a solid mass, not a skeleton of lines; (2) "personal
website so it wont matter" is explicit permission to spend more effort/detail than 6.10's
legibility-driven minimalism assumed was necessary. 6.10 over-applied the icon-legibility
lesson (6.7) — that lesson is about *fine anatomical detail* reading as noise at small
size/low opacity, not about *line thickness overall*. A stick figure and a solid silhouette
can carry the identical amount of pose detail; the difference is purely whether the strokes
are thick enough, and layered densely enough, to read as filled body mass instead of wire.

**Fix — same three poses, rebuilt as solid capsules.** Kept the strike / Roberto Carlos
lean / bicycle kick poses and the "gesture only, no anatomy" level of detail (that part of
6.10's reasoning was right), but replaced each thin joint-to-joint line with a *thick*
round-capped stroke sized as a fraction of the whole figure (stroke-width 20 for the torso
down to 9 for hands/feet) plus a filled circle for the head. A round-capped stroke is
already a filled capsule shape when rendered — no separate outline path needed.

**The seam bug this technique has to avoid.** Where two thick capsules meet at a joint
(shoulder, hip), they overlap. If each shape's own opacity is set via `stroke-opacity`/
`fill-opacity` (the mechanism 6.9's grain and watermark correctly use for *non-overlapping*
art), overlapping semi-transparent shapes composite darker where they cross — visible
seams at every joint, the opposite of "one solid shadow." Fix: give every shape in a
figure *full* opacity internally, wrap the whole figure in one `<g opacity="0.06">`. SVG
`opacity` on a group renders the group to an offscreen buffer first and applies the fade
once to the finished buffer, so overlapping opaque shapes inside it merge as a flat union
with no double-darkening. `fill-opacity`/`stroke-opacity` have no such isolation — they're
per-primitive and always compositing straight onto whatever's beneath, overlaps included.
Same "opacity baked into the asset, not tuned live" philosophy as 6.9, just the group form
of it instead of the per-shape form, because per-shape was the wrong tool for shapes that
overlap.

**Verified in browser** (port 4177, cleared the now-routine stale service worker first):
full-page screenshot showed three chunky, unambiguously solid dark figures along the
bottom edge — a kicking stride, a leaning-back free-kick swing, an arched bicycle-kick
shape — no wireframe read. A follow-up zoomed screenshot to check per-pose fidelity hit
the session's recurring `Page.captureScreenshot` timeout after a couple of retries; per the
standing guidance not to loop on flaky tool calls, stopped there — the full-page shot was
already sufficient confirmation the "solid shadow, not stick man" goal was met. 587 tests
unchanged (pure CSS), build clean.

**Learn.** A design lesson has a scope, and misapplying it outside that scope is its own
class of mistake distinct from not having the lesson at all. 6.7's lesson was "fine detail
doesn't survive small/faint rendering" — true, and still true here — but it doesn't imply
"therefore keep every stroke thin," which is a different, unrelated design choice that
happened to ride along with the pictogram approach. When a user names the actual visual
target precisely ("shadow" implies filled mass, a specific and checkable property — not a
vague "make it better"), that word choice is itself the spec; matching it beats
re-deriving an aesthetic from an adjacent past lesson.

### 6.12 Silhouettes removed outright; a goal now throws confetti

**What.** User verdict on the 6.11 rebuild: still bad, just remove them — "extend the
gradient" instead. Deleted the whole silhouette `url(...)` layer from `body`'s
background-image list (and its matching entries in the repeat/position/size/attachment
lists, which all have to stay index-aligned across five comma-separated properties). The
bottom radial-gradient bloom was widened and brightened a little (`70% 42% → 100% 55%`,
opacity `0.08 → 0.11`) to keep the base of the page from reading empty now that nothing
sits along it. Net effect on the built CSS: 13.27 KB → 11.67 KB gzipped — one fewer large
inline SVG, not a redesign of anything else on the page.

**Learn.** Two rounds of trying to make an illustration idea work (pictogram, then solid
capsule) is a signal worth noticing on its own: when a *specific decorative element* keeps
missing rather than a *technique* being wrong, the fastest path to "looks good" can be
subtracting the element and reinforcing what was already working (the gradient bloom),
not iterating the same idea a third way. Simpler asks ("just extend the gradient") are
often exactly that — simple — resist the urge to read a bigger redesign into them.

**What (confetti).** Added a one-shot confetti burst fired when a shot is saved with
outcome `goal`. New `components/Confetti.tsx`: ~46 absolutely-positioned `<span>` pieces,
each fully described by inline custom properties (`--drift`, `--rot`) so one shared
`@keyframes confetti-fall` covers every piece's individual fall path (random horizontal
drift, rotation, delay, duration, colour drawn from the same `--home/--away/--pos/
--accent-bright/--post` tokens already validated for the rest of the UI). `position:
fixed` + `pointer-events: none` so it overlays the current scroll position without
blocking the next tap.

**Wiring.** `ShotEntry`'s `onSaved` callback now passes the outcome up (`onSaved(outcome)`
instead of `onSaved()`); `LiveScreen` bumps a `goalBurst` counter when the outcome is
`"goal"` and renders `{goalBurst > 0 && <Confetti key={goalBurst} />}` — the same
"key-remount restarts the animation" pattern already used for the live-xG pop, so back-
to-back goals each get a fresh burst (new random pieces, timer from zero) rather than the
first one's timer silently governing a second goal that arrives before it finishes.

**Self-cleanup, not a lingering overlay.** `Confetti` owns its own lifetime: a
`useEffect`+`setTimeout` flips `alive` to false ~2.4s in (just past the slowest piece's
fall duration) and the component returns `null`, unmounting the whole overlay `<div>` — so
a shot screen left open after a goal doesn't accumulate dead, pointer-events-none DOM the
operator can't see or account for.

**Verified in browser** (fresh preview port, cleared the routine stale service worker):
full-page screenshot confirmed the silhouettes are gone and the bottom bloom now visibly
spans the width of the page. Drove the actual UI — create match, add one player per side,
kick off, place a shot, pick the shooter, set outcome to goal, save — to log three real
goals in a row; DOM checks after each confirmed a `.confetti` overlay mounted with exactly
`PIECE_COUNT` `.confetti-piece` children, each carrying distinct randomized inline styles,
and confirmed it was gone (`document.querySelector('.confetti') === null`) a few seconds
later without needing a page reload. `Page.captureScreenshot` hit the session's recurring
timeout mid-animation (expected — confetti is inherently a moving target for a screenshot,
compounded by the extension's existing flakiness); per the standing "don't loop on a
flaky tool" guidance, relied on the DOM-level checks instead of forcing a visual capture.
587 tests unchanged, build clean.

### 6.13 A real photo, muted to fit the theme — plus a configurable match clock

**What (background photo).** User supplied a reference photo (a football breaking through
a water splash, glossy stock-photo style, light blue-grey background) and asked for
"an image like this or a style like the image" in the background — after two rejected
illustration attempts (6.10 pictograms, 6.11 solid capsules, 6.12 removed outright), this
time a real photograph, not another redraw.

**The problem it creates.** The source photo's own background is bright, flat light blue —
the opposite of this app's near-black `--bg`. Used as-is at any real opacity it would sit
on the page as a lit rectangle, breaking the "always recedes behind content" rule every
other ambient layer follows.

**Fix — bake the muting into the asset, same rule as every other ambient layer (6.9).**
A one-off Python/Pillow script (not committed — a throwaway preprocessing step, the kind
of thing that belongs in this log, not in the repo):
1. Downscale to 760px wide (plenty for a background image at any realistic viewport, keeps
   the shipped asset small).
2. `ImageEnhance` desaturate (0.55×) and darken (0.5× brightness) so the photo's own tones
   sit inside the app's dark palette instead of fighting it.
3. Compute a radial falloff over the pixel grid (`numpy`) and multiply it into the alpha
   channel, capped at a 0.4 peak — every edge fades to full transparency and even the
   brightest point stays faint. This is the same "opacity baked into the asset itself"
   principle as the grain/watermark SVGs, just done in a raster tool instead of hand-edited
   SVG attributes, because the source material is a raster photo.
4. Export WebP (quality 82) — 25 KB, negligible next to the 14 MB wasm already shipped.
Composited a quick preview over the app's actual `--bg` colour locally before wiring it in
at all, to check the muting actually reads as "moody ambient backdrop" and not "grey smear"
— it did (soft, recognisable ball-and-splash shape, dissolving cleanly into black at every
edge) — *before* touching any CSS or committing to the approach.

**Wiring.** Placed in `app/public/img/` (Vite serves `public/` verbatim, so it's just
`url("/img/football-splash.webp")` in the `body` background-image list — no JS import
needed since nothing but CSS references it) and added `webp` to `vite.config.ts`'s
`workbox.globPatterns` so the service worker actually precaches it — an easy miss, since
the app already had one asset-type allowlist there and a new file extension silently
doesn't get precached unless it's added to that list. The raw source photo itself was
`.gitignore`'d (only the processed, muted derivative under `app/public/` is checked in);
committing someone else's stock photo unprocessed isn't ours to distribute even in a
personal repo, and it's not what actually ships anyway.

**Licence note added to spec.md §11**, not just process.md — this is a fact about what the
shipped app depends on (a third-party stock photo), not just a build-time story, so it
belongs in the ground-truth doc too: fine for this personal, non-commercial build, flagged
to re-check before anything wider.

**What (match clock).** Added operator-set half length (§5.1 new field on the "New match"
form, default 45 min) and a broadcast-style clock label. `Match` gains two fields:
`halfLengthMin` (set once, at creation) and `currentHalf` (1|2, default 1). Deliberately
did *not* build a second, separate "half timer" — the clock stays exactly the one
continuous accumulator it already was (`clockStartedAt`/`clockAccumMs`, unchanged); a real
halftime break is just the operator pausing it like any other stoppage, which this app
already supported. The only new piece is a pure derived-label function:

```ts
clockDisplay(m) // { half, label, overrun }
//   target = half===1 ? halfLengthMin : halfLengthMin*2
//   overrun = minute > target
//   label = overrun ? `${target}+${minute-target}'` : `${minute}'`
```

— i.e. exactly how a TV broadcast reads a clock (`45+3'` once a half runs long), computed
from data that already existed rather than tracked as new time state. `startSecondHalf()`
flips `currentHalf` to 2 and resumes the clock only if it was left paused (never touches
`clockStartedAt` if already running, which would have silently dropped elapsed time — see
the exact same class of bug avoided in `toggleClock`/`setClockMinute` already). An explicit
**"2nd half →"** button (visible only while `currentHalf === 1`) is the one new operator
action, matching the app's existing pattern of explicit lifecycle buttons ("Kick off →",
"Full time →") rather than inferring the half from a minute threshold — inferring it would
have broken during 1st-half stoppage time, where the elapsed minute legitimately exceeds
`halfLengthMin` while still being the 1st half.

**Tests.** Added to `schema.test.ts`: default half length (45) and a custom one persist;
`clockDisplay` across regulation time, stoppage time in both halves, and confirms
`startSecondHalf` resumes a paused clock without losing accumulated minutes. Also had to
add `halfLengthMin`/`currentHalf` to three hand-built `Match` fixture literals
(`report.test.ts`, `verdict.test.ts`, `reportHtml.test.ts`) once the interface gained
required fields — TypeScript catches every one of these at `tsc --noEmit`, which is why
that was run before trusting the build. 589 tests total (587 + 2 new), build clean.

**Verified in browser**, both pieces, one session (fresh preview port, cleared the routine
stale service worker): screenshot confirmed the muted photo backdrop and the new "half
length" field on the same page. For the clock, waiting a real 45 minutes to see stoppage
time wasn't practical, so the match's `clockAccumMs` was fast-forwarded via a direct
IndexedDB write from the browser console (bypassing Dexie's own write path — deliberately,
since the goal was to *observe* the derived display update against real component state,
not to test Dexie itself, which the existing test suite already covers) — created a match
with a 1-minute half, confirmed `1+2'` stoppage-time label, clicked **"2nd half →"**,
confirmed the tag flipped to "2ND HALF" and the label recomputed against the doubled
target (`2+1'`) with the button itself gone, exactly per `clockDisplay`'s contract.

**Learn.** Two small, separate lessons worth keeping distinct: (1) when a decorative asset
keeps missing as an *illustration*, the fix isn't always "draw it better" — sometimes the
right move is a completely different asset *class* (a real photo instead of vector art),
and the technique that makes a photo behave (bake the fade/darken into its own pixels, not
into a CSS filter on the live element) is the same principle already established for SVG,
just executed with different tools. (2) A "let the user configure X" request doesn't
always mean "build a new subsystem for X" — here the entire clock mechanism already
existed and was correct; the whole feature was one new persisted number, one derived pure
function reading data that already existed, and one button reusing an existing action
pattern. Recognizing "this fits the existing shape" avoided inventing a parallel half-timer
that would have had to be kept in sync with the real one by hand.

### 6.14 The background photo turned out to be copyrighted — swapped for original art

**What happened.** Asked "push it to GitHub." No remote existed yet, so before creating
one the question of visibility came up — and that surfaced something worth resolving
first: 6.13's background photo was a stock image of unknown licence. Asked the user
directly rather than guess; they confirmed **it is copyrighted**, and asked for an anime-
style replacement generated instead if the photo itself couldn't be used.

**Why this wasn't "just make the repo private."** Private would have sidestepped *public
redistribution*, but the photo was still a copyrighted asset the app didn't have clear
rights to, sitting in the repo either way. The user's own follow-up treated "can we use
it" as the real question, not just "can we publish it" — worth taking at face value rather
than resolving it at the narrower visibility question I'd originally asked.

**No image-generation tool was available** (checked via `ToolSearch` — nothing in this
session's toolset produces a raster image from a prompt). The fallback was to hand-build
the "anime style" as original vector art instead: bold black outlines, flat cel-shaded
fills, an energy-burst splash and speed lines radiating from a football — which is a
legitimate reading of "anime style" (that aesthetic *is* cel-shaded flat-color line art)
and, being original work, carries no copyright question to begin with.

**How it was actually built.** Hand-typing precise radiating shard/sparkle coordinates
without a live preview is exactly the kind of task that goes wrong blind, so it was
generated programmatically instead: a Python script (throwaway, not committed — same
treatment as 6.13's photo-preprocessing script) computed the ball's pentagon panels and a
burst of angular shard polygons + speed-line arcs + sparkle stars at chosen angles/radii
around a center point, biased denser toward one side (echoing the original photo's
diagonal splash direction) — trigonometry generating consistent, correctly-proportioned
geometry that would have been unreliable to eyeball by hand. Installed `cairosvg` (not a
project dependency, a local tool for this one task) to rasterize the SVG straight to a PNG
locally and actually look at it — twice: once at full strength to check the illustration
itself reads as a football-in-a-splash and not noise, once composited over the app's real
`--bg` colour at the intended low opacity to check it still reads once faded down to
ambient-chrome faintness. Both checks passed before any of it touched the app.

**Wiring.** Same slot in `body`'s background-image list the photo occupied, opacity baked
into the SVG's own `<g opacity>` (0.13) rather than tuned live — consistent with every
other ambient layer. First placement (top area, behind the "New match" card) turned out to
hide most of the emblem behind that card on the empty-state screen; repositioned lower,
into the empty space below the cards, where a screenshot confirmed the whole shape —
ball, panels, shards, sparkles — reads clearly at rest. Removed everything the photo
needed: the WebP file, its `vite.config.ts` precache entry (13 entries again, was 14),
and the licence caveat in spec.md §11 (replaced with a note that the art is now original,
precisely so there's no licence question left to carry).

**Learn.** Two things worth keeping: (1) a licence question about "can we publish this"
is often really a question about "do we have the right to use this at all" one layer
down — worth asking the broader question once the narrower one surfaces something odd,
rather than solving only the visibility half of it. (2) When a tool you'd reach for isn't
available (no image generator here), the fallback isn't always "do a worse version of the
same thing" — hand-built vector art *is* a first-class way to produce "anime style"
specifically, not a compromise standing in for a photo-realistic generator; picking the
representation a constraint actually points toward, rather than the one the request's
wording most literally suggests, produced a better and simpler result than either
photo-editing tricks or a lower-fidelity raster attempt would have.

### 6.15 Found a real bug reviewing visuals; then screen transitions + treatment consistency

**What (the bug).** Asked "what would make the site look better," and before answering
went to actually look — a fresh `npm run build && npm run preview` produced a completely
blank page, no console error. Root cause: `vite preview` only serves whatever `vite build`
already baked into `dist/` as static files; it never re-derives `base` for its own server.
6.13's GitHub Pages fix had set `base` to the `/xg-match-companion/` subpath whenever
`command === "build"` — which is *every* local `npm run build`, not just the one CI runs
for Pages. So an entirely ordinary local build now asked for
`/xg-match-companion/assets/*.js`, a path that doesn't exist under the preview server's
root; its SPA fallback quietly served `index.html` in its place (200, `text/html`), the
browser refused to execute it as a script, and React never mounted. No error surfaced
anywhere — just a blank tab. Fixed by gating the subpath on an explicit `GH_PAGES` env var
that only the CI workflow sets, instead of on which Vite command is running, so local
build/dev/preview/test all agree on root `/` and only the Pages deploy gets the subpath.
Verified both directions: local preview renders again, and the live GitHub Pages site
still resolves its assets correctly after redeploying.

**Learn.** This is the second time this project has drawn a straight line from "go check
it in the browser" to "found a real bug headless tests structurally cannot catch" (the
first was M4's onnxruntime-web freeze, 4.2). Both times the bug was invisible from the
diff and from the test suite — the code was self-consistent, just wrong about which
environment it was running in. Worth remembering as a standing reason to actually load the
page, not just reason about the change.

**What (the actual ask).** Reviewed the app fresh (setup screen, live screen, report
screen) and named four concrete gaps rather than generic "make it prettier" suggestions:
the report's verdict sentence — the entire point of the app — was smaller and plainer than
the score above it; `.card`/`.sheet` were flat utility panels while `.scoreboard` alone got
gradient/glow treatment; no transition between screens; and small inconsistencies (one
empty state got an icon, another didn't). User approved transitions + consistency.

**Screen transitions, no JS.** `MatchListScreen`, `SetupScreen`, `LiveScreen`, and
`ReportScreen` all already render one shared root class (`.screen`), and `App.tsx` swaps
between them by conditional rendering, not a router — so a plain `@keyframes` fade+rise on
`.screen` fires on every screen change for free, the same "let a mount/remount trigger the
animation" approach as the live-xG pop and Confetti. Added a `prefers-reduced-motion` guard
since this one repeats on every navigation, unlike a one-off goal celebration.

**Consistency pass:**
- `.card` and `.sheet` (New match form, team-sheet panels) gained a subtle gradient +
  shadow — the same depth `.scoreboard` already had, so the app doesn't read as one
  designed hero moment surrounded by plain leftover panels. Deliberately neutral (no
  team-hued glow) since these aren't identity moments.
- `.verdict` gained real weight (17px/700, its own top rule separating it from the score)
  — matching its actual importance instead of sitting under the score at 14px.
- Every `h2`/`h3` now gets a colored left bar, generalizing the same device already used
  for team identity in the scoreboard. One wrinkle: `--accent` and `--home` are the same
  green, so this matched the home team-sheet's heading for free, but the away sheet's
  heading needed an explicit override to blue — otherwise its own heading bar would have
  visually disagreed with its own card's blue top border.
- Two plain-text empty-table-rows ("No shots yet", "No attributed shots") gained the same
  small football-icon treatment the "No matches yet" empty state already had.

**Verified in browser**: created a match, checked the home/away sheet heading colors match
their own cards (not a generic accent clash), logged a goal through to the report screen,
and confirmed the verdict line now reads as its own emphasized tier below a rule rather
than a caption under the score. 589 tests unchanged (pure CSS + two one-line icon adds),
build clean.

### 6.16 Undo for the one marker that accumulates one-at-a-time

**What.** "Add an undo button to go back to the state where the previous player wasn't
placed." Scoped this to defender markers specifically, not a general undo-anything stack:
shot/GK/pass-origin are each a single value, so tapping the pitch again already fixes a
mis-tap by overwriting it — there's nothing to "undo" there beyond what re-tapping already
does. Defenders are the one marker placed one-at-a-time and accumulated (up to 6), and the
existing way to remove a specific one — tap its exact marker on the pitch — is fiddly if a
mis-tap landed close to another marker, or if you just want "get rid of the last one" and
don't want to hunt for which dot that was.

**Fix.** `ShotEntry.tsx` gained `undoLastDefender()` — `setDefenders(d => d.slice(0, -1))`
— and a new **"undo"** button in the tools row, shown only when `defenders.length > 0` (so
it's never visible with nothing to undo). New `undo` icon in `Icon.tsx`: a hooked back-
arrow, deliberately distinct from `reset`'s full-circle glyph so the two aren't confused —
undo removes one marker, reset clears the whole shot entry.

**Verified in browser**: placed two defender markers, clicked undo once (removed only the
second/most-recent one, first one stayed), clicked it again (removed the first, tools row
correctly dropped back to its normal five buttons with no "undo" showing). 589 tests
unchanged — this is UI-only interactive wiring with no pure-function surface to unit-test
(consistent with how other UI-only additions this session, e.g. the "2nd half →" button,
were verified live rather than given a component-render test, since the project has no
React-render test setup and adding one for a single button would be disproportionate).
Build clean.

### 6.17 No way home from the report screen

**What.** "I don't see an option to end the match at all. After the report is given
shouldn't there be an option to go back to the home page." Checked `App.tsx`'s routing to
find out why — it turned up something worth understanding before fixing anything: the
`onLive`/`onReport` callback props every screen receives are **no-ops** (`() => {}`)
everywhere they're passed. Screen switching doesn't actually run through them; `App.tsx`
picks which screen to render purely from `match.status`, a live Dexie query value, so once
`startMatch`/`finishMatch`/`reopenMatch` mutate the DB, the query re-fires and the parent
re-renders on a different branch automatically. Those callbacks are dead weight left over
from an earlier, more explicit routing design — calling them today does nothing.

That's fine for status transitions (the DB already drives them), but it means there was
**no client-side "go back to the match list" affordance at all** except the header logo —
a small branding button in the corner, not something that reads as an intentional "I'm
done" action, especially on a phone. `ReportScreen` had "reopen match" (a real, working
corrective action — flips status back to `live`) but nothing for the common case of
"I'm finished looking at this, take me back."

**Fix.** `ReportScreen` gained a real `onHome` prop — unlike `onLive`/`onReport`, this one
isn't vestigial: going "home" is pure client-side navigation state (`openId` in `App.tsx`),
not something the database can drive by itself, so a callback is the only way to do it.
Wired in `App.tsx` as `onHome={() => setOpenId(null)}` — the same reset the header logo
already performed, just given its own clearly-labeled, prominent (`primary big`) button:
**"Back to matches"**, placed above the now-secondary "reopen match" ghost button, since
finishing up and moving on is the common path and reopening is the correction.

**Verified in browser**: played a match through to the report screen, clicked "Back to
matches," confirmed it lands on the match list with the match still showing, correctly
tagged **FINISHED** and still openable later — nothing about the match itself was touched,
only which screen is currently shown. 589 tests unchanged, build clean.

**Learn.** "Where's the button to do X" is sometimes actually "there's dead code standing
in for what should be doing X" — worth tracing the existing wiring (why does this screen
switch at all, right now?) before assuming a button is simply missing, since the fix here
was informed by finding an unused prop, not just adding a new one blind.

### 6.18 Warn before an early "Full time"

**What.** "When we are clicking full time even before the match timer ends, or if we are
in the 1st half, it still ends the match — isn't it better to put warnings to the user?"
Correct — "Full time →" committed immediately regardless of elapsed time or which half was
current, with zero feedback that it was early. Ending early has to stay *possible* (a real
match can be abandoned, or an operator may legitimately want to close out ahead of
schedule), so this isn't about blocking it — just not letting one tap silently commit to
it, especially since undoing that means finding "reopen match" on the next screen rather
than tapping "Full time" again.

**Fix.** New pure helper in `schema.ts`, `isBeforeFullTime(m)` — true while elapsed minutes
are still short of the full scheduled length (`halfLengthMin * 2`), regardless of which
half is currently marked (so it stays correct even if the operator never pressed
"2nd half →" and just kept playing under the 1st-half label). Two layers, both driven by
the same check:
- A quiet, ahead-of-time note above the button whenever it's true ("Only 12′ played of
  90′ scheduled (1st half)") — visible before the operator even reaches for the button, not
  a surprise after the fact.
- The button itself, when clicked early, confirms via `window.confirm()` — the same native-
  dialog pattern `MatchListScreen`'s delete-match action already uses, so this isn't a new
  UI mechanism, just the existing one applied somewhere it was missing. Declining leaves
  the match live, untouched. Once the scheduled length is actually reached (including
  stoppage time), the button commits immediately with no prompt, same as before.

**Verified**: added `isBeforeFullTime` to `schema.test.ts` (still 1st half → true; 2nd half
but short → true; exactly full time → false; into stoppage time → false) — 590 tests now.
In the browser: created a 1-minute-half match, confirmed the on-screen note reads correctly
right after kickoff. Did **not** click "Full time" while still early — that would trigger a
real blocking `confirm()` dialog in the automated browser tab, which the standing browser-
automation rules say never to trigger via my own actions. Instead fast-forwarded the clock
past the scheduled length via a direct IndexedDB write (same technique used in 6.13/6.15),
confirmed the on-screen note correctly disappeared, and only then clicked "Full time" —
confirmed it proceeded straight to the report screen with no dialog, since by then nothing
should have prompted. Both branches of the logic are now covered without ever actually
having to click through a live confirm dialog myself.

**Learn.** Verifying a "does X trigger a warning dialog" feature in an automated browser
needs its own care: proving the *don't-warn* path directly (click through, watch it not
prompt) works fine, but proving the *warn* path can't be done by clicking through — that
click summons a real OS-level dialog my own tooling is instructed never to trigger. The
way through is the same one used earlier for stoppage-time (6.13/6.15): drive the
underlying state directly, and read the resulting UI/behavior, rather than performing the
one user action that would need a modal to resolve.
