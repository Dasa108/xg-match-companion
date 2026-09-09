# xG Match Companion — Specification (Ground Truth)

**Status:** v1 draft · **Last updated:** 2026-09-10
**Owner:** project author · **Sport:** association football (11-a-side, standard goal 7.32 m)

This document is the single source of truth. Code, models, and UI follow this file.
Change the spec first, then the implementation.

`process.md` is the companion build log — every step taken is documented there (what / why /
how / lesson) so the build is reproducible and teachable.

---

## 1. Goal

Build a mobile-first application that lets one person on the sideline log every shot
in a local match by tapping a pitch and answering a few quick prompts. For each shot
the app computes an **expected-goals (xG)** value from a trained model. At full time it
produces a conclusion:

- which **team** created the better chances (higher total xG), and whether that matches
  the scoreline;
- which **player** had the better xG (volume and efficiency), and who over/under-performed
  their xG.

---

## 2. Scope

### In scope (v1)
- Pre-match setup: two team sheets (starting XI + subs), match metadata.
- In-match shot logging: tap shot location on a pitch, drop keeper + defender markers,
  quick-tap categorical inputs. Target **≤ 25 s per shot** (UX goal only — the model adapts
  to whatever was actually entered, see §8.4).
- Pre-shot xG prediction, computed in the browser, works with no connectivity.
- Live per-team and per-player xG tallies.
- End-of-match report: team xG comparison + verdict, player xG leaderboard,
  shot map, cumulative xG timeline, finishing over/under-performance.
- Local persistence of all matches; export as JSON/CSV.

### Deferred (v2+)
- **Post-shot xG (PSxG)**: operator also taps where in the goal mouth the ball went;
  second model; separates chance quality from finishing quality.
- Multi-device / multi-operator sync during a match.
- Cloud accounts, cross-device history sync.
- Automatic retraining pipeline from logged matches.

### Out of scope
- Live video ingestion or automated tracking.
- Non-football sports.
- Betting / odds features.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **xG** | Pre-shot expected goals: probability a shot is scored, given only information available *before* the ball is struck. Shooter-agnostic. |
| **PSxG** | Post-shot xG: probability of a goal given also the shot's placement/quality. v2. |
| **Freeze frame** | Positions of players (here: keeper + nearby defenders) at the moment of the shot. |
| **Shot triangle** | Triangle from the shooter to the two goalposts; the shooting lane. |
| **Adaptive model** | One xG model that accepts whatever inputs were captured for a shot and degrades gracefully as detail drops. Not a fixed set of tiers. |
| **Completeness** | Which optional input groups a shot has (`freeze-frame`, `assist`, `technique`, `context`, `pass-origin`). Drives the confidence indicator and the calibration bucket. |
| **Minimal inputs** | Always required: shot location, body part, situation. The model is guaranteed to run from these alone. |
| **Operator** | The single person on the sideline entering data. |

---

## 4. Users & usage context

- **One operator, one phone, one match at a time.** Portrait orientation, one-handed
  where possible, large tap targets, no keyboard entry during play.
- Pitchside conditions: **assume no connectivity**. All prediction and storage is local.
  Sync (if any) happens later on wifi.
- The operator watches live football and enters data in the gaps. The UI must support a
  **fast path** (location + 2 taps) and degrade gracefully when detail is skipped.

---

## 5. Product requirements

### 5.1 Pre-match setup
- Create match: date, competition/label, venue (free text), home team name, away team name.
- Enter both team sheets: player name + shirt number + starting/sub flag. Editable mid-match
  (subs). Minimum 1 player per team to start; full XI recommended.
- Optional pitch-size calibration (local pitches vary): operator can set actual length/width;
  clicks are normalised to a standard 105 × 68 m pitch before feature computation. Default =
  standard size.

