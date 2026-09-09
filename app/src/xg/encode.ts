// Port of training/encode.py — feature row -> numeric model input, plus the bucket masking.

import type { Bucket, FeatureRow } from "./types";
import {
  ASSIST_TYPES, BODY_PARTS, FEATURE_COLUMNS, FEATURE_GROUPS, PLAY_PATTERNS,
  SHOT_TYPES, TECHNIQUES,
} from "./features";

const CATEGORICALS = ["body_part", "shot_type", "play_pattern", "technique", "assist_type"] as const;

export const NUMERIC_COLUMNS: string[] = FEATURE_COLUMNS.filter(
  (c) => !(CATEGORICALS as readonly string[]).includes(c),
);

const ONEHOT: [string, readonly string[]][] = [
  ["body_part", BODY_PARTS],
  ["shot_type", SHOT_TYPES],
  ["play_pattern", PLAY_PATTERNS],
  ["technique", TECHNIQUES],
  ["assist_type", ASSIST_TYPES],
];

export const ONEHOT_COLUMNS: string[] = ONEHOT.flatMap(([c, vocab]) =>
  vocab.map((v) => `${c}=${v}`),
);

export const MODEL_FEATURES: string[] = [...NUMERIC_COLUMNS, ...ONEHOT_COLUMNS];

/** Which optional groups each completeness bucket keeps (must match train.py BUCKETS). */
export const BUCKET_KEEP: Record<Bucket, Set<string>> = {
  minimal: new Set(),
  partial: new Set(["freeze_frame"]),
  full: new Set(["freeze_frame", "assist", "technique", "pass_origin", "context"]),
};

/** Blank every optional group not in `keep` (categoricals -> null, numerics -> NaN). */
export function maskGroups(row: FeatureRow, keep: Set<string>): FeatureRow {
  const out: FeatureRow = { ...row };
  for (const g of Object.keys(FEATURE_GROUPS)) {
    if (g === "core" || keep.has(g)) continue;
    for (const col of FEATURE_GROUPS[g]) {
      out[col] = (CATEGORICALS as readonly string[]).includes(col) ? null : NaN;
    }
  }
  return out;
}

/** FeatureRow -> Float32Array in MODEL_FEATURES order. Missing -> NaN (numeric) / all-zero (one-hot). */
export function encodeRow(row: FeatureRow): Float32Array {
  const out = new Float32Array(MODEL_FEATURES.length);
  let i = 0;
  for (const c of NUMERIC_COLUMNS) {
    const v = row[c];
    out[i++] = v === null || v === undefined ? NaN : Number(v);
  }
  for (const [col, vocab] of ONEHOT) {
    const cat = row[col];
    for (const v of vocab) out[i++] = cat === v ? 1 : 0;
  }
  return out;
}
