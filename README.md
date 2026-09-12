# xG Match Companion

A mobile-first web app for one person on the sideline to log every shot in a local football
(soccer) match and get an instant **expected goals (xG)** value, fully offline, with no
server. Built as a personal, non-commercial project.

At full time it tells you which **team** created the better chances and which **player**
had the better xG — volume and efficiency — regardless of who actually scored.

**🔗 Live site: [dasa108.github.io/xg-match-companion](https://dasa108.github.io/xg-match-companion/)**
— open it once with a connection and it keeps working offline from then on (§ Tech stack).

> 📄 The full functional spec lives in [`spec.md`](spec.md) — that's the ground-truth
> source of truth for every decision. The build log / learning journal is
> [`process.md`](process.md) — a step-by-step "what / why / how" of how this was built,
> written up as it happened. New to building something like this?
> [`LEARN.md`](LEARN.md) explains the whole project in plain language, no experience
> assumed.

---

## Features

Everything below is real and shipped — not a roadmap. Grouped by what it's for.

### Logging a shot

- **Tap-to-place pitch** — the full pitch, portrait, both penalty areas, attacking upward.
  A tool row switches what a tap places: the **shot** location, the **keeper**, up to **6
  defender** markers, or a **pass** origin (for the assist).
- **Remove a marker** two ways: tap an existing defender dot to remove *that one*, or tap
  **undo** to remove whichever defender was placed *most recently* — no need to aim for a
  specific dot if you just mis-tapped.
- **Shooter attribution** — pick a side, then a player from that team's current on-pitch
  list.
- **Quick chips**, sensible defaults pre-selected: body part, situation (open play / fast
  break / corner / free kick / throw-in / penalty), pressure. A **"+ more detail"** toggle
  reveals technique, "beat a defender", open goal, and rebound for when you have time to be
  thorough.
- **Outcome**: goal / saved / off target / blocked / post.
- Only the shot location, the shooter, and the outcome are actually required — every other
  field has a default, so one shot can be logged in a few seconds or in much more depth.

### The xG model itself

- **Live xG**, computed instantly in the browser (no network call) — a LightGBM model
  trained on 34,809 real StatsBomb Open Data shots, released only after passing an explicit
  accuracy gate (see "How good is the model?" below).
- **A one-line explanation and a confidence band** with every number ("close range, tight
  angle, keeper off his line"), so the figure isn't just a black-box output.
- **Adapts to how much you actually entered** — there's no separate "quick mode" and
  "detailed mode": one model handles minimal, partial, or fully-detailed input, calibrated
  separately for each completeness level, so a rushed 5-second entry and a careful
  25-second one are each as accurate as they can be for what was actually captured.
- **Penalties** are a fixed 0.76, not modeled — deliberately, since real-world penalty
  conversion is well known and nearly context-free; a documented exception, not a hidden
  shortcut (verified: real inference for everything else, checked against the Python model
  to five decimal places).
- **Post-shot xG (PSxG) — optional.** For any shot that's on target (goal / saved / post),
  an extra "tap where it went" step on the goal frame gives a second, richer probability —
  *how good the placement was*, on top of *how good the chance was*. Skipping it changes
  nothing else about the shot.

### Running the match

- **Team sheets** at setup — starting XI + subs per side, editable any time (subs can come
  on mid-match).
- **Operator-set half length** (default 45 min) when creating the match.
- **Broadcast-style match clock** — start/pause, manual minute override, a "1st half" /
  "2nd half" tag, and automatic stoppage-time notation (`45+3′`) once a half runs past its
  scheduled length. An explicit **"2nd half →"** button moves the tag across; the clock
  itself never resets — halftime is just a pause, like any other stoppage.
- **A heads-up before ending early** — if "Full time" is tapped before the match has
  actually reached its scheduled length, a quiet note appears ahead of time and the button
  itself asks for confirmation, naming the shortfall and which half it's in. Ending early is
  still always allowed (abandoned matches happen); it's just never silent.
- **Live tallies** — running team xG and shot counts in the header, per-player running xG
  one tap away.
- **A confetti burst** whenever a goal is logged.
- **"Back to matches"** on the report screen — an explicit, clearly-labeled way back to the
  match list, plus a secondary **"reopen match"** if you need to go back and add or fix a
  shot after finishing.

### The full-time report

- **Team xG comparison** and a plain-English verdict string — who *should* have won, on
  chances, and whether that matches the scoreline.
- **Player xG leaderboard** — shots, total xG, xG/shot, best single chance, goals, and
  goals-minus-xG (finishing over/under-performance) — plus a called-out best-xG player and,
  separately, the most efficient one (xG/shot, minimum 3 shots).
- **Shot map, cumulative xG timeline, and a shot-quality histogram**, all inline SVG (no
  charting library).
- **Colour-blind-safe outcomes** — every shot outcome has its own shape *and* colour (★
  goal, ● saved, ◆ post, ▲ blocked, ○ off target), so identity is never colour-alone. The
  whole categorical palette (team identity / value judgement / outcome status, kept as
  three separate colour roles on purpose) was checked with an automated OKLab contrast and
  colour-blindness separation tool, not eyeballed.
- **Three export formats**, no server involved:
  - **Full report** — a single self-contained HTML file (score, verdict, timeline, shot
    map, full leaderboard, every shot's full data) that opens straight from disk with no
    internet, and prints / "Save as PDF" cleanly.
  - **JSON** — the same data, machine-readable (`xg-match-companion/v1` schema).
  - **CSV** — one row per shot, for your own spreadsheet analysis.

### Works with no signal, and knows when it might be stale

- **Fully offline** once loaded once — a service worker precaches the whole app, including
  both ML models, so every core flow (logging, prediction, the report, export) keeps
  working with zero connectivity.
- **Updates itself automatically** — when a new version is deployed, it activates and
  reloads on its own next time you're online. No manual "reload to update" step.
- **A passive offline flag** — since auto-update can't check for anything without a
  connection, a quiet note ("Offline — may not be the latest version.") appears whenever
  you're disconnected, and disappears the moment you're back online. Nothing to act on,
  just an honest fact about right now.
- **An opt-out**, for the rare case you'd rather always fetch fresh than ever risk a stale
  cache: a toggle on the match list turns offline caching off entirely (every load then
  needs a connection) or back on.

### Design

- **A validated dark "sports broadcast" theme** — bold tabular numerals on the hero
  moments (scoreboard, live xG), a categorical colour palette computed and checked (not
  chosen by eye) so team identity, value judgement, and shot-outcome status never collide.
- **A hand-rolled icon set** — no emoji, no icon webfont, so the app stays fully offline-safe
  with no font-loading step.
- **Original ambient background art** — grain texture, a football line-art watermark, soft
  colour blooms, and a hand-built anime-style illustration (a ball bursting through a
  cel-shaded splash) — all original vector work, not stock imagery, specifically so nothing
  shipped carries a licence question.
- **Screen transitions** and consistent card/heading treatment across every screen.

### Privacy

- **Everything stays on your device** — IndexedDB storage, no accounts, no analytics, no
  data ever leaves it except a deliberate export you download yourself.
- **Deleting a match** asks for confirmation first.

---

## Why it exists

Rather than eyeballing "that was a good chance," this logs shots as they happen and turns
them into a real number, trained on real match data (StatsBomb's Open Data — 34,809 shots
across 1,374 matches, 13 competitions), instead of a rule-of-thumb or a generic model. It's
built for **one operator, one device, one match at a time** — not a scouting platform, not
a multi-user tool. That constraint is deliberate: it's what let this ship as a plain
website with no backend, no accounts, and no data ever leaving your device.

---

## Tech stack

| Layer | What |
|---|---|
| Frontend | React + TypeScript + Vite, mobile-first, SVG (no chart library) |
| Inference | `onnxruntime-web` (wasm-only build), running the model client-side |
| Storage | Dexie / IndexedDB — all data stays on your device |
| Offline | Workbox service worker — precaches the app + both ONNX models |
| Model training | Python — LightGBM, scikit-learn (isotonic calibration), StatsBomb Open Data, exported to ONNX |

No backend. No accounts. No analytics. Nothing leaves the device — the only way data
leaves is an export you explicitly download.

---

## Running it locally

Requires Node 18+.

```bash
cd app
npm install
npm run dev       # dev server at http://localhost:5173
```

Other useful commands (run from `app/`):

```bash
npm test          # 593 tests — feature/model parity, verdict logic, DB lifecycle, report HTML
npm run build     # typecheck + production build (also runs the test-fixture sync)
npm run preview   # serve the production build locally, incl. the offline service worker
```

`npm run build`/`dev`/`test` all run `scripts/sync-assets.mjs` first, which copies the
released model files from `models/` and `training/` into `app/` — the app never reads
those directories directly at runtime, so it stays a normal static site once built.

Retraining the model itself is a separate Python pipeline under `training/` (pull data →
build features → train → evaluate → export to ONNX) — see `training/` and `spec.md` §8 for
the full methodology if you want to reproduce or extend it.

### Deployment

The live site is a plain static build, deployed to GitHub Pages. `.github/workflows/
deploy-pages.yml` builds `app/` and publishes `app/dist` on every push to `m1-model` that
touches the app (or a manual run from the Actions tab) — no separate hosting account
needed. Because a GitHub Pages project site is served from a `/xg-match-companion/`
subpath rather than root, `vite.config.ts` sets `base` to that subpath for production
builds only; local `dev`/`preview` stay at `/`.

---

## How good is the model?

Evaluated on a 15%, match-level held-out test set (4,988 shots, 197 matches — no match
straddles train/test):

| | log loss | AUC | correlation vs StatsBomb's own xG |
|---|---|---|---|
| Pre-shot xG (full detail entered) | 0.263 | 0.805 | 0.90 |
| Post-shot xG, on-target shots (full detail) | 0.372 | 0.879 | — |

Both beat their respective baselines (a geometry-only logistic model for pre-shot; the
pre-shot model itself, recalibrated, for post-shot) at every completeness level (minimal /
partial / full detail entered), and both passed their release gate. Full numbers in
`models/metrics.md` and `models/psxg_metrics.md`.

---

## Project layout

```
xG/
  spec.md                 # ground-truth functional spec — read this first
  process.md              # build log / learning journal (detailed, technical)
  LEARN.md                 # the same story, explained simply — start here if you're new
  training/                # Python: data pull → features → train → evaluate → export ONNX
  models/                  # released model.onnx + psxg_model.onnx, calibrators, metrics
  app/                     # the website (React + Vite + TS)
    src/
      pitch/               # pitch SVG, goal-mouth (PSxG) widget, shared markings
      xg/                  # feature engineering, model loading, verdict/report logic
      db/                  # Dexie schema + match lifecycle
      screens/             # MatchList → Setup → Live → Report
      components/          # ShotEntry, Charts, Icon, Confetti, etc.
```

---

## Status

All of M1 (model) → M4 (hardening) plus the originally-deferred PSxG and full-report
features are done and browser-verified. Remaining known gaps (see `spec.md` §12/§13):

- No real-match field trial yet (everything has been verified manually, not across a
  full live game pitchside).
- `fast_break` / counter-attack tagging is untested with a real operator under time
  pressure.
- Optional pitch-size calibration (for non-standard local pitches) is spec'd but not built.

## Data & licensing

- Training data is [StatsBomb Open Data](https://github.com/statsbomb/open-data), used
  under their non-commercial licence — this project is non-commercial. The raw data itself
  isn't in this repo (re-downloaded via `training/pull_data.py`); only code and the models
  trained from it are.
- All visual/decorative art (icons, pitch markings, the ambient background illustration)
  is original, hand-built work — no third-party image assets are shipped.