### 5.2 In-match shot entry flow
1. Operator taps **"New shot"**.
2. **Pitch view** (SVG, attacking direction fixed left→right, half-pitch zoom near the goal):
   operator taps the shot location. A shooter marker appears; can be dragged.
3. **Shooter attribution**: pick team (toggle) + player (list of that team's on-pitch players,
   searchable by number). Required.
4. **Quick chips** (single tap each, sensible defaults pre-selected):
   - Body part: `right foot` / `left foot` / `head` / `other`
   - Situation: `open play` / `fast break` / `corner` / `direct FK` / `indirect FK` /
     `throw-in` / `penalty`
   - Under pressure: `none` / `light` / `heavy`
5. **Markers (optional — add the freeze-frame group)**: drag the **GK marker** onto the pitch; toggle
   `keeper well set` yes/no. Drop up to **6 defender markers** near the shooter. Optionally
   drop a **pass-origin marker** where the assist came from.
6. **Optional detail** (collapsed by default): first-time shot y/n · technique
   (`ground` / `low-driven` / `half-volley` / `volley` / `overhead` / `lob`) ·
   preceded by take-on y/n · one-on-one y/n · rebound/loose ball y/n ·
   assist type (`through ball` / `high cross` / `low cross / cutback` / `pull-back` /
   `lay-off` / `own dribble` / `set-piece delivery` / `none`) · keeper state
   (`set` / `advancing` / `off line` / `beaten` / `on ground` / `unsighted`).
7. **Outcome**: `goal` / `saved` / `off target` / `blocked` / `post`. (Used for reporting and
   future retraining, **not** for the pre-shot xG computation.)
8. Save. xG is computed instantly and shown with a one-line reason
   ("close range, tight angle, keeper off his line") and a confidence band whose width
   reflects the shot's completeness bucket (§8.4).
   *(As built: the reason is a rule-of-thumb read of the feature values, not SHAP —
   `app/src/xg/reason.ts`. The band widths (±0.025 / ±0.04 / ±0.06 for full / partial /
   minimal) are illustrative of the measured bucket accuracy gap, not calibrated intervals.
   True per-shot attribution + prediction intervals are a v2 item.)*

Every field except shot location, shooter, and outcome has a default and may be left untouched.

### 5.3 Live tallies
- Header shows running **team xG** (home vs away) and shot counts.
- Per-player running xG accessible in one tap.

### 5.4 End-of-match report
- **Team xG:** totals, difference, and a verdict string (see §9).
- **Player xG leaderboard:** per player — shots, total xG, xG/shot, biggest single chance,
  goals, `goals − xG` (finishing delta). Sortable.
- **Best xG player:** highest total xG (primary). Also surface best xG/shot with ≥ 3 shots
  (efficiency award).
- **Shot map:** all shots plotted, radius ∝ xG, colour: goal / home / away.
- **xG timeline:** cumulative step chart per team over match minutes.
- **Shot-quality distribution:** grouped histogram, shots per xG band per team
  (bands 0–.05–.1–.2–.35–.6–1).
