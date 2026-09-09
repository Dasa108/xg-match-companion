"""
encode.py — turn the feature table into a purely numeric model matrix.

We one-hot the five categoricals into fixed columns instead of using LightGBM's native
categorical splits. Reasons:
  * ONNX export of categorical splits is fragile; an all-numeric model converts cleanly,
  * the browser port becomes "set one dummy to 1" with no code tables,
  * a missing category (group dropped) is simply "all dummies 0" — an unambiguous "unknown".

MODEL_FEATURES is the exact input order the ONNX model expects. The TS port must build the
same vector in the same order.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import features as F

_ONEHOT = [
    ("body_part", F.BODY_PARTS),
    ("shot_type", F.SHOT_TYPES),
    ("play_pattern", F.PLAY_PATTERNS),
    ("technique", F.TECHNIQUES),
    ("assist_type", F.ASSIST_TYPES),
]

ONEHOT_COLUMNS: list[str] = [f"{col}={v}" for col, vocab in _ONEHOT for v in vocab]
MODEL_FEATURES: list[str] = list(F.NUMERIC_COLUMNS) + ONEHOT_COLUMNS

# monotone constraint per MODEL_FEATURES entry: xG falls as it gets harder, rises as easier
_MONO_NUMERIC = {
    "distance": -1, "dist_x": -1, "angle": +1,
    "defenders_in_cone": -1, "nearest_def_dist": +1, "def_within_3": -1, "def_within_5": -1,
    "gk_in_cone": -1, "one_on_one": +1, "open_goal": +1,
}
MONOTONE = [_MONO_NUMERIC.get(c, 0) for c in F.NUMERIC_COLUMNS] + [0] * len(ONEHOT_COLUMNS)


def encode_matrix(df: pd.DataFrame) -> np.ndarray:
    """DataFrame -> float32 array of shape (n, len(MODEL_FEATURES)). NaN kept for missing."""
    parts = [df[F.NUMERIC_COLUMNS].to_numpy(dtype="float32")]
    for col, vocab in _ONEHOT:
        codes = df[col].astype("object").to_numpy()
        oh = np.zeros((len(df), len(vocab)), dtype="float32")
        for j, v in enumerate(vocab):
            oh[:, j] = (codes == v)
        parts.append(oh)
    return np.hstack(parts)
