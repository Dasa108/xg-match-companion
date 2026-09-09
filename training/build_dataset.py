"""
build_dataset.py — walk the raw StatsBomb events and emit one tidy table of shots.

Input : data/raw/events/*.json      (full event streams, from pull_data.py)
        data/raw/matches/*.json      (match metadata)
Output: data/processed/shots.parquet

Each output row = one non-penalty shot, with:
  * the model features from features.build_shot_row(),
  * the label `is_goal`,
  * StatsBomb's own xG (`sb_xg`) kept only for evaluation/comparison,
  * match metadata (competition, season, date, teams) for splitting and reporting.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from tqdm import tqdm

import features as F

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw"
OUT = HERE / "data" / "processed" / "shots.parquet"


def load_match_meta() -> dict[int, dict]:
    """match_id -> {competition, season, date, teams, gender}."""
    meta: dict[int, dict] = {}
    for f in sorted((RAW / "matches").glob("*.json")):
        for m in json.loads(f.read_text()):
            comp = m.get("competition") or {}
            season = m.get("season") or {}
            home = m.get("home_team") or {}
            away = m.get("away_team") or {}
            meta[m["match_id"]] = {
                "competition_id": comp.get("competition_id"),
                "competition_name": comp.get("competition_name"),
                "season_id": season.get("season_id"),
                "season_name": season.get("season_name"),
                "match_date": m.get("match_date"),
                "home_team": home.get("home_team_name"),
                "away_team": away.get("away_team_name"),
                "gender": home.get("home_team_gender"),
            }
    return meta


def rows_from_match(events: list[dict]) -> list[dict]:
    """Extract feature rows for every shot in one match's event list."""
    by_id = {e["id"]: e for e in events if "id" in e}
    out = []
    for i, ev in enumerate(events):
        if (ev.get("type") or {}).get("name") != "Shot":
            continue
        shot = ev.get("shot") or {}
        key_pass = by_id.get(shot.get("key_pass_id"))
        prev_event = events[i - 1] if i > 0 else None
        row = F.build_shot_row(ev, key_pass, prev_event)
        if row is None:
            continue
        row["has_freeze_frame"] = bool(shot.get("freeze_frame"))
        row["has_key_pass"] = key_pass is not None
        out.append(row)
    return out


def main() -> None:
    meta = load_match_meta()
    event_files = sorted((RAW / "events").glob("*.json"))
    print(f"{len(event_files)} matches, {len(meta)} with metadata")

    all_rows: list[dict] = []
    for f in tqdm(event_files, desc="matches"):
        match_id = int(f.stem)
        try:
            events = json.loads(f.read_text())
        except json.JSONDecodeError:
            print(f"  skipping unreadable {f.name}")
            continue
        m = meta.get(match_id, {})
        for row in rows_from_match(events):
            row["match_id"] = match_id
            row.update(m)
            all_rows.append(row)

    df = pd.DataFrame(all_rows)

    # stable dtypes: fixed-vocabulary categoricals so train/serve codes line up
    for col, vocab in [
        ("body_part", F.BODY_PARTS), ("shot_type", F.SHOT_TYPES),
        ("play_pattern", F.PLAY_PATTERNS), ("technique", F.TECHNIQUES),
        ("assist_type", F.ASSIST_TYPES),
    ]:
        df[col] = pd.Categorical(df[col], categories=vocab)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT, index=False)

    # --- quick sanity summary ---------------------------------------
    print(f"\nwrote {OUT}  ({len(df):,} shots)")
    print(f"  goals               : {df.is_goal.sum():,}  ({df.is_goal.mean():.3f} conversion)")
    print(f"  with freeze frame   : {df.has_freeze_frame.mean():.3f}")
    print(f"  with key pass       : {df.has_key_pass.mean():.3f}")
    print(f"  competitions        : {df.competition_name.nunique()}")
    print(f"  matches             : {df.match_id.nunique()}")
    miss = df[F.NUMERIC_COLUMNS].isna().mean().sort_values(ascending=False)
    print("  top missing numeric :")
    for k, v in miss.head(6).items():
        print(f"      {k:<22} {v:.3f}")
    if df["sb_xg"].notna().any():
        # calibration-in-the-large of StatsBomb's own xG on this sample (should be ~1.0)
        s = df.dropna(subset=["sb_xg"])
        print(f"  StatsBomb xG sum/goals: {s.sb_xg.sum() / s.is_goal.sum():.3f}")


if __name__ == "__main__":
    main()
