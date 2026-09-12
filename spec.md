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
- **Post-shot xG (PSxG) — optional, no server** (§8.9): after logging a shot that's on
  target (goal / saved / post), the operator may *optionally* tap where it crossed the
  line for a second, richer probability. Never required — the shot saves and the report
  works identically with or without it.
- Live per-team and per-player xG tallies.
- End-of-match report: team xG comparison + verdict, player xG leaderboard,
  shot map, cumulative xG timeline, finishing over/under-performance, PSxG where placed.
- Local persistence of all matches; export as a downloadable full HTML report, JSON, or CSV.

### Deferred (v2+)
- Multi-device / multi-operator sync during a match.
- Cloud accounts, cross-device history sync.
- Automatic retraining pipeline from logged matches.
- SHAP-based per-shot attribution and calibrated prediction intervals (the current reason
  string and confidence band are rule-of-thumb — §5.2 step 8).
- Game-state features (minute, scoreline) as a modelling experiment.

These are the v2 ideas that *do* need a server (multi-device sync, cloud accounts,
retraining from many operators' matches) — see §8.8. PSxG didn't, so it moved up to v1.

### Out of scope
- Live video ingestion or automated tracking.
- Non-football sports.
- Betting / odds features.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **xG** | Pre-shot expected goals: probability a shot is scored, given only information available *before* the ball is struck. Shooter-agnostic. |
| **PSxG** | Post-shot xG: probability of a goal given also where the shot crossed the goal line. A separate, optional model (§8.9) — never affects the pre-shot xG number. |
| **Goal-mouth placement** | The (y, z) point — across the goal, height off the ground — where an on-target shot reached the frame. The only PSxG-specific input. |
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
- Create match: date, competition/label, venue (free text), home team name, away team name,
  **half length in minutes** (default 45, operator-editable per match — a youth/5-a-side
  game rarely runs full 45s). Drives the running clock's half/stoppage-time display (§5.3);
  it does not gate or reset the clock itself.
- Enter both team sheets: player name + shirt number + starting/sub flag. Editable mid-match
  (subs). Minimum 1 player per team to start; full XI recommended.
- Optional pitch-size calibration (local pitches vary): operator can set actual length/width;
  clicks are normalised to a standard 105 × 68 m pitch before feature computation. Default =
  standard size.

### 5.2 In-match shot entry flow
1. Operator taps **"New shot"**.
2. **Pitch view** — **as built: the whole pitch**, drawn portrait (both boxes, both D
   arcs, halfway line, centre circle) with the team in possession attacking **upward**.
   Tool row = shot / keeper / defender / pass. Operator taps the shot location; then
   switches tool to drop the keeper, defenders, or the pass origin. Capped at 64vh so it
   doesn't swallow a phone screen. (`app/src/pitch/`.)
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
6. **Optional detail** — as built: `assist type` (none / cross / through ball / cutback /
   low pass / high pass) and `first-time` / `one-on-one` are always visible; a
   **"+ more detail"** toggle reveals `technique` (normal / volley / half-volley / lob /
   overhead), `beat a defender`, `open goal`, `rebound`, and a hint to use the **pass**
   tool for the assist origin. `keeper state` is not a separate model input — the GK
   marker position carries it.
7. **Outcome**: `goal` / `saved` / `off target` / `blocked` / `post`. (Used for reporting and
   future retraining, **not** for the pre-shot xG computation.)
8. Save. xG is computed instantly and shown with a one-line reason
   ("close range, tight angle, keeper off his line") and a confidence band whose width
   reflects the shot's completeness bucket (§8.4).
   *(As built: the reason is a rule-of-thumb read of the feature values, not SHAP —
   `app/src/xg/reason.ts`. The band widths (±0.025 / ±0.04 / ±0.06 for full / partial /
   minimal) are illustrative of the measured bucket accuracy gap, not calibrated intervals.
   True per-shot attribution + prediction intervals are a v2 item.)*
9. **PSxG (optional — §8.9).** If the outcome is `goal`, `saved`, or `post`, a
   **"+ tap where it went"** control appears below the outcome chips. Tapping it opens a
   small goal-mouth diagram (face-on: across the goal × height); the operator taps where
   the ball crossed the line. A second, PSxG-specific probability is computed instantly
   and shown alongside the pre-shot xG. Skipping this is always fine — the shot saves
   identically either way, and PSxG is simply absent from that shot's data.

Every field except shot location, shooter, and outcome has a default and may be left untouched.

### 5.3 Live tallies
- Header shows running **team xG** (home vs away) and shot counts.
- Per-player running xG accessible in one tap.
- **Match clock**, broadcast-style: start/pause, manual minute override, and a half tag
  ("1st half" / "2nd half"). Once elapsed minutes pass the current half's target (half
  length, or double it in the 2nd half) the label switches to stoppage-time notation
  (`45+3′`), same convention as a TV broadcast. An explicit **"2nd half →"** action (only
  shown during the 1st half) flips the tag and resumes the clock if it was paused for
  the break — the clock is always one continuous accumulator; halftime is just a pause
  like any other, so no time is lost or double-counted crossing into the 2nd half.

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
- **Export**, all delivered as a browser download (plain `Blob` + anchor; the app is the
  user's own) — three formats (`app/src/xg/{exportMatch,reportHtml}.ts`):
  - **Full report (`<date>_<home>-v-<away>_report.html`)** — the primary "give me
    everything" download: a single self-contained HTML file with the FT score + verdict,
    the xG timeline and shot map (inline SVG, no library, no external assets), the player
    leaderboard (with a PSxG column when any shot has one), and a complete row-per-shot
    table covering every field collected (minute, team, player, location, situation, body
    part, pressure, completeness bucket, xG, outcome, PSxG). Opens straight from disk with
    no server, and prints / "Save as PDF" cleanly (a `@media print` fallback is included).
  - `<...>.json` — `{schema:"xg-match-companion/v1", match, summary (team aggs +
    verdict), players, leaderboard, shots}` — the same data as machine-readable JSON.
  - `<...>_shots.csv` — one row per shot: match, date, minute, side, team, number, player,
    x, y, shot_type, body_part, under_pressure, bucket, xg, raw, outcome, is_goal, psxg,
    psxg_raw, psxg_bucket, goalmouth_y, goalmouth_z.

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
| `goalmouth_yz` | point | goal-frame coords (y across, z height) | ✗ | PSxG only (§8.9) |

**Completeness buckets** (for calibration + confidence, §8.4): `minimal` = core only ·
`partial` = core + at least one optional group · `full` = core + `freeze-frame` + at least
one of `assist` / `technique` / `pass-origin`. PSxG (§8.9) reuses the same three buckets
for its pre-shot half and layers `goalmouth_yz` on top — that group is never optional
*within* a PSxG prediction (it's the reason one was requested) but the shot itself always
saves whether or not the operator ever opens the placement tool.

---

## 7. Data model

```
Match      { id, date, label, venue, home_team_id, away_team_id, pitch_len_m, pitch_wid_m,
             half_length_min, current_half(1|2), created_at, status(setup|live|finished) }
Team       { id, match_id, name, side(home|away) }
Player     { id, team_id, name, number, role(start|sub), on_pitch(bool) }
Shot       { id, match_id, team_id, player_id, minute, inputs(JSON per §6),
             features(JSON, computed), completeness(minimal|partial|full), xg(float),
             reason(string), outcome, created_at,
             goalmouth(point?), psxg(float?), psxg_bucket(minimal|partial|full ?) }
```

- Storage: **IndexedDB** on device (Dexie). One DB, all matches. No server required for v1.
- `features` is persisted so predictions are reproducible and auditable offline.
- `inputs` stores raw operator entries verbatim (for retraining later).
- The four PSxG fields are all optional and `null`/absent on every shot until the operator
  taps a placement (§8.9) — the schema needed no migration to add them.
- **As built (`app/src/db/schema.ts`):** `Team` is folded into `Match`
  (`homeName`/`awayName`) since there are always exactly two, identified by a `side` enum
  on `Player` and `Shot`. `Shot` also stores `bucket` and `raw` (uncalibrated model
  output), and `psxgRaw` alongside `psxg`. The match clock is `{clockStartedAt,
  clockAccumMs}` — elapsed is recomputed, never ticked in storage. `halfLengthMin`
  (operator-set at creation, default 45) and `currentHalf` (1|2, flipped by an explicit
  `startSecondHalf()` action) drive `clockDisplay()`, a pure function deriving the
  broadcast-style label/stoppage-time flag from elapsed minutes — no separate timer state,
  both fields added with no Dexie migration (schemaless beyond the declared indexes, same
  as the PSxG fields before them). Delete cascades match → players → shots in one
  transaction.

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
fine-tune, re-run §8.6 gates before release. Needs a server to collect shots from more
than one device — deferred (§2).

### 8.9 Post-shot xG (PSxG) — optional, v1

Doesn't need a server (unlike §8.8), so it shipped in v1 as an **optional** second model:
"given this shot reached the frame with this placement, how likely was it to beat the
keeper?" Entirely separate from the pre-shot model — a shot's xG is never touched by
whether or when PSxG is added.

**Why it needed its own model, not a feature bolted onto the first.** Placement is only
known *after* the ball is struck; feeding it into the pre-shot model would silently turn
"pre-shot xG" into something that peeks at the outcome (exactly the leak §8.3's exclusion
table warns about). Kept as a second ONNX model + its own feature module
(`training/psxg_features.py` / `app/src/xg/psxgFeatures.ts`) that *builds on* the pre-shot
`features_from_input`, so the two can never accidentally merge.

**Training data.** On-target StatsBomb shots only — outcomes `Goal`, `Saved`, `Post`,
`Saved Off Target`, `Saved to Post` (the ones with a recorded 3D `end_location`).
12,423 shots, 26.9% conversion (goals | on target — much higher than the ~9.6% base rate,
as expected once you condition on "reached the frame"). Penalties excluded, same as the
pre-shot dataset.

**Goal-mouth placement features** (`GOALMOUTH_COLUMNS`), from the (y, z) point where the
shot crossed/hit the frame (goal frame: `y` 36–44, `z` 0–2.67 crossbar, StatsBomb units):
`gm_abs_dy` (distance from the centre line), `gm_z` (height), `gm_dist_post` (distance to
the nearer post), `gm_dist_bar` (distance to the crossbar), `gm_far_post` (placed on the
opposite side from where the shot was taken — harder for a keeper set near-post),
`gm_corner_dist` (distance to the nearest of the four frame corners). Monotone
constraints: xG↓ as `gm_dist_post`/`gm_corner_dist` grow (more central = easier save),
xG↑ with `gm_abs_dy`/`gm_far_post` (further from centre / far-post = harder).

**Model.** Same machinery as §8.5: LightGBM, the pre-shot completeness buckets
(minimal/partial/full) reused for whichever pre-shot detail that shot happened to have,
per-bucket isotonic calibration, match-level split. Input = pre-shot `MODEL_FEATURES` (58)
+ the 6 goalmouth columns = 64 features.

**Baseline & release gate.** The baseline isn't a logistic regression here — it's the
**pre-shot xG model's own prediction, re-calibrated for the on-target population** —
which isolates the question PSxG exists to answer: does knowing *where* it went beat
knowing only the situation it was taken in?

**Result (2026-09-11) — release gate PASS ✅.** Held-out test (1,753 on-target shots):

| bucket | log loss | AUC | vs pre-shot-only baseline |
|---|---|---|---|
| full | 0.372 | 0.879 | baseline: log loss 0.507, AUC 0.772 |
| partial | 0.378 | 0.876 | beats baseline |
| minimal | 0.409 | 0.858 | beats baseline |

Placement dominates: even at `minimal` pre-shot detail, adding *where it went* cuts log
loss by nearly a quarter and lifts AUC by ~9 points over the pre-shot model alone — the
expected result, and the reason PSxG is worth the extra tap. Full report:
`models/psxg_metrics.md`.

**Serving.** `models/psxg_model.onnx` (755 KB) + `psxg_feature_spec.json` +
`psxg_calibrators.json`, same ONNX/parity-fixture discipline as §8.7
(`training/psxg_feature_fixtures.json`, `check_psxg_fixtures.py`). App-side:
`app/src/xg/psxgFeatures.ts` + `psxgModel.ts`, lazy-loaded like the pre-shot model and
sharing the same `onnxruntime-web/wasm` chunk (no extra wasm download, just the extra
755 KB `.onnx`). UI: `pitch/GoalFrame.tsx`, a small face-on goal-mouth tap diagram, shown
only once the outcome is `goal`/`saved`/`post` (§5.2 step 9).

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

**PSxG (when any shot has one):** `team_psxg = Σ psxg` over shots with a placement
(`null` if none were placed — never backfilled or estimated). Shown alongside team xG, and
as an extra player-table column, but does **not** feed the xG verdict string above — it's
a separate, optional read, not a replacement for it.

---

## 10. Architecture

```
┌─ Phone browser (responsive web, no install) ─────────────┐
│  React + Vite, mobile portrait UI                        │
│  SVG interactive pitch (tap shot, drag GK/defenders)     │
│  SVG goal-mouth diagram (optional PSxG placement tap)    │
│  Feature engineering (TypeScript, parity-tested)         │
│  onnxruntime-web → xG model + 3 calibrators              │
│                   → PSxG model + 3 calibrators (optional)│
│  Dexie / IndexedDB → matches, players, shots              │
│  Service worker (Workbox) → offline caching; site is     │
│    loaded once and keeps working pitchside                │
│  Full report / JSON / CSV export → browser download      │
└──────────────────────────────────────────────────────────┘
        │ (optional, later, on wifi)
┌─ Backend (v2, optional) ─────────────────────────────────┐
│  FastAPI: /sync (upload matches), /model (latest ONNX)   │
│  Postgres or SQLite                                      │
└──────────────────────────────────────────────────────────┘
┌─ Training (offline, developer machine) ──────────────────┐
│  Python: statsbombpy, pandas, lightgbm, scikit-learn,    │
│  shap, matplotlib, skl2onnx / onnxmltools                │
│  Outputs: model.onnx + psxg_model.onnx, calibrators       │
│  (minimal/partial/full, ×2), metrics reports,             │
│  feature_fixtures.json + psxg_feature_fixtures.json       │
└──────────────────────────────────────────────────────────┘
```

**Tech stack (locked for v1):**
- Frontend: responsive website — React + Vite, TypeScript, Dexie, SVG (no chart lib
  dependency required; D3 scales allowed). Service worker via Workbox for offline caching
  only — no app-install / add-to-home-screen requirement. No icon font/webfont
  dependency either — a small hand-rolled stroke-icon set (`components/Icon.tsx`) keeps
  the app fully offline-safe with no font-loading step.
- Inference: onnxruntime-web (wasm-only entry, lazy-loaded — §10 note below).
- Training: Python 3.11+, LightGBM, scikit-learn (isotonic), statsbombpy, SHAP, skl2onnx.
- No backend required to ship v1 — PSxG (§8.9) confirmed this holds even with a second
  model, since it's just another ONNX file served the same way.

**As built:** `onnxruntime-web` defaults to an all-backends "jsep" build (~28 MB wasm).
The app imports `onnxruntime-web/wasm` instead (wasm-only, ~14 MB) via a **dynamic**
`import()` inside the model-loading function — not a top-level import — so it code-splits
into its own chunk and the match-list/setup screens never pay for it. Both the xG and
PSxG models import the identical specifier, so the bundler dedupes them into one shared
chunk: loading PSxG after xG costs only the extra ~755 KB `.onnx`, not another wasm
download. `ort.env.wasm.numThreads = 1` — the threaded build needs
`SharedArrayBuffer`/cross-origin isolation this app doesn't set up, and hangs instead of
falling back cleanly if you skip this.

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
      pitch/           # Pitch, GoalFrame (PSxG), shared SVG markings
      xg/              # features.ts + encode.ts (parity ports) + psxgFeatures.ts,
                       # model.ts + psxgModel.ts (loaders), reason.ts, verdict.ts,
                       # report.ts, exportMatch.ts, reportHtml.ts
      db/              # dexie schema
      screens/         # MatchList, Setup, Live, Report
  models/              # released model.onnx + psxg_model.onnx, calibrators (×2,
                       # minimal/partial/full), metrics.md + psxg_metrics.md
```

---

## 11. Non-functional requirements

- **Offline:** every core flow (setup, logging, prediction, report, PSxG, export) works
  with no network, once the service worker has cached the app (13 precache entries,
  ~15.2 MB total incl. both models — one-time download the first time the site loads).
- **Performance:** shot xG computed in < 150 ms on a mid-range phone; pitch interaction 60 fps.
  PSxG is lazy — its extra ~755 KB model only downloads if the operator opens the
  placement tool, and its wasm runtime is already warm from the xG model by then.
- **Data safety:** all data local; explicit export (full report / JSON / CSV) before any
  clear. No data leaves the device in v1.
- **Privacy:** player names are user-entered local data; no third-party analytics in v1.
- **Licence:** StatsBomb Open Data is non-commercial — v1 is non-commercial. Revisit before
  any paid release. The ambient background art is all original, hand-built vector work (an
  anime-style ball/splash emblem alongside the earlier grain/watermark/gradients, process.md
  6.14) rather than a third-party photo — a copyrighted stock photo was tried first and
  dropped specifically to avoid a licence question the app didn't need to carry.
- **Accessibility:** large tap targets (≥ 44 px), works one-handed portrait.
  **Colour-blind-safe outcome palette — done:** shot outcomes are never color-alone —
  each has its own shape (★ goal, ● saved, ◆ post, ▲ blocked, ○ off target) *and* a
  validated color (`app/src/pitch/outcomeMarker.ts`). Team identity (home/away),
  value-judgement (pos/neg), and outcome-status use three separate color pairs/sets, each
  run through the dataviz-skill validator (OKLab ΔE ≥ 8 CVD separation, ≥ 15 normal-vision,
  ≥ 3:1 contrast, all in the app's actual dark surface) rather than eyeballed — see
  process.md for the numbers. The one accepted WARN (pos↔neg CVD ΔE 7.4) is covered by the
  existing `+`/`−` sign as secondary encoding.

---

## 12. Roadmap

| Milestone | Contents |
|---|---|
| **M1 — Model** ✅ done | StatsBomb pull, feature engineering, logistic baseline, one adaptive LightGBM with feature-group dropout, per-bucket isotonic calibration, §8.6 gates met across completeness levels (release gate PASS), `models/model.onnx` + `feature_spec.json` + `calibrators.json` + parity fixtures. |
| **M2 — Logging app** ✅ done | `app/` (Vite + React + TS). TS port of the serve path (`src/xg/`), 340 parity tests vs `feature_fixtures.json`. Dexie/IndexedDB persistence, `setup → live → finished` lifecycle, team sheets, pitch tap + markers, quick chips, in-browser onnxruntime-web inference, live team + per-player tallies. Full flow verified in-browser during M4. |
| **M3 — Reporting** ✅ done | End-of-match report: FT score, xG verdict string (§9), player leaderboard + best-xG/efficiency picks, SVG shot map, cumulative xG timeline, chance-quality histogram; per-shot reason string + confidence band; JSON + CSV export. Pure logic in `src/xg/{verdict,report,reason,exportMatch}.ts`, all unit-tested (356 tests total). |
| **M4 — Hardening** 🚧 | ✅ manual browser pass (2 runtime bugs found+fixed); ✅ full pitch shown (portrait, both halves); ✅ onnxruntime-web trimmed to the wasm entry (28→14 MB wasm, 414→73 KB glue) + lazy-loaded; ✅ Workbox service worker precaches shell + both models + wasm for full offline; ✅ full optional-detail inputs + pass-origin tool. **Remaining:** performance pass, real-match trial. |
| **PSxG + full report** ✅ done | Moved up from "v2" — neither needed a server. §8.9: second model (on-target shots, goal-mouth placement, own ONNX + calibrators + parity fixtures), release gate PASS, optional goal-mouth tap in `ShotEntry`. §5.4: downloadable self-contained HTML match report (`reportHtml.ts`) with every shot's full data. 587 tests total. |
| **Visual polish + match clock** ✅ done | Sports-broadcast redesign: validated categorical palette (team/value/outcome colours kept separate), hand-rolled icon set, shape+colour dual-encoded shot outcomes, ambient "chrome" (grain, pitch watermark, colour blooms, an original hand-built anime-style ball/splash emblem — process.md 6.13/6.14), a confetti burst on `goal`. §5.1/§5.3: operator-set half length + a broadcast-style clock (half tag, stoppage-time label, explicit "2nd half →"). 589 tests total. |
| **v2 (needs a server, §2)** | Multi-device/operator sync, cloud accounts + cross-device history, automatic retraining pipeline from many operators' matches, SHAP attribution + calibrated intervals, game-state feature experiment. |

---

## 13. Assumptions & open questions

**Assumptions**
- Association football, 11-a-side, standard goal. As built, geometry stays in native
  StatsBomb 120×80 units (§8.2) rather than rescaling to metres; pitch-size calibration
  (§5.1) is spec'd but not yet built — local pitches are currently assumed standard-size.
- One operator, one device, one match at a time; matches stored and reviewed later.
- Non-commercial use (StatsBomb licence).
- Operator can reasonably judge body part, situation, pressure, and rough positions of the
  keeper and 2–3 key defenders within the 25 s budget.

**Open questions**
- Minimum viable training volume per competition mix — **resolved**: 34,809 shots / 1,374
  matches / 13 competitions passed the M1 release gate; no need for more unless a future
  metric regresses.
- Whether `fast_break` / counter can be reliably tagged live, or should be inferred/dropped
  — still open, untested with a real operator.
- Exact minute capture: manual entry vs a running match clock in the app — **resolved**:
  app clock with start/pause (§7 `clockStartedAt`/`clockAccumMs`), plus manual override.
  Half length is operator-set per match (default 45 min, §5.1); the clock itself stays a
  single continuous accumulator across both halves (halftime is just a pause), and
  `clockDisplay()` derives the 1st/2nd-half tag and stoppage-time label from it — no
  separate "half" timer to keep in sync.
- Goal-mouth tap resolution for PSxG — **resolved**: a free continuous tap on the goal
  diagram (`GoalFrame.tsx`), not a discrete grid; clamped to a small margin around the
  frame so near-post/wide/over taps still register a placement.
- Whether PSxG should also accept off-target placement (to rate *how close* a miss was) —
  not built; PSxG is currently offered only for `goal`/`saved`/`post` outcomes, matching
  how the training data is defined (§8.9).
