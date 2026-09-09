// Pure series builders for the end-of-match charts (spec §5.4).

import type { Shot, Side } from "../db/schema";

export interface TimelinePoint {
  minute: number;
  home: number; // cumulative xG
  away: number;
}

/** Cumulative xG per side as a step series, one point per shot (plus a 0 start and an end). */
export function cumulativeXgSeries(shots: Shot[], endMinute: number): TimelinePoint[] {
  const ordered = [...shots].sort((a, b) => a.minute - b.minute || a.createdAt - b.createdAt);
  const pts: TimelinePoint[] = [{ minute: 0, home: 0, away: 0 }];
  let home = 0;
  let away = 0;
  for (const s of ordered) {
    if (s.side === "home") home += s.xg;
    else away += s.xg;
    pts.push({ minute: s.minute, home, away });
  }
  const last = pts[pts.length - 1];
  const end = Math.max(endMinute, last.minute);
  if (end > last.minute) pts.push({ minute: end, home, away });
  return pts;
}

export interface HistogramBin {
  lo: number;
  hi: number;
  label: string;
  home: number;
  away: number;
}

const EDGES = [0, 0.05, 0.1, 0.2, 0.35, 0.6, 1.0001];

/** Shot-quality distribution: count of shots per xG band, per side. */
export function xgHistogram(shots: Shot[]): HistogramBin[] {
  const bins: HistogramBin[] = [];
  for (let i = 0; i < EDGES.length - 1; i++) {
    const lo = EDGES[i];
    const hi = EDGES[i + 1];
    bins.push({ lo, hi, label: `${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}`, home: 0, away: 0 });
  }
  for (const s of shots) {
    const i = bins.findIndex((b) => s.xg >= b.lo && s.xg < b.hi);
    if (i >= 0) bins[i][s.side] += 1;
  }
  return bins;
}

export function sideTotals(shots: Shot[]): Record<Side, { shots: number; xg: number; goals: number }> {
  const mk = (side: Side) => {
    const s = shots.filter((x) => x.side === side);
    return {
      shots: s.length,
      xg: s.reduce((a, x) => a + x.xg, 0),
      goals: s.filter((x) => x.outcome === "goal").length,
    };
  };
  return { home: mk("home"), away: mk("away") };
}
