"""
features.py — turn one StatsBomb shot event into one model row.

This is the single most important file for model quality, and the one that MUST behave
identically in training (here) and in the browser at serve time. Keep it:
  * pure (no pandas, no IO) — just dicts and floats,
  * dependency-free (only the standard library + a tiny bit of math),
  * covered by `feature_fixtures.json` so the TypeScript port can be checked against it.

Coordinate system
-----------------
We work in **StatsBomb pitch units**: 120 long x 80 wide, the team in possession attacks
towards x = 120. Goal mouth is the segment from (120, 36) to (120, 44) — 8 units wide.
We do NOT rescale to metres: the training data is native in these units, and the only thing
that matters is that the app maps a pitch tap into the same 120x80 frame. 1 unit is very
roughly 0.9 m.

Feature groups (used for training-time dropout and completeness buckets — see spec 8.4)
-------------------------------------------------------------------------------------
  core        : always present. geometry + body part + shot type + play pattern + pressure
  freeze_frame: keeper & defender geometry (operator drops markers)
  assist      : how the chance was created (assisting pass type)
  technique   : how the ball was struck
  context     : first-time / one-on-one / follows a dribble / open goal / rebound
  pass_origin : where the assist came from
"""

from __future__ import annotations

import math
from typing import Any

# --- pitch constants (StatsBomb units) -----------------------------------
GOAL_X = 120.0
GOAL_Y = 40.0
POST_A = (120.0, 36.0)
POST_B = (120.0, 44.0)
POST_SEP = 8.0
BOX_X = 102.0          # edge of the penalty area
BOX_Y_LO, BOX_Y_HI = 18.0, 62.0
SIX_YARD_X = 114.0
SIX_YARD_Y_LO, SIX_YARD_Y_HI = 30.0, 50.0

# --- categorical vocabularies (fixed so codes are stable train<->serve) -
BODY_PARTS = ["right_foot", "left_foot", "head", "other"]
SHOT_TYPES = ["open_play", "free_kick", "corner", "kick_off"]   # penalty handled separately
PLAY_PATTERNS = [
    "regular_play", "from_corner", "from_free_kick", "from_throw_in",
    "from_counter", "from_goal_kick", "from_keeper", "from_kick_off", "other",
]
TECHNIQUES = ["normal", "volley", "half_volley", "lob", "backheel", "diving_header", "overhead_kick"]
ASSIST_TYPES = [
    "none", "through_ball", "cross", "cutback", "low_pass", "high_pass",
    "throw_in", "corner", "free_kick", "keeper_throw", "recovery",
]

FEATURE_GROUPS: dict[str, list[str]] = {
    "core": [
        "distance", "angle", "dist_x", "abs_y", "in_box", "in_six_yard",
        "body_part", "shot_type", "play_pattern", "under_pressure",
    ],
    "freeze_frame": [
        "defenders_in_cone", "nearest_def_dist", "def_within_3", "def_within_5",
        "gk_dist", "gk_dist_from_goal", "gk_lateral", "gk_in_cone", "teammates_in_box",
    ],
    "assist": ["assist_type"],
    "technique": ["technique"],
    "context": ["first_time", "follows_dribble", "one_on_one", "open_goal", "rebound"],
    "pass_origin": ["pass_origin_dist", "angle_swing"],
}

OPTIONAL_GROUPS = ["freeze_frame", "assist", "technique", "context", "pass_origin"]

FEATURE_COLUMNS: list[str] = [c for cols in FEATURE_GROUPS.values() for c in cols]
CATEGORICAL_COLUMNS: list[str] = ["body_part", "shot_type", "play_pattern", "technique", "assist_type"]
NUMERIC_COLUMNS: list[str] = [c for c in FEATURE_COLUMNS if c not in CATEGORICAL_COLUMNS]


# --- geometry helpers --------------------------------------------------------
def _dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(ax - bx, ay - by)


