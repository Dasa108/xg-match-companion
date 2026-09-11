// The shape the app builds from operator taps, and the vocabularies the model knows.
// These MUST match training/features.py / encode.py (a test asserts it against
// public/model/feature_spec.json).

export type BodyPart = "right_foot" | "left_foot" | "head" | "other";
export type ShotType = "open_play" | "free_kick" | "corner" | "kick_off";
export type PlayPattern =
  | "regular_play" | "from_corner" | "from_free_kick" | "from_throw_in"
  | "from_counter" | "from_goal_kick" | "from_keeper" | "from_kick_off" | "other";
export type Technique =
  | "normal" | "volley" | "half_volley" | "lob" | "backheel" | "diving_header" | "overhead_kick";
export type AssistType =
  | "none" | "through_ball" | "cross" | "cutback" | "low_pass" | "high_pass"
  | "throw_in" | "corner" | "free_kick" | "keeper_throw" | "recovery";

export type XY = [number, number]; // StatsBomb 120x80 units, attacking towards x=120

export interface FreezeFrame {
  gk: XY | null;
  opponents: XY[]; // opposition OUTFIELD players near the shooter
  teammates_in_box: number;
}

export interface ShotContext {
  first_time: boolean;
  follows_dribble: boolean;
  one_on_one: boolean;
  open_goal: boolean;
  rebound: boolean;
}

/** One shot as the operator described it. Optional groups are absent when null. */
export interface ShotInput {
  x: number;
  y: number;
  // `penalty` short-circuits to a constant xG and never reaches the model
  shot_type: ShotType | "penalty";
  body_part: BodyPart;
  play_pattern: PlayPattern;
  under_pressure: boolean;

  freeze_frame?: FreezeFrame | null;
  assist_type?: AssistType | null;
  pass_origin?: XY | null;
  technique?: Technique | null;
  context?: ShotContext | null;
}

export type FeatureValue = number | string | null;
export type FeatureRow = Record<string, FeatureValue>;

export type Bucket = "minimal" | "partial" | "full";

export interface XgResult {
  xg: number;
  raw: number | null; // null for penalties
  bucket: Bucket | "penalty";
  features: FeatureRow;
}

/** [y, z] within the goal frame (StatsBomb units: y 36-44 posts, z 0-2.67 crossbar). */
export type GoalPoint = [number, number];

export interface PsxgResult {
  psxg: number;
  raw: number;
  bucket: Bucket;
  goalmouth: GoalPoint;
}
