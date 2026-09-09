// A short, human explanation of an xG value, and a rough confidence band.
//
// This is a transparent rule-of-thumb read of the feature values, NOT SHAP. A genuine
// per-shot attribution would need the model to export contributions; that's a v2 item.
// The phrases are ordered by rough salience and the top few are shown.

import type { Bucket, FeatureRow } from "./types";

interface Phrase {
  text: string;
  weight: number; // higher = more likely to be the headline reason
}

export function explainXg(f: FeatureRow, bucket: Bucket | "penalty"): string {
  if (bucket === "penalty") return "penalty";

  const num = (k: string) => (typeof f[k] === "number" ? (f[k] as number) : NaN);
  const phrases: Phrase[] = [];

  const dist = num("distance");
  if (dist <= 6) phrases.push({ text: "point-blank range", weight: 10 });
  else if (dist <= 11) phrases.push({ text: "close range", weight: 7 });
  else if (dist <= 18) phrases.push({ text: "from the edge of the box", weight: 5 });
  else if (dist <= 30) phrases.push({ text: "from distance", weight: 6 });
  else phrases.push({ text: "from long range", weight: 8 });

  const angDeg = (num("angle") * 180) / Math.PI;
  if (angDeg >= 50) phrases.push({ text: "a wide-open angle", weight: 4 });
  else if (angDeg < 22) phrases.push({ text: "a tight angle", weight: 7 });

  if (num("open_goal") === 1) phrases.push({ text: "an open goal", weight: 12 });
  if (num("one_on_one") === 1) phrases.push({ text: "one-on-one with the keeper", weight: 9 });

  const inCone = num("defenders_in_cone");
  if (inCone === 0) phrases.push({ text: "a clear sight of goal", weight: 5 });
  else if (inCone >= 2) phrases.push({ text: "a crowded box", weight: 5 });

  const nearest = num("nearest_def_dist");
  if (num("under_pressure") === 1 || (nearest > 0 && nearest < 1.5))
    phrases.push({ text: "under pressure", weight: 4 });

  if (num("gk_dist_from_goal") >= 6) phrases.push({ text: "the keeper off his line", weight: 6 });

  // body part is one-hot -> check the encoded feature isn't available here; use the raw
  if (f["technique"] === "volley") phrases.push({ text: "a volley", weight: 3 });
  if (num("first_time") === 1) phrases.push({ text: "hit first-time", weight: 3 });
  if (num("rebound") === 1) phrases.push({ text: "a rebound", weight: 5 });

  const assist = f["assist_type"];
  if (assist === "cross") phrases.push({ text: "from a cross", weight: 3 });
  else if (assist === "cutback") phrases.push({ text: "from a cutback", weight: 4 });
  else if (assist === "through_ball") phrases.push({ text: "played through", weight: 4 });

  const top = phrases.sort((a, b) => b.weight - a.weight).slice(0, 3).map((p) => p.text);
  return top.join(", ");
}

/** Illustrative ± width on the xG readout, wider when fewer inputs were given.
 *  Reflects the measured accuracy gap between buckets (models/metrics.md), not a
 *  calibrated prediction interval. */
export function confidenceBand(xg: number, bucket: Bucket | "penalty"): [number, number] {
  const half = bucket === "full" ? 0.025 : bucket === "partial" ? 0.04 : bucket === "minimal" ? 0.06 : 0.02;
  return [Math.max(0, xg - half), Math.min(1, xg + half)];
}
