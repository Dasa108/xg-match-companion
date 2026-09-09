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

## Phase 1 — Model (M1)

> Not started. Entries will be appended here as work happens: environment setup, data pull,
> feature code, baseline, main model, calibration, evaluation, ONNX export.
