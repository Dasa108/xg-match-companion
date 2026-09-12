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
> written up as it happened.

---

## What it does

**Log a shot in a few taps.** Tap the pitch where the shot was taken (drawn full, portrait,
attacking upward), optionally drop the keeper and up to 6 defender markers, pick the
shooter, and tap a few quick chips (body part, situation, pressure). Everything except
location, shooter, and outcome has a sensible default — a shot can be logged in seconds, or
in much more detail if you have time.

- **Live xG**, computed instantly in the browser (no network needed) — a LightGBM model
  trained on 34,809 real StatsBomb Open Data shots, with an instant one-line explanation
  ("close range, tight angle, keeper off his line") and a confidence band.
- **Adapts to how much you actually enter.** There's no fixed "quick mode / detailed mode"
  — one model handles minimal, partial, or fully-detailed input and is calibrated
  separately for each completeness level, so a rushed 5-second entry and a careful 25-second
  one are each as accurate as they can be for what was captured.
- **Post-shot xG (PSxG) — optional.** For any shot that's on target (goal / saved / post),
  you can tap where the ball crossed the goal line for a second, richer probability
  ("how good was the placement," not just "how good was the chance"). Entirely optional —
  skipping it changes nothing else.
- **Match clock**, broadcast-style: start/pause, manual override, and a half tag ("1st
  half" / "2nd half"). You set each half's length when creating the match (default 45 min);
  once a half runs past that, the clock switches to stoppage-time notation (`45+3′`), and
  an explicit "2nd half →" button moves it into the second half.
- **Live tallies** — running team xG and per-player xG, one tap away, throughout the match.

**At full time, a complete report:**
- Team xG comparison + a plain-English verdict string (who *should* have won, on chances).
- Player xG leaderboard — shots, total xG, xG/shot, best single chance, goals, and
  goals-minus-xG (finishing over/under-performance).
- Shot map, cumulative xG timeline, and a shot-quality histogram, all inline SVG.
- Shot outcomes are colour **and** shape coded (★ goal, ● saved, ◆ post, ▲ blocked,
  ○ off target) so it's never colour-alone — checked against colour-blindness with an
  automated contrast/separation validator, not eyeballed.
- A confetti burst whenever a goal is logged.

**Take your data with you** — three export formats, no server involved:
- **Full report** — a single self-contained HTML file (score, verdict, timeline, shot map,
  full leaderboard, every shot's full data) that opens straight from disk, no internet
  needed, and prints / "Save as PDF" cleanly.
- **JSON** — the same data, machine-readable.
- **CSV** — one row per shot, for your own spreadsheet analysis.

**Works with no signal.** Once you've loaded the site once, a service worker caches
everything — the app shell and both ML models — so it keeps working with zero connectivity,
which is the actual condition on most sidelines.

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
npm test          # 589 tests — feature/model parity, verdict logic, DB lifecycle, report HTML
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
  process.md              # build log / learning journal
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
