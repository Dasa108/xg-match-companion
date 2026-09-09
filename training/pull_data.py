"""
pull_data.py — download the raw StatsBomb Open Data we train on.

What it does
------------
1. Fetch `competitions.json` (list of every competition/season in the open data).
2. For a chosen list of (competition, season) pairs, fetch the match list.
3. For every match, fetch its full event stream (shots live here, with freeze frames).

Everything is cached to `data/raw/` as the original JSON. Re-running skips files that
already exist, so an interrupted download just resumes.

Usage
-----
    python pull_data.py                 # default selection (~850 matches)
    python pull_data.py --extra-leagues # + three full domestic-league seasons (big)
    python pull_data.py --limit 20      # smoke test: only 20 matches
    python pull_data.py --list          # print available competitions and exit

Why a curated selection and not "everything"
--------------------------------------------
The open data is dominated by one team's domestic matches (Barcelona). Loading every
competition would bias the shot mix and cost several GB. The default set is
tournament-heavy and diverse (men/women, continents, eras) which is what we want for a
team-agnostic xG model. Add leagues later for raw volume.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from tqdm import tqdm

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
RAW = Path(__file__).parent / "data" / "raw"

# (competition_id, season_name) — season_id is resolved from competitions.json.
DEFAULT_SELECTION = [
    (43, "2018"),        # FIFA World Cup 2018
    (43, "2022"),        # FIFA World Cup 2022
    (55, "2020"),        # UEFA Euro 2020
    (55, "2024"),        # UEFA Euro 2024
    (223, "2024"),       # Copa America 2024
    (1267, "2023"),      # Africa Cup of Nations 2023
    (72, "2019"),        # Women's World Cup 2019
    (72, "2023"),        # Women's World Cup 2023
    (53, "2022"),        # UEFA Women's Euro 2022
    (53, "2025"),        # UEFA Women's Euro 2025
    (49, "2018"),        # NWSL 2018
    (49, "2023"),        # NWSL 2023
    (37, "2018/2019"),   # FA WSL 2018/19
    (37, "2019/2020"),   # FA WSL 2019/20
    (11, "2019/2020"),   # La Liga 2019/20
    (11, "2020/2021"),   # La Liga 2020/21
    (16, "2018/2019"),   # Champions League 2018/19
]

EXTRA_LEAGUES = [
    (2, "2015/2016"),    # Premier League 2015/16  (~380 matches)
    (9, "2023/2024"),    # 1. Bundesliga 2023/24   (~306 matches)
    (7, "2022/2023"),    # Ligue 1 2022/23         (~380 matches)
]


def make_session() -> requests.Session:
    """A session that retries transient failures with exponential backoff."""
    s = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=0.6,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=16))
    s.headers.update({"User-Agent": "xg-match-companion/training (educational)"})
    return s


def get_json(session: requests.Session, url: str, cache: Path) -> dict | list:
    """Return parsed JSON for `url`, using `cache` on disk if present."""
    if cache.exists():
        return json.loads(cache.read_text())
    resp = session.get(url, timeout=60)
    resp.raise_for_status()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(resp.text)
    return resp.json()


def resolve_seasons(comps: list[dict], selection: list[tuple[int, str]]) -> list[dict]:
    """Map (competition_id, season_name) -> the full competitions.json row."""
    index = {(c["competition_id"], c["season_name"]): c for c in comps}
    out = []
    for cid, sname in selection:
        row = index.get((cid, sname))
        if row is None:
            print(f"  !! not found in open data: competition {cid} season {sname!r}")
            continue
        out.append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--extra-leagues", action="store_true", help="also pull three full domestic-league seasons")
    ap.add_argument("--limit", type=int, default=0, help="cap the number of matches (smoke test)")
    ap.add_argument("--workers", type=int, default=8, help="parallel event downloads")
    ap.add_argument("--list", action="store_true", help="print available competitions and exit")
    args = ap.parse_args()

    session = make_session()

    comps = get_json(session, f"{BASE}/competitions.json", RAW / "competitions.json")

    if args.list:
        seen = set()
        for c in sorted(comps, key=lambda c: (c["competition_id"], c["season_name"])):
            key = (c["competition_id"], c["season_name"])
            if key in seen:
                continue
            seen.add(key)
            print(f'{c["competition_id"]:>5}  {c["competition_name"]:<34} {c["season_name"]:<12} '
                  f'season_id={c["season_id"]}  {c.get("competition_gender","")}')
        return 0

    selection = list(DEFAULT_SELECTION)
    if args.extra_leagues:
        selection += EXTRA_LEAGUES

    rows = resolve_seasons(comps, selection)
    print(f"Selected {len(rows)} competition-seasons:")
    for r in rows:
        print(f'  - {r["competition_name"]} {r["season_name"]}  '
              f'(comp {r["competition_id"]}, season {r["season_id"]})')

    # --- match lists -------------------------------------------------------
    match_ids: list[int] = []
    for r in rows:
        cid, sid = r["competition_id"], r["season_id"]
        matches = get_json(
            session,
            f"{BASE}/matches/{cid}/{sid}.json",
            RAW / "matches" / f"{cid}_{sid}.json",
        )
        match_ids.extend(m["match_id"] for m in matches)

    match_ids = sorted(set(match_ids))
    if args.limit:
        match_ids = match_ids[: args.limit]
    print(f"\n{len(match_ids)} unique matches to ensure locally.")

    # --- event streams (parallel, resumable) -----------------------------
    events_dir = RAW / "events"
    events_dir.mkdir(parents=True, exist_ok=True)
    todo = [mid for mid in match_ids if not (events_dir / f"{mid}.json").exists()]
    print(f"{len(match_ids) - len(todo)} already cached, {len(todo)} to download.")

    failures: list[int] = []

    def fetch(mid: int) -> tuple[int, bool]:
        try:
            get_json(session, f"{BASE}/events/{mid}.json", events_dir / f"{mid}.json")
            return mid, True
        except Exception as exc:  # noqa: BLE001 - we want to keep going
            tqdm.write(f"  fail {mid}: {exc}")
            return mid, False

    if todo:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(fetch, mid) for mid in todo]
            for fut in tqdm(as_completed(futures), total=len(futures), desc="events"):
                mid, ok = fut.result()
                if not ok:
                    failures.append(mid)

    n_events = len(list(events_dir.glob("*.json")))
    total_mb = sum(f.stat().st_size for f in events_dir.glob("*.json")) / 1e6
    print(f"\nDone. {n_events} event files on disk ({total_mb:.0f} MB).")
    if failures:
        print(f"{len(failures)} downloads failed — re-run to retry: {failures[:10]}...")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