def _point_in_triangle(p: tuple[float, float], a: tuple[float, float],
                       b: tuple[float, float], c: tuple[float, float]) -> bool:
    """Barycentric sign test. True if p is inside triangle abc (edges count as inside)."""
    def sign(u, v, w):
        return (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1])

    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def shot_geometry(x: float, y: float) -> dict[str, float]:
    """distance + angle features from the shot location alone. Always available."""
    dist_x = GOAL_X - x
    abs_y = abs(y - GOAL_Y)
    distance = math.hypot(dist_x, y - GOAL_Y)

    a = _dist(x, y, *POST_A)
    b = _dist(x, y, *POST_B)
    # law of cosines for the angle subtended by the posts; robust vs the atan2 form
    denom = 2.0 * a * b
    if denom <= 1e-9:
        angle = 0.0
    else:
        cos_theta = (a * a + b * b - POST_SEP * POST_SEP) / denom
        cos_theta = max(-1.0, min(1.0, cos_theta))
        angle = math.acos(cos_theta)
        # if the shooter is behind the goal line the "angle" is meaningless -> 0
        if dist_x <= 0:
            angle = 0.0

    return {
        "distance": distance,
        "angle": angle,
        "dist_x": dist_x,
        "abs_y": abs_y,
        "in_box": float(x >= BOX_X and BOX_Y_LO <= y <= BOX_Y_HI),
        "in_six_yard": float(x >= SIX_YARD_X and SIX_YARD_Y_LO <= y <= SIX_YARD_Y_HI),
    }


def freeze_frame_features(x: float, y: float,
                          opponents: list[tuple[float, float]],
                          keeper: tuple[float, float] | None) -> dict[str, float]:
    """
    Defender / keeper geometry.

    `opponents` : (x, y) of opposition OUTFIELD players (exclude the keeper).
    `keeper`    : (x, y) of the opposition keeper, or None if not marked.
    """
    shot = (x, y)
    cone = (shot, POST_A, POST_B)

    if opponents:
        dists = sorted(_dist(x, y, ox, oy) for ox, oy in opponents)
        nearest = dists[0]
        within3 = float(sum(d <= 3.0 for d in dists))
        within5 = float(sum(d <= 5.0 for d in dists))
        in_cone = float(sum(_point_in_triangle((ox, oy), *cone) for ox, oy in opponents))
    else:
        nearest, within3, within5, in_cone = math.nan, math.nan, math.nan, math.nan

    if keeper is not None:
        kx, ky = keeper
        gk_dist = _dist(x, y, kx, ky)
        gk_from_goal = _dist(kx, ky, GOAL_X, GOAL_Y)
        # perpendicular distance of the keeper from the shot -> goal-centre line
        vx, vy = GOAL_X - x, GOAL_Y - y
        seg = math.hypot(vx, vy)
        gk_lateral = abs(vx * (ky - y) - vy * (kx - x)) / seg if seg > 1e-9 else 0.0
        gk_in_cone = float(_point_in_triangle((kx, ky), *cone))
    else:
        gk_dist = gk_from_goal = gk_lateral = gk_in_cone = math.nan

    return {
        "defenders_in_cone": in_cone,
        "nearest_def_dist": nearest,
        "def_within_3": within3,
        "def_within_5": within5,
        "gk_dist": gk_dist,
        "gk_dist_from_goal": gk_from_goal,
        "gk_lateral": gk_lateral,
        "gk_in_cone": gk_in_cone,
        "teammates_in_box": math.nan,   # filled by the caller (needs teammate coords)
    }


# --- StatsBomb-specific mapping --------------------------------------------
_SB_BODY = {"Right Foot": "right_foot", "Left Foot": "left_foot", "Head": "head", "Other": "other"}
_SB_SHOT_TYPE = {"Open Play": "open_play", "Free Kick": "free_kick", "Corner": "corner", "Kick Off": "kick_off"}
_SB_PLAY_PATTERN = {
    "Regular Play": "regular_play", "From Corner": "from_corner", "From Free Kick": "from_free_kick",
    "From Throw In": "from_throw_in", "From Counter": "from_counter", "From Goal Kick": "from_goal_kick",
    "From Keeper": "from_keeper", "From Kick Off": "from_kick_off", "Other": "other",
}
_SB_TECHNIQUE = {
    "Normal": "normal", "Volley": "volley", "Half Volley": "half_volley", "Lob": "lob",
    "Backheel": "backheel", "Diving Header": "diving_header", "Overhead Kick": "overhead_kick",
}


def _assist_type_from_pass(pass_obj: dict[str, Any]) -> str:
    if pass_obj.get("cut_back"):
        return "cutback"
    if pass_obj.get("cross"):
        return "cross"
    if (pass_obj.get("technique") or {}).get("name") == "Through Ball":
        return "through_ball"
    ptype = (pass_obj.get("type") or {}).get("name")
    if ptype == "Throw-in":
        return "throw_in"
    if ptype == "Corner":
        return "corner"
    if ptype == "Free Kick":
        return "free_kick"
    if ptype == "Goal Kick" or ptype == "Keeper Throw":
        return "keeper_throw"
    if ptype == "Recovery":
        return "recovery"
    height = (pass_obj.get("height") or {}).get("name")
    if height == "High Pass":
        return "high_pass"
    return "low_pass"


