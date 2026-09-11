// Port of training/psxg_features.py — the goal-mouth placement feature group for PSxG.
// Builds on featuresFromInput() (pre-shot) rather than duplicating it; kept in its own
// module so the pre-shot xG path can never see placement data (spec 8.3).

import { encodeRow, MODEL_FEATURES as PRESHOT_MODEL_FEATURES } from "./encode";
import type { FeatureRow, GoalPoint, ShotInput } from "./types";

export const GOAL_Y_LO = 36.0;
export const GOAL_Y_HI = 44.0;
export const GOAL_CENTER_Y = 40.0;
export const GOAL_Z_GROUND = 0.0;
export const GOAL_Z_BAR = 2.67;
const CORNERS: GoalPoint[] = [
  [GOAL_Y_LO, GOAL_Z_GROUND], [GOAL_Y_HI, GOAL_Z_GROUND],
  [GOAL_Y_LO, GOAL_Z_BAR], [GOAL_Y_HI, GOAL_Z_BAR],
];

export const GOALMOUTH_COLUMNS = [
  "gm_abs_dy", "gm_z", "gm_dist_post", "gm_dist_bar", "gm_far_post", "gm_corner_dist",
] as const;

export const PSXG_MODEL_FEATURES: string[] = [...PRESHOT_MODEL_FEATURES, ...GOALMOUTH_COLUMNS];

export function goalmouthFeatures(shotY: number, gmY: number, gmZ: number): FeatureRow {
  const y = Math.max(GOAL_Y_LO - 4, Math.min(GOAL_Y_HI + 4, gmY));
  const z = Math.max(0, Math.min(GOAL_Z_BAR + 2, gmZ));
  const dy = y - GOAL_CENTER_Y;
  const absDy = Math.abs(dy);
  const distPost = Math.min(Math.abs(y - GOAL_Y_LO), Math.abs(y - GOAL_Y_HI));
  const distBar = Math.abs(z - GOAL_Z_BAR);
  const farPost = dy * (shotY - GOAL_CENTER_Y) < 0 && absDy > 0.5 ? 1 : 0;
  const cornerDist = Math.min(...CORNERS.map(([cy, cz]) => Math.hypot(y - cy, z - cz)));
  return {
    gm_abs_dy: absDy, gm_z: z, gm_dist_post: distPost,
    gm_dist_bar: distBar, gm_far_post: farPost, gm_corner_dist: cornerDist,
  };
}

/** Pre-shot feature row + a goal-mouth point -> the full PSxG feature dict. */
export function psxgRow(input: ShotInput, preshotFeatures: FeatureRow, goalmouth: GoalPoint): FeatureRow {
  return { ...preshotFeatures, ...goalmouthFeatures(input.y, goalmouth[0], goalmouth[1]) };
}

/** Full PSxG feature row -> Float32Array in PSXG_MODEL_FEATURES order. */
export function encodePsxgRow(row: FeatureRow): Float32Array {
  const base = encodeRow(row); // pre-shot numeric + one-hot columns, same as the xG model
  const out = new Float32Array(base.length + GOALMOUTH_COLUMNS.length);
  out.set(base, 0);
  GOALMOUTH_COLUMNS.forEach((c, i) => {
    out[base.length + i] = Number(row[c]);
  });
  return out;
}
