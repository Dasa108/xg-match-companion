// A small hand-drawn icon set replacing emoji — consistent stroke weight and geometry so
// the tool row / buttons read as one designed system rather than whatever glyphs a phone's
// emoji font happens to render. 20x20 viewBox, stroke-based, currentColor.

import type { ReactNode } from "react";

export type IconName =
  | "target" | "gloves" | "shield" | "pass" | "download" | "reset" | "undo"
  | "play" | "pause" | "edit" | "goal-frame" | "chevron" | "football";

const PATHS: Record<IconName, ReactNode> = {
  target: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
      <circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // outer ring + a filled central pentagon with seams to the edge, like a ball's panels
  football: (
    <>
      <circle cx="10" cy="10" r="7" strokeWidth={1.4} />
      <polygon points="10,7 12.85,9.07 11.76,12.43 8.24,12.43 7.15,9.07" fill="currentColor" stroke="none" />
      <path
        d="M10 7V3M12.85 9.07L16.66 7.84M11.76 12.43L14.12 15.66M8.24 12.43L5.88 15.66M7.15 9.07L3.34 7.84"
        strokeWidth={1.2}
      />
    </>
  ),
  gloves: (
    <>
      <path
        d="M10 3.2c2.7 0 4.8 2.9 4.8 6.4v3.1c0 3-2.1 5.3-4.8 5.3s-4.8-2.3-4.8-5.3V9.6c0-3.5 2.1-6.4 4.8-6.4z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M13.6 7.6c1.3-1 2.9-.4 2.9 1.3 0 1.9-1.1 3.6-2.5 4.1" strokeWidth={1.7} />
    </>
  ),
  shield: <path d="M10 3l6 2.2v4.3c0 4-2.6 6.6-6 7.5-3.4-.9-6-3.5-6-7.5V5.2L10 3z" fill="currentColor" stroke="none" />,
  pass: (
    <>
      <path d="M4.5 15.5L15.5 4.5" strokeWidth={1.8} />
      <path d="M8 4.5h7.5V12" strokeWidth={1.8} />
    </>
  ),
  download: (
    <>
      <path d="M10 3v9.5" strokeWidth={1.8} />
      <path d="M5.8 8.7L10 13l4.2-4.3" strokeWidth={1.8} />
      <path d="M4 16.5h12" strokeWidth={1.8} />
    </>
  ),
  reset: (
    <>
      <path d="M4.3 10a5.7 5.7 0 1 0 1.8-4.2" strokeWidth={1.8} />
      <path d="M4 3.5v3.8h3.8" strokeWidth={1.8} />
    </>
  ),
  // one step back — a hooked arrow, distinct from "reset"'s full circle (undo removes
  // just the last thing placed; reset clears everything on the pitch).
  undo: (
    <>
      <path d="M16.7 16.7v-5.9a3.3 3.3 0 0 0-3.4-3.3H3.3" strokeWidth={1.8} />
      <path d="M7.5 11.7L3.3 7.5l4.2-3.3" strokeWidth={1.8} />
    </>
  ),
  play: <path d="M6 4l10 6-10 6V4z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="5.5" y="4" width="3" height="12" rx="0.8" fill="currentColor" stroke="none" />
      <rect x="11.5" y="4" width="3" height="12" rx="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  edit: (
    <>
      <path d="M12.4 3.8l3.8 3.8L6 18H2.2v-3.8L12.4 3.8z" />
      <path d="M10.6 5.6l3.8 3.8" />
    </>
  ),
  "goal-frame": (
    <>
      <path d="M4 4v11.5" />
      <path d="M16 4v11.5" />
      <path d="M4 4h12" />
      <path d="M4 15.5h12" strokeDasharray="1.6 1.6" />
    </>
  ),
  chevron: <path d="M7 5l6 5-6 5" />,
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
