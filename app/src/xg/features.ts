// Port of training/features.py — pure, no dependencies.
// Verified against training/feature_fixtures.json by features.test.ts.

import type { FreezeFrame, ShotInput, FeatureRow, XY } from "./types";

// --- pitch constants (StatsBomb units) ---------------------------------
const GOAL_X = 120;
const GOAL_Y = 40;
const POST_A: XY = [120, 36];
const POST_B: XY = [120, 44];
const POST_SEP = 8;
const BOX_X = 102;
const BOX_Y_LO = 18;
const BOX_Y_HI = 62;
const SIX_YARD_X = 114;
const SIX_YARD_Y_LO = 30;
const SIX_YARD_Y_HI = 50;

// --- feature vocabularies / groups (must match encode.py) --------------
export const BODY_PARTS = ["right_foot", "left_foot", "head", "other"] as const;
export const SHOT_TYPES = ["open_play", "free_kick", "corner", "kick_off"] as const;
export const PLAY_PATTERNS = [
  "regular_play", "from_corner", "from_free_kick", "from_throw_in",
  "from_counter", "from_goal_kick", "from_keeper", "from_kick_off", "other",
] as const;
export const TECHNIQUES = [
  "normal", "volley", "half_volley", "lob", "backheel", "diving_header", "overhead_kick",
] as const;
export const ASSIST_TYPES = [
  "none", "through_ball", "cross", "cutback", "low_pass", "high_pass",
  "throw_in", "corner", "free_kick", "keeper_throw", "recovery",
] as const;

export const FEATURE_GROUPS: Record<string, string[]> = {
  core: ["distance", "angle", "dist_x", "abs_y", "in_box", "in_six_yard",
         "body_part", "shot_type", "play_pattern", "under_pressure"],
  freeze_frame: ["defenders_in_cone", "nearest_def_dist", "def_within_3", "def_within_5",
                 "gk_dist", "gk_dist_from_goal", "gk_lateral", "gk_in_cone", "teammates_in_box"],
  assist: ["assist_type"],
  technique: ["technique"],
  context: ["first_time", "follows_dribble", "one_on_one", "open_goal", "rebound"],
  pass_origin: ["pass_origin_dist", "angle_swing"],
};
export const OPTIONAL_GROUPS = ["freeze_frame", "assist", "technique", "context", "pass_origin"] as const;
export const FEATURE_COLUMNS: string[] = Object.values(FEATURE_GROUPS).flat();

// --- geometry ---------------------------------------------------------
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function pointInTriangle(p: XY, a: XY, b: XY, c: XY): boolean {
  const sign = (u: XY, v: XY, w: XY) =>
    (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export function shotGeometry(x: number, y: number): FeatureRow {
  const distX = GOAL_X - x;
  const absY = Math.abs(y - GOAL_Y);
  const distance = Math.hypot(distX, y - GOAL_Y);

  const a = dist(x, y, POST_A[0], POST_A[1]);
  const b = dist(x, y, POST_B[0], POST_B[1]);
  const denom = 2 * a * b;
  let angle: number;
  if (denom <= 1e-9) {
    angle = 0;
  } else {
    let cos = (a * a + b * b - POST_SEP * POST_SEP) / denom;
    cos = Math.max(-1, Math.min(1, cos));
    angle = Math.acos(cos);
    if (distX <= 0) angle = 0;
  }

  return {
    distance,
    angle,
    dist_x: distX,
    abs_y: absY,
    in_box: x >= BOX_X && y >= BOX_Y_LO && y <= BOX_Y_HI ? 1 : 0,
    in_six_yard: x >= SIX_YARD_X && y >= SIX_YARD_Y_LO && y <= SIX_YARD_Y_HI ? 1 : 0,
  };
}

export function freezeFrameFeatures(x: number, y: number, opponents: XY[], keeper: XY | null): FeatureRow {
  const shot: XY = [x, y];
  let defenders_in_cone: number, nearest_def_dist: number, def_within_3: number, def_within_5: number;

  if (opponents.length) {
    const dists = opponents.map((o) => dist(x, y, o[0], o[1])).sort((p, q) => p - q);
    nearest_def_dist = dists[0];
    def_within_3 = dists.filter((d) => d <= 3).length;
    def_within_5 = dists.filter((d) => d <= 5).length;
    defenders_in_cone = opponents.filter((o) => pointInTriangle(o, shot, POST_A, POST_B)).length;
  } else {
    defenders_in_cone = nearest_def_dist = def_within_3 = def_within_5 = NaN;
  }

  let gk_dist: number, gk_dist_from_goal: number, gk_lateral: number, gk_in_cone: number;
  if (keeper) {
    const [kx, ky] = keeper;
    gk_dist = dist(x, y, kx, ky);
    gk_dist_from_goal = dist(kx, ky, GOAL_X, GOAL_Y);
    const vx = GOAL_X - x, vy = GOAL_Y - y;
    const seg = Math.hypot(vx, vy);
    gk_lateral = seg > 1e-9 ? Math.abs(vx * (ky - y) - vy * (kx - x)) / seg : 0;
    gk_in_cone = pointInTriangle(keeper, shot, POST_A, POST_B) ? 1 : 0;
  } else {
    gk_dist = gk_dist_from_goal = gk_lateral = gk_in_cone = NaN;
  }

  return {
    defenders_in_cone, nearest_def_dist, def_within_3, def_within_5,
    gk_dist, gk_dist_from_goal, gk_lateral, gk_in_cone,
    teammates_in_box: NaN, // caller fills
  };
}

// --- the serve-time contract ---------------------------------------
export function presentGroups(input: ShotInput): Set<string> {
  const g = new Set<string>();
  if (input.freeze_frame != null) g.add("freeze_frame");
  if (input.assist_type != null) g.add("assist");
  if (input.pass_origin != null) g.add("pass_origin");
  if (input.technique != null) g.add("technique");
  if (input.context != null) g.add("context");
  return g;
}

export function featuresFromInput(input: ShotInput): FeatureRow {
  const x = Number(input.x), y = Number(input.y);
  const row: FeatureRow = { ...shotGeometry(x, y) };

  row.body_part = input.body_part;
  row.shot_type = input.shot_type;
  row.play_pattern = input.play_pattern;
  row.under_pressure = input.under_pressure ? 1 : 0;

  const ff: FreezeFrame | null | undefined = input.freeze_frame;
  if (ff != null) {
    const f = freezeFrameFeatures(x, y, ff.opponents ?? [], ff.gk ?? null);
    f.teammates_in_box = Number(ff.teammates_in_box ?? 0);
    Object.assign(row, f);
  } else {
    for (const c of FEATURE_GROUPS.freeze_frame) row[c] = NaN;
  }

  row.technique = input.technique ?? null;

  const ctx = input.context;
  for (const c of FEATURE_GROUPS.context) {
    row[c] = ctx != null ? (ctx[c as keyof typeof ctx] ? 1 : 0) : NaN;
  }

  row.assist_type = input.assist_type ?? null;

  const po = input.pass_origin;
  if (po != null) {
    const og = shotGeometry(Number(po[0]), Number(po[1]));
    row.pass_origin_dist = og.distance;
    row.angle_swing = Math.abs(Number(row.angle) - Number(og.angle));
  } else {
    row.pass_origin_dist = NaN;
    row.angle_swing = NaN;
  }

  return row;
}
