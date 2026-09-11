"""
build_psxg_dataset.py — the on-target subset of shots, with a goal-mouth placement.

Reuses the raw events already pulled by pull_data.py (no new download). For every shot
that reached the frame (`shot.end_location` has a height component and the outcome is one
StatsBomb records a frame position for), builds the full PSxG feature row: every pre-shot
feature (via features.event_to_input / features_from_input, unchanged) plus the goalmouth
placement group (psxg_features.goalmouth_features).

Output: data/processed/psxg_shots.parquet
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from tqdm import tqdm

import features as F
import psxg_features as P
from build_dataset import load_match_meta

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw"
OUT = HERE / "data" / "processed" / "psxg_shots.parquet"


def rows_from_match(events: list[dict]) -> list[dict]:
    by_id = {e["id"]: e for e in events if "id" in e}
    out = []
    for i, ev in enumerate(events):
        if (ev.get("type") or {}).get("name") != "Shot":
            continue
        shot = ev.get("shot") or {}
        outcome = (shot.get("outcome") or {}).get("name")
        end_loc = shot.get("end_location")
        if outcome not in P.ON_TARGET_OUTCOMES or not end_loc or len(end_loc) != 3:
            continue

        key_pass = by_id.get(shot.get("key_pass_id"))
        prev_event = events[i - 1] if i > 0 else None
        inp = F.event_to_input(ev, key_pass, prev_event)
        if inp is None:  # penalty or malformed — excluded, same as the pre-shot dataset
            continue

        gm_y, gm_z = float(end_loc[1]), float(end_loc[2])
        row = P.psxg_row_from_input(inp, gm_y, gm_z)
        row["is_goal"] = int(outcome == "Goal")
        row["sb_outcome"] = outcome
        row["shot_id"] = ev.get("id")
        row["minute"] = ev.get("minute")
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
            continue
        m = meta.get(match_id, {})
        for row in rows_from_match(events):
            row["match_id"] = match_id
            row.update(m)
            all_rows.append(row)

    df = pd.DataFrame(all_rows)
    for col, vocab in [
        ("body_part", F.BODY_PARTS), ("shot_type", F.SHOT_TYPES),
        ("play_pattern", F.PLAY_PATTERNS), ("technique", F.TECHNIQUES),
        ("assist_type", F.ASSIST_TYPES),
    ]:
        df[col] = pd.Categorical(df[col], categories=vocab)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT, index=False)

    print(f"\nwrote {OUT}  ({len(df):,} on-target shots)")
    print(f"  goals (conversion)  : {df.is_goal.sum():,}  ({df.is_goal.mean():.3f})")
    print(f"  by outcome          :\n{df.sb_outcome.value_counts().to_string()}")
    print(f"  matches             : {df.match_id.nunique()}")
    print(f"  gm_z range          : {df.gm_z.min():.2f} .. {df.gm_z.max():.2f}")
    print(f"  gm_far_post rate    : {df.gm_far_post.mean():.3f}")


if __name__ == "__main__":
    main()
