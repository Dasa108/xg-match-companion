"""
psxg_features.py — post-shot xG (PSxG): "given this shot reached the goal frame with this
placement, how likely was it to beat the keeper?"

Builds on the pre-shot feature module (features.py / encode.py) rather than duplicating it:
a PSxG row is every pre-shot feature (same geometry, same completeness groups, same
dropout/jitter story for training) PLUS a `goalmouth` group describing where the shot
crossed / hit the frame. That group is only meaningful for shots that reached the goal —
open-play "off target" or "blocked" shots have no placement to describe.

Kept in its own module (not merged into features.py) so the pre-shot xG model can never
see it: pre-shot xG must not depend on where the ball ended up (spec §8.3, excluded
features table — "shot placement ... is post-shot info, not pre-shot xG").
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

import encode as E
import features as F

# --- goal frame (StatsBomb units; see process.md for how these were measured) ----------
GOAL_Y_LO, GOAL_Y_HI = 36.0, 44.0          # posts
GOAL_CENTER_Y = 40.0
GOAL_Z_GROUND, GOAL_Z_BAR = 0.0, 2.67      # ground to crossbar
CORNERS = [(GOAL_Y_LO, GOAL_Z_GROUND), (GOAL_Y_HI, GOAL_Z_GROUND),
          (GOAL_Y_LO, GOAL_Z_BAR), (GOAL_Y_HI, GOAL_Z_BAR)]

GOALMOUTH_COLUMNS = ["gm_abs_dy", "gm_z", "gm_dist_post", "gm_dist_bar", "gm_far_post", "gm_corner_dist"]

# Outcomes StatsBomb records a meaningful goal-frame point for (the ball reached the
# keeper/frame). Training rows come only from these; "Off T" / "Blocked" / "Wayward" have
# no placement to learn from.
ON_TARGET_OUTCOMES = {"Goal", "Saved", "Post", "Saved Off Target", "Saved to Post"}

# The app's simplified outcome enum -> may offer the goal-mouth tap
APP_ON_TARGET_OUTCOMES = {"goal", "saved", "post"}


def goalmouth_features(shot_y: float, gm_y: float, gm_z: float) -> dict[str, float]:
    """(y, z) where the shot crossed/hit the frame -> the placement feature group."""
    gm_y = max(GOAL_Y_LO - 4, min(GOAL_Y_HI + 4, gm_y))
    gm_z = max(0.0, min(GOAL_Z_BAR + 2, gm_z))
    dy = gm_y - GOAL_CENTER_Y
    abs_dy = abs(dy)
    dist_post = min(abs(gm_y - GOAL_Y_LO), abs(gm_y - GOAL_Y_HI))
    dist_bar = abs(gm_z - GOAL_Z_BAR)
    # placed on the opposite side of goal-centre from where the shot was taken -> "far
    # post", generally the harder side for a keeper set toward the near post to reach.
    far_post = 1.0 if (dy * (shot_y - GOAL_CENTER_Y)) < 0 and abs_dy > 0.5 else 0.0
    corner_dist = min(math.hypot(gm_y - cy, gm_z - cz) for cy, cz in CORNERS)
    return {
        "gm_abs_dy": abs_dy, "gm_z": gm_z, "gm_dist_post": dist_post,
        "gm_dist_bar": dist_bar, "gm_far_post": far_post, "gm_corner_dist": corner_dist,
    }


# --- combined feature set / encoding (pre-shot columns + goalmouth) --------------------
PSXG_MODEL_FEATURES: list[str] = E.MODEL_FEATURES + GOALMOUTH_COLUMNS

_GM_MONOTONE = {
    "gm_abs_dy": +1,      # further from the centre line -> closer to a post -> harder
    "gm_z": 0,            # height alone: ambiguous (low drilled vs top corner both hard)
    "gm_dist_post": -1,   # further from the nearest post -> more central -> easier
    "gm_dist_bar": 0,     # ambiguous within the on-target range
    "gm_far_post": +1,    # far-post placement -> harder for a keeper set near-post
    "gm_corner_dist": -1, # further from any corner -> more central -> easier
}
PSXG_MONOTONE: list[int] = E.MONOTONE + [_GM_MONOTONE[c] for c in GOALMOUTH_COLUMNS]


def psxg_row_from_input(inp: dict, gm_y: float, gm_z: float) -> dict:
    """Pre-shot input dict + a goal-mouth point -> the full PSxG feature dict."""
    row = F.features_from_input(inp)
    row.update(goalmouth_features(inp["y"], gm_y, gm_z))
    return row


def psxg_encode_matrix(df: pd.DataFrame) -> np.ndarray:
    """Feature table (pre-shot columns, possibly bucket-masked, + goalmouth columns) ->
    float32 matrix in PSXG_MODEL_FEATURES order."""
    base = E.encode_matrix(df)
    gm = df[GOALMOUTH_COLUMNS].to_numpy(dtype="float32")
    return np.hstack([base, gm])