def build_shot_row(event: dict[str, Any],
                   key_pass: dict[str, Any] | None,
                   prev_event: dict[str, Any] | None) -> dict[str, Any] | None:
    """
    Full feature dict for one shot event (StatsBomb schema).
    Returns None for penalties (handled by a constant elsewhere) and for malformed rows.
    """
    shot = event.get("shot") or {}
    loc = event.get("location")
    if not loc or len(loc) < 2:
        return None
    sb_type = (shot.get("type") or {}).get("name")
    if sb_type == "Penalty":
        return None

    x, y = float(loc[0]), float(loc[1])
    row: dict[str, Any] = {}
    row.update(shot_geometry(x, y))

    # --- core categoricals / flags -------------------------------------
    row["body_part"] = _SB_BODY.get((shot.get("body_part") or {}).get("name"), "other")
    row["shot_type"] = _SB_SHOT_TYPE.get(sb_type, "open_play")
    row["play_pattern"] = _SB_PLAY_PATTERN.get((event.get("play_pattern") or {}).get("name"), "other")
    row["under_pressure"] = float(bool(event.get("under_pressure", False)))

    # --- freeze frame -------------------------------------------------
    ff = shot.get("freeze_frame")
    if ff:
        opponents, keeper, teammates_in_box = [], None, 0
        for p in ff:
            pl = p.get("location")
            if not pl or len(pl) < 2:
                continue
            px, py = float(pl[0]), float(pl[1])
            is_mate = bool(p.get("teammate"))
            is_gk = (p.get("position") or {}).get("name") == "Goalkeeper"
            if is_mate:
                if px >= BOX_X and BOX_Y_LO <= py <= BOX_Y_HI:
                    teammates_in_box += 1
            elif is_gk:
                keeper = (px, py)
            else:
                opponents.append((px, py))
        ffeat = freeze_frame_features(x, y, opponents, keeper)
        ffeat["teammates_in_box"] = float(teammates_in_box)
        row.update(ffeat)
    else:
        for c in FEATURE_GROUPS["freeze_frame"]:
            row[c] = math.nan

    # --- technique --------------------------------------------------
    row["technique"] = _SB_TECHNIQUE.get((shot.get("technique") or {}).get("name"), "normal")

    # --- context flags -------------------------------------------------
    row["first_time"] = float(bool(shot.get("first_time", False)))
    row["follows_dribble"] = float(bool(shot.get("follows_dribble", False)))
    row["one_on_one"] = float(bool(shot.get("one_on_one", False)))
    row["open_goal"] = float(bool(shot.get("open_goal", False)))
    prev_type = (prev_event or {}).get("type", {}).get("name")
    row["rebound"] = float(prev_type in {"Shot", "Goal Keeper"} and
                           (prev_event or {}).get("possession") == event.get("possession"))

    # --- assist + pass origin ---------------------------------------
    if key_pass is not None:
        kp = key_pass.get("pass") or {}
        row["assist_type"] = _assist_type_from_pass(kp)
        kloc = key_pass.get("location")
        if kloc and len(kloc) >= 2:
            og = shot_geometry(float(kloc[0]), float(kloc[1]))
            row["pass_origin_dist"] = og["distance"]
            row["angle_swing"] = abs(row["angle"] - og["angle"])
        else:
            row["pass_origin_dist"] = math.nan
            row["angle_swing"] = math.nan
    else:
        row["assist_type"] = "none"
        row["pass_origin_dist"] = math.nan
        row["angle_swing"] = math.nan

    # --- label + metadata (not features) ----------------------------
    row["is_goal"] = int((shot.get("outcome") or {}).get("name") == "Goal")
    row["sb_xg"] = shot.get("statsbomb_xg")
    row["shot_id"] = event.get("id")
    row["minute"] = event.get("minute")
    row["team"] = (event.get("team") or {}).get("name")
    row["player"] = (event.get("player") or {}).get("name")
    return row


def completeness_bucket(present_groups: set[str]) -> str:
    """Which calibration bucket a row falls in, given the optional groups it has."""
    has_ff = "freeze_frame" in present_groups
    has_detail = bool(present_groups & {"assist", "technique", "pass_origin"})
    n_optional = len(present_groups & set(OPTIONAL_GROUPS))
    if has_ff and has_detail:
        return "full"
    if n_optional >= 1:
        return "partial"
    return "minimal"
