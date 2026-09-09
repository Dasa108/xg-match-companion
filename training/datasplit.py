"""
datasplit.py — train / val / test assignment and the feature-group masking helper.

Split policy (spec 8.5): match-level split, deterministic by match_id, so shots from one
match never straddle train/test (no leakage) while every competition is still represented
in every split. That keeps train and test the *same population*, which is what makes
calibration meaningful. evaluate.py additionally reports per-competition test error as a
generalization check.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import features as F

# hash bucket in [0, 1000):  < 150 -> test (15%);  150..250 -> val (10%, early stopping);
#                            250..380 -> calib (13%, isotonic calibration);  >= 380 -> train
SPLIT_EDGES = [(150, "test"), (250, "val"), (380, "calib")]


def assign_split(df: pd.DataFrame) -> pd.Series:
    # Knuth multiplicative hash on the 64-bit match_id -> stable bucket 0..999
    h = ((df["match_id"].astype("int64") * 2654435761) % 1000).to_numpy()
    out = np.full(len(df), "train", dtype=object)
    prev = 0
    for edge, name in SPLIT_EDGES:
        out[(h >= prev) & (h < edge)] = name
        prev = edge
    return pd.Series(out, index=df.index, name="split")


# --- feature-group masking ------------------------------------------------
def _blank(df: pd.DataFrame, cols: list[str], where: np.ndarray | None = None) -> None:
    """Set `cols` to missing, in place. `where` is an optional boolean row mask."""
    for c in cols:
        s = df[c]
        if isinstance(s.dtype, pd.CategoricalDtype):
            if where is None:
                df[c] = pd.Categorical([np.nan] * len(df), dtype=s.dtype)
            else:
                s = s.copy()
                s[where] = np.nan
                df[c] = s
        elif where is None:
            df[c] = np.nan
        else:
            df.loc[where, c] = np.nan


def apply_bucket_mask(df: pd.DataFrame, keep_groups: set[str]) -> pd.DataFrame:
    """Return a copy with every optional group NOT in `keep_groups` blanked out."""
    out = df.copy()
    for g in F.OPTIONAL_GROUPS:
        if g not in keep_groups:
            _blank(out, F.FEATURE_GROUPS[g])
    return out


def random_dropout(df: pd.DataFrame, rng: np.random.Generator, p: float = 0.5) -> pd.DataFrame:
    """Independently blank each optional group per row with probability `p`."""
    out = df.copy()
    for g in F.OPTIONAL_GROUPS:
        drop = rng.random(len(out)) < p
        _blank(out, F.FEATURE_GROUPS[g], where=drop)
    return out


def jitter_freeze_frame(df: pd.DataFrame, rng: np.random.Generator, sigma: float = 1.7) -> pd.DataFrame:
    """
    Approximate the spec's "jitter marker positions by ~1.5 m" by adding noise to the
    freeze-frame *distance* features (sigma is in StatsBomb units, ~1.5 m). Count features
    get an occasional +/-1 nudge. Proper re-computation from raw coords is a v2 improvement.
    """
    out = df.copy()
    for c in ["nearest_def_dist", "gk_dist", "gk_dist_from_goal", "gk_lateral", "pass_origin_dist"]:
        m = out[c].notna().to_numpy()
        noise = rng.normal(0.0, sigma, size=int(m.sum()))
        vals = out.loc[m, c].to_numpy() + noise
        out.loc[m, c] = np.clip(vals, 0.0, None)
    for c in ["defenders_in_cone", "def_within_3", "def_within_5", "teammates_in_box"]:
        m = out[c].notna().to_numpy()
        nudge = rng.choice([-1, 0, 0, 0, 1], size=int(m.sum()))
        out.loc[m, c] = np.clip(out.loc[m, c].to_numpy() + nudge, 0.0, None)
    return out


def build_training_matrix(df_train: pd.DataFrame, rng: np.random.Generator,
                          n_random: int = 2) -> pd.DataFrame:
    """
    Augment training rows so the model learns every completeness level:
      copy 0 : full (no dropout)
      copy 1 : minimal (all optional groups blanked)
      copy 2..: random per-row per-group dropout, with position jitter
    """
    parts = [df_train.copy(), apply_bucket_mask(df_train, keep_groups=set())]
    for _ in range(n_random):
        parts.append(jitter_freeze_frame(random_dropout(df_train, rng), rng))
    return pd.concat(parts, ignore_index=True)
