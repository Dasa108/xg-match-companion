// Full pitch, drawn portrait with the team-in-possession attacking UP (towards svg y=0).
// SVG space is 80 wide x 120 tall — the same numbers as StatsBomb width x length — so the
// transform to model coordinates (StatsBomb 120 long x 80 wide, attack towards x=120) is
// just an axis swap.

export const PITCH_VIEW = { x: -4, y: -5, w: 88, h: 130 };
export const PITCH_VIEWBOX = `${PITCH_VIEW.x} ${PITCH_VIEW.y} ${PITCH_VIEW.w} ${PITCH_VIEW.h}`;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** model (x,y) in StatsBomb 120x80 -> svg (x,y) in the 80x120 portrait frame. */
export const toSvg = (x: number, y: number): [number, number] => [y, 120 - x];

/** svg (x,y) -> model (x,y), clamped to the pitch. */
export const fromSvg = (sx: number, sy: number): [number, number] => [
  clamp(120 - sy, 0, 120),
  clamp(sx, 0, 80),
];

/** svg coords of the two goalposts of the goal being attacked (top). */
export const POSTS_SVG: [number, number][] = [
  [36, 0],
  [44, 0],
];
