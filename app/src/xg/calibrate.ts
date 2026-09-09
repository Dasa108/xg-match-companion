// No-dependency calibration + bucket helpers (kept out of model.ts so tests don't load ORT).

import type { Bucket } from "./types";

export interface Calibrator {
  x: number[];
  y: number[];
}
export type Calibrators = Record<Bucket, Calibrator>;

/** Piecewise-linear interpolation with flat extrapolation — matches numpy.interp. */
export function interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return x;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const t = span > 0 ? (x - xs[lo]) / span : 0;
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Completeness bucket from the optional groups present in the input (matches features.py). */
export function pickBucket(groups: Set<string>): Bucket {
  const detail = groups.has("assist") || groups.has("technique") || groups.has("pass_origin");
  if (groups.has("freeze_frame") && detail) return "full";
  return groups.size ? "partial" : "minimal";
}
