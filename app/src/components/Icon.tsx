// A small hand-drawn icon set replacing emoji — consistent stroke weight and geometry so
// the tool row / buttons read as one designed system rather than whatever glyphs a phone's
// emoji font happens to render. 20x20 viewBox, stroke-based, currentColor.

import type { ReactNode } from "react";

export type IconName =
  | "target" | "gloves" | "shield" | "pass" | "download" | "reset"
  | "play" | "pause" | "edit" | "goal-frame" | "chevron";

const PATHS: Record<IconName, ReactNode> = {
  target: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
      <circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  gloves: (
    <>
      <path d="M6.5 12.5c-1.5 0-2.5-1.2-2.5-2.6 0-1.6 1.3-2.9 1.3-4.4 0-.7.5-1.2 1.1-1.2s1 .5 1 1.2v3" />
      <path d="M7.4 8.5V4.9c0-.7.5-1.3 1.1-1.3s1.1.6 1.1 1.3v3.4" />
      <path d="M9.6 8.2V4.6c0-.7.5-1.2 1.1-1.2s1.1.5 1.1 1.2v3.8" />
      <path d="M11.8 8.6V6c0-.7.5-1.2 1-1.2.6 0 1.1.5 1.1 1.2v5.6c0 2.6-1.8 4.6-4.4 4.6H8.2c-1.7 0-2.7-.7-3.5-1.9" />
    </>
  ),
  shield: <path d="M10 3l6 2.2v4.3c0 4-2.6 6.6-6 7.5-3.4-.9-6-3.5-6-7.5V5.2L10 3z" />,
  pass: (
    <>
      <path d="M3.5 13.5c3.5.5 9-1 13-7" />
      <path d="M12.5 5.2l4-1.2-.7 4.1" />
    </>
  ),
  download: (
    <>
      <path d="M5 3.5h7l3 3v10a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-13z" />
      <path d="M12 3.5V7h3" />
      <path d="M10 9.5v5" />
      <path d="M7.5 12l2.5 2.5 2.5-2.5" />
    </>
  ),
  reset: (
    <>
      <path d="M15.5 10a5.5 5.5 0 1 1-1.7-4" />
      <path d="M15.8 3.2v3.4h-3.4" />
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
