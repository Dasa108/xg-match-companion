// Shot-outcome markers: color AND shape, so outcomes are never color-alone (spec §11
// accessibility requirement). Validated palette — see process.md for the CVD check.
// Pure string builders so the identical marker renders in the live app (via
// dangerouslySetInnerHTML, same pattern as pitchMarkingsSvg.ts) and in the standalone
// downloadable report (xg/reportHtml.ts), which isn't a React tree.

import type { Outcome } from "../db/schema";

export const OUTCOME_COLOR: Record<Outcome, string> = {
  goal: "var(--pos)",
  saved: "var(--away)",
  post: "var(--post)",
  blocked: "var(--blocked)",
  off_target: "var(--muted)",
};

/** Plain-hex fallback (no CSS custom properties available), used by the report doc's
 * legend swatches where a var() would still work fine — kept for anywhere it might not. */
export const OUTCOME_COLOR_HEX: Record<Outcome, string> = {
  goal: "#bd8a12",
  saved: "#2c86d1",
  post: "#c23a8f",
  blocked: "#c56420",
  off_target: "#93ab9f",
};

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function triangle(cx: number, cy: number, r: number): string {
  const h = r * 1.15;
  return [
    `${cx},${(cy - h).toFixed(2)}`,
    `${(cx + h * 0.9).toFixed(2)},${(cy + h * 0.55).toFixed(2)}`,
    `${(cx - h * 0.9).toFixed(2)},${(cy + h * 0.55).toFixed(2)}`,
  ].join(" ");
}

/**
 * SVG markup for one outcome marker, centered at (cx, cy) with "radius" r. The *shape*
 * always encodes the outcome (accessibility — never color-alone); the *fill* is a
 * parameter, because different charts color by different things: the shot log colors by
 * outcome (pass `OUTCOME_COLOR[outcome]`), the shot map colors by team (pass home/away/gold).
 * `stroke` is the ring drawn around filled shapes (a dark ink for contrast against light fills).
 */
export function outcomeMarker(outcome: Outcome, cx: number, cy: number, r: number, fill: string, stroke = "#06231a"): string {
  const c = fill;
  const sw = Math.max(0.15, r * 0.14);
  switch (outcome) {
    case "goal": // star — the headline outcome
      return `<polygon points="${star(cx, cy, r * 1.15)}" fill="${c}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case "post": // diamond
      return `<rect x="${(cx - r * 0.8).toFixed(2)}" y="${(cy - r * 0.8).toFixed(2)}" width="${(r * 1.6).toFixed(2)}" height="${(r * 1.6).toFixed(2)}" transform="rotate(45 ${cx} ${cy})" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case "blocked": // triangle
      return `<polygon points="${triangle(cx, cy, r)}" fill="${c}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case "off_target": // hollow ring — a miss, nothing solid
      return `<circle cx="${cx}" cy="${cy}" r="${r * 0.85}" fill="none" stroke="${c}" stroke-width="${(r * 0.4).toFixed(2)}"/>`;
    case "saved": // circle
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  goal: "goal", saved: "saved", post: "post", blocked: "blocked", off_target: "off target",
};