- **Export** (`app/src/xg/exportMatch.ts`):
  - `<date>_<home>-v-<away>.json` — `{schema:"xg-match-companion/v1", match, summary
    (team aggs + verdict), players, leaderboard, shots}`.
  - `<...>_shots.csv` — one row per shot: match, date, minute, side, team, number, player,
    x, y, shot_type, body_part, under_pressure, bucket, xg, raw, outcome, is_goal.
  - Delivered as a browser download (plain `Blob` + anchor; the app is the user's own).

---

## 6. Sideline input schema

Per shot. `req` = required to save. **Group** = which feature group the field feeds; the model
uses whichever groups are present (§8.4).

| Field | Type | Values | req | Group |
|---|---|---|---|---|
| `shot_xy` | point | normalised pitch coords (m), 105×68 | ✓ | core |
| `team` | enum | home / away | ✓ | — |
| `player_id` | ref | on-pitch player | ✓ | — |
| `body_part` | enum | right_foot / left_foot / head / other | ✓ (default right_foot) | core |
| `situation` | enum | open_play / fast_break / corner / direct_fk / indirect_fk / throw_in / penalty | ✓ (default open_play) | core |
| `pressure` | enum | none / light / heavy | ✓ (default none) | core |
| `gk_xy` | point | pitch coords (m) | ✗ | freeze-frame |
| `gk_well_set` | bool | — | ✗ | freeze-frame |
| `defender_xy[]` | point[] | 0–6 markers, pitch coords (m) | ✗ | freeze-frame |
| `keeper_state` | enum | set / advancing / off_line / beaten / on_ground / unsighted | ✗ | freeze-frame |
| `pass_origin_xy` | point | pitch coords (m) | ✗ | pass-origin |
| `assist_type` | enum | through_ball / high_cross / low_cross_cutback / pull_back / lay_off / own_dribble / set_piece_delivery / none | ✗ (default none) | assist |
| `technique` | enum | ground / low_driven / half_volley / volley / overhead / lob | ✗ | technique |
| `first_time` | bool | — | ✗ | context |
| `follows_take_on` | bool | — | ✗ | context |
| `one_on_one` | bool | — | ✗ | context |
| `rebound` | bool | — | ✗ | context |
| `outcome` | enum | goal / saved / off_target / blocked / post | ✓ | report only |
| `goalmouth_xy` | point | v2 (PSxG) | ✗ | — |

**Completeness buckets** (for calibration + confidence, §8.4): `minimal` = core only ·
`partial` = core + at least one optional group · `full` = core + `freeze-frame` + at least
one of `assist` / `technique` / `pass-origin`.

---

## 7. Data model

```
Match      { id, date, label, venue, home_team_id, away_team_id, pitch_len_m, pitch_wid_m,
             created_at, status(setup|live|finished) }
Team       { id, match_id, name, side(home|away) }
Player     { id, team_id, name, number, role(start|sub), on_pitch(bool) }
Shot       { id, match_id, team_id, player_id, minute, inputs(JSON per §6),
             features(JSON, computed), completeness(minimal|partial|full), xg(float),
             reason(string), outcome, created_at }
```

- Storage: **IndexedDB** on device (Dexie). One DB, all matches. No server required for v1.
- `features` is persisted so predictions are reproducible and auditable offline.
- `inputs` stores raw operator entries verbatim (for retraining and PSxG later).
- **As built (`app/src/db/schema.ts`):** `Team` is folded into `Match`
  (`homeName`/`awayName`) since there are always exactly two, identified by a `side` enum
  on `Player` and `Shot`. `Shot` also stores `bucket` and `raw` (uncalibrated model
  output). The match clock is `{clockStartedAt, clockAccumMs}` — elapsed is recomputed,
  never ticked in storage. Delete cascades match → players → shots in one transaction.

---

## 8. Model

### 8.1 Training data
- **Primary: StatsBomb Open Data** (github.com/statsbomb/open-data; non-commercial licence).
  Use `type == "Shot"`. Provides per-shot `freeze_frame` (all visible players + GK flag),
  which matches the operator's marker input. Access via `statsbombpy` or raw JSON.
- **v1 uses StatsBomb only.** Its volume (tens of thousands of shots, most with freeze frames)
  is sufficient, and it is the only open source whose player positions match the operator's
  marker input. Understat / Wyscout (no freeze frames) are a possible later augmentation for
  the `core`-only feature set; not in v1.
- **Validation aid:** Metrica Sports sample tracking (3 matches) — check freeze-frame feature
  engineering, not for training.
- Exclude own goals. Handle **penalties as a constant xG = 0.76** (do not learn from data).

### 8.2 Coordinate system & geometry

**As built (M1).** We work in **StatsBomb pitch units** (120 long × 80 wide, attack toward
`x = 120`), *not* metres. The training data is native in these units and the only thing that
matters is that the app maps a pitch tap into the same 120×80 frame — an extra rescale to
metres would just add a lossy step and a goal-width inconsistency (8 units ≠ 7.32 m after
scaling). 1 unit ≈ 0.9 m.

- Goal centre `(120, 40)`, posts `(120, 36)` and `(120, 44)` (8 units apart).
- `dist_x = 120 − x`, `abs_y = |y − 40|`, `distance = hypot(dist_x, y − 40)`.
- `angle` (subtended by the posts, radians) via the **law of cosines** — numerically cleaner
  than the `atan2` form: with `a = dist(shot, near post)`, `b = dist(shot, far post)`,
  `angle = acos((a² + b² − 8²) / (2ab))`, argument clamped to `[−1, 1]`, and `0` when the
  shooter is level with or behind the goal line.
- `in_box` = `x ≥ 102 and 18 ≤ y ≤ 62`; `in_six_yard` = `x ≥ 114 and 30 ≤ y ≤ 50`.
- Reference implementation: `training/features.py` (pure, no deps). The browser port must
  match it against `training/feature_fixtures.json`.

### 8.3 Features

**Included — geometry (derived from `shot_xy`):**
`distance`, `angle`, `lateral_offset`, `in_box`, `in_six_yard`.

**Included — shot mechanics (operator):**
`body_part` (one-hot), `first_time`, `technique` (one-hot), `follows_take_on`,
`one_on_one`, `rebound`.

**Included — pressure & defenders (from markers; `freeze-frame` group, optional):**
`defenders_in_cone` (opponents inside the shot triangle), `nearest_def_dist`,
`def_within_3` / `def_within_5` (units), `pressure` (ordinal none<light<heavy, in `core`),
`gk_dist` (shooter→GK), `gk_dist_from_goal` (GK off its line), `gk_lateral` (perpendicular
distance of GK from the shooter→goal-centre line), `gk_in_cone`, `teammates_in_box`.
`gk_well_set` / `keeper_state` are captured by the operator and fold in here.

**Included — build-up (operator):**
`situation` (one-hot), `assist_type` (one-hot),
`pass_origin_dist` and `pass_origin_lateral` (from `pass_origin_xy` when placed; else missing),
`angle_swing` = |angle(shot) − angle(pass_origin)| when both present.

**Excluded (and why):**
| Excluded | Reason |
|---|---|
| Provider xG, "big chance" / "clear-cut chance" flags | Subjective, annotated with hindsight, leak the outcome. |
| Shot placement, shot speed, on/off target, save/parry, end location | Post-shot info → that is PSxG (v2), not pre-shot xG. |
| Player / team identity, finishing-skill ratings | xG is deliberately shooter-agnostic; no reliable local per-player sample; overfitting risk. Finishing is analysed *on top* via `goals − xG`. |
| League, competition, season, venue, attendance, referee, crowd | Not causal for chance quality; leakage/bias risk. |
| Scoreline, xG race so far, possession %, momentum | Not causally about the chance. Minute & score-diff: v2 experiment only. |
| Weather, pitch quality, temperature | Unmeasured in training data; noise. |
| Timestamps, match IDs, player IDs | Identifiers → leakage. |
| Pass velocity, build-up xThreat, anything not judgeable live | Keeps the operator input surface honest. |

### 8.4 One adaptive model with graceful degradation

**One** gradient-boosted model, selected at inference by *what was captured for that shot*,
not by a time budget and not by a fixed A/B split.

- **Native missing handling:** LightGBM routes a missing value down its own branch, so any
  optional feature can simply be absent at inference (passed as `NaN`).
- **Feature-group dropout in training:** each training row independently masks whole optional
  groups (`freeze-frame`, `assist`, `technique`, `context`, `pass-origin`) with probability
  ~0.3–0.6 per group. The model therefore learns to predict across the whole spectrum — from
  `core` inputs only, up to everything.
- **Minimal-input guarantee:** `shot_xy` (→ geometry), `body_part`, `situation` are always
  present, so the model always runs.
- **Bucketed calibration:** fit a separate isotonic calibrator for each completeness bucket
  (`minimal` / `partial` / `full`). The app applies the calibrator matching the shot, so xG
  stays calibrated regardless of detail level.
- **Completeness + confidence:** store the bucket on the prediction; the UI shows a
  chance-quality confidence band that widens as fewer groups were supplied.
- **Robustness:** during training add Gaussian jitter **σ = 1.5 m** to freeze-frame marker
  positions so the model tolerates imprecise sideline taps.
- **Reporting:** evaluate and publish accuracy at each completeness level (§8.6) so the value
  of adding markers is known.

Penalties bypass the model entirely (constant xG = 0.76).

### 8.5 Training procedure
1. Assemble shots; engineer §8.3 features (normalise freeze frames to attack-right).
2. **Split by match, deterministic hash of `match_id`** — 15% test / 10% val (early
   stopping) / 13% calib (isotonic) / 62% train. Shots from one match never straddle
   splits. Every competition appears in every split, so train and test are the *same
   population* and calibration is meaningful; `evaluate.py` additionally reports
   per-competition test error as the generalisation check.
   *(Earlier draft held out whole competitions for test — that created a base-rate gap
   between calibration and test data and broke calibration-in-the-large. See process.md 1.5.)*
3. **Baseline:** logistic regression on `{distance, angle}`, then `+ body_part + situation`.
   This is the bar every model must beat.
4. **Main model:** LightGBM binary classifier with **feature-group dropout** (§8.4).
   Depth 3–5, learning rate ~0.02–0.05, early stopping on validation log loss.
   **Monotonic constraints:** xG decreasing in `distance`, `dist_x`, `defenders_in_cone`,
   `def_within_3/5`, `gk_in_cone`; increasing in `angle`, `nearest_def_dist`, `one_on_one`,
   `open_goal`. No oversampling — optimise log loss directly.
5. **Calibration:** fit isotonic regression **per completeness bucket** (`minimal` /
   `partial` / `full`) on a held-out calibration slice. Verify reliability diagram +
   Expected Calibration Error and Σ xG ≈ Σ goals *within each bucket*.
6. **Explainability:** v1 ships a rule-of-thumb `reason` string derived from the feature
   values (`app/src/xg/reason.ts`). SHAP-based per-shot attribution is a v2 upgrade
   (needs the model to export contributions).
7. **Degradation check:** evaluate the frozen test set with each completeness level simulated
   by masking optional groups (§8.6); confirm richer inputs never score worse than sparser.

### 8.6 Evaluation & acceptance thresholds (held-out test, per completeness level)

The single model is scored three ways by masking optional groups on the test set.

| Metric | `full` | `partial` | `minimal` |
|---|---|---|---|
| Log loss (primary) | ≤ 0.30 | ≤ 0.31 | ≤ 0.32 |
| Brier score | ≤ 0.085 | ≤ 0.087 | ≤ 0.090 |
| ROC-AUC | ≥ 0.79 | ≥ 0.77 | ≥ 0.76 |
| PR-AUC | report | report | report |
| Expected Calibration Error | ≤ 0.03 | ≤ 0.03 | ≤ 0.03 |
| Calibration-in-the-large (Σŷ / Σy) | 0.95–1.05 | 0.95–1.05 | 0.95–1.05 |
| Correlation vs StatsBomb xG (per shot) | ≥ 0.85 | ≥ 0.82 | ≥ 0.80 |

Every level must also beat the logistic baseline on log loss. Also report error by distance
band, body part, and situation.

**Release gate:** all cells met on the frozen test set, **and** monotonic quality — for the
same shots, `full` ≥ `partial` ≥ `minimal` on AUC and Brier strictly, and on log loss within
a ±0.004 tolerance (log loss is noisy on a few-thousand-row test set).

**M1 result (2026-09-10) — release gate PASS ✅.** 34,809 shots / 1,374 matches / 13
competitions. Test (4,988 shots): full-input log loss **0.263** (baseline 0.274), Brier
0.071, AUC **0.805**, ECE 0.013, calibration-in-the-large **1.03**, corr vs StatsBomb xG
**0.90**; partial and minimal also pass every threshold. Full report: `models/metrics.md`.

### 8.7 Serving & export
- Export the GBM to **ONNX**; export the three completeness calibrators alongside (ONNX or a
  small monotonic lookup table). The app picks the calibrator by the shot's completeness.
- Run in the browser with **onnxruntime-web** → inference works with no connectivity.
- **Feature-engineering parity:** implement geometry/freeze-frame features once in Python
  (training) and port to TypeScript (serving); a shared fixtures file (`feature_fixtures.json`)
  drives parity unit tests — Python and TS must agree to 1e-6 on every fixture.
- Bundle the current ONNX model + calibrators with the site; a later backend `/model` endpoint
  can push updates.

### 8.8 Retraining loop (v2)
Every logged real-match shot (raw `inputs` + `outcome`) is retained. Periodically:
re-evaluate the shipped model on accumulated local matches (drift check), optionally
fine-tune, re-run §8.6 gates before release.

---

## 9. Conclusion / analytics logic

**Team xG:** `team_xg = Σ shot.xg` (penalties contribute 0.76 each).
`diff = home_xg − away_xg`. Verdict string, comparing to actual goals `Gh, Ga`:

- `|diff| < 0.3` → "Even game on chances."
- Winner-by-xG == winner-by-score → "Deserved result."
- Winner-by-xG != winner-by-score, loser-by-score led xG by ≥ 0.75 → "Smash-and-grab / unlucky loss for {team}."
- Draw on score, `|diff| ≥ 0.75` → "{team} will feel they should have won."

**Player leaderboard (per player):** `shots`, `total_xg`, `xg_per_shot = total_xg / shots`,
`biggest_chance = max(xg)`, `goals`, `finishing_delta = goals − total_xg`.

- **Best xG player** = `argmax(total_xg)` (volume of quality created).
- **Efficiency award** = `argmax(xg_per_shot)` among players with `shots ≥ 3`.
- **Overperformer / underperformer** = extreme `finishing_delta` (min 2 shots), reported as
  context, not as model error.

**Visuals:** shot map (radius ∝ xG, colour by outcome), cumulative xG step chart per team,
per-team xG histogram.

---

## 10. Architecture

```
┌─ Phone browser (responsive web, no install) ─────────────┐
│  React + Vite, mobile portrait UI                        │
│  SVG interactive pitch (tap shot, drag GK/defenders)     │
│  Feature engineering (TypeScript, parity-tested)         │
│  onnxruntime-web → one adaptive model + 3 calibrators    │
│  Dexie / IndexedDB → matches, players, shots             │
│  Service worker (Workbox) → offline caching; site is     │
│    loaded once and keeps working pitchside               │
└──────────────────────────────────────────────────────────┘
        │ (optional, later, on wifi)
┌─ Backend (v2, optional) ─────────────────────────────────┐
│  FastAPI: /sync (upload matches), /model (latest ONNX)   │
│  Postgres or SQLite                                      │
└──────────────────────────────────────────────────────────┘
┌─ Training (offline, developer machine) ──────────────────┐
│  Python: statsbombpy, pandas, lightgbm, scikit-learn,    │
│  shap, matplotlib, skl2onnx / onnxmltools                │
│  Outputs: model.onnx, calibrators (minimal/partial/full),│
│  metrics report, feature_fixtures.json                   │
└──────────────────────────────────────────────────────────┘
```

**Tech stack (locked for v1):**
- Frontend: responsive website — React + Vite, TypeScript, Dexie, SVG (no chart lib
  dependency required; D3 scales allowed). Service worker via Workbox for offline caching
  only — no app-install / add-to-home-screen requirement.
- Inference: onnxruntime-web.
- Training: Python 3.11+, LightGBM, scikit-learn (isotonic), statsbombpy, SHAP, skl2onnx.
- No backend required to ship v1.

**Suggested repo layout:**
```
xG/
  spec.md
  process.md          # build log & learning journal, appended as work happens
  training/            # python: data pull, features, train, evaluate, export
    data/
    features.py
    train.py
    evaluate.py
    export_onnx.py
    feature_fixtures.json
  app/                 # react website
    src/
      pitch/
      features.ts      # parity port of features.py
      model/           # bundled model.onnx + calibrators + loader
      db/              # dexie schema
      report/
  models/              # released model.onnx, calibrators (minimal/partial/full), metrics.md
```

---

## 11. Non-functional requirements

- **Offline:** every core flow (setup, logging, prediction, report) works with no network.
- **Performance:** shot xG computed in < 150 ms on a mid-range phone; pitch interaction 60 fps.
- **Data safety:** all data local; explicit export before any clear. No data leaves the device
  in v1.
- **Privacy:** player names are user-entered local data; no third-party analytics in v1.
- **Licence:** StatsBomb Open Data is non-commercial — v1 is non-commercial. Revisit before
  any paid release.
- **Accessibility:** large tap targets (≥ 44 px), colour-blind-safe outcome palette,
  works one-handed portrait.

---

## 12. Roadmap

| Milestone | Contents |
|---|---|
| **M1 — Model** ✅ done | StatsBomb pull, feature engineering, logistic baseline, one adaptive LightGBM with feature-group dropout, per-bucket isotonic calibration, §8.6 gates met across completeness levels (release gate PASS), `models/model.onnx` + `feature_spec.json` + `calibrators.json` + parity fixtures. |
| **M2 — Logging app** ✅ done | `app/` (Vite + React + TS). TS port of the serve path (`src/xg/`), 340 parity tests vs `feature_fixtures.json`. Dexie/IndexedDB persistence, `setup → live → finished` lifecycle, team sheets, pitch tap + markers, quick chips, in-browser onnxruntime-web inference, live team + per-player tallies. *(Not yet clicked through in a real browser — headless tests + `vite preview` only.)* |
| **M3 — Reporting** ✅ done | End-of-match report: FT score, xG verdict string (§9), player leaderboard + best-xG/efficiency picks, SVG shot map, cumulative xG timeline, chance-quality histogram; per-shot reason string + confidence band; JSON + CSV export. Pure logic in `src/xg/{verdict,report,reason,exportMatch}.ts`, all unit-tested (356 tests total). |
| **M4 — Hardening** | Manual browser pass; trim the 27 MB onnxruntime-web bundle to the plain wasm backend; service-worker offline caching; expose the full optional-detail input set (§5.2 step 6); performance pass; real-match trial. |
| **v2** | PSxG model + goal-mouth input, retraining loop, optional sync backend, game-state feature experiment. |

---

## 13. Assumptions & open questions

**Assumptions**
- Association football, 11-a-side, standard goal; local pitches may vary and are normalised
  to 105 × 68 m at setup.
- One operator, one device, one match at a time; matches stored and reviewed later.
- Non-commercial use (StatsBomb licence).
- Operator can reasonably judge body part, situation, pressure, and rough positions of the
  keeper and 2–3 key defenders within the 25 s budget.

**Open questions**
- Minimum viable training volume per competition mix — decide after first StatsBomb pull.
- Whether `fast_break` / counter can be reliably tagged live, or should be inferred/dropped.
- Exact minute capture: manual entry vs a running match clock in the app (leaning: app clock
  with start/stop).
- v2 PSxG: goal-mouth grid resolution for the tap target.
