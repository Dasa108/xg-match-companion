// Small tappable goal-mouth diagram for PSxG (optional, spec 8.9): "where did it cross the
// line / get stopped". Face-on view — y = across the goal, z = height off the ground.

import type { PointerEvent as ReactPointerEvent } from "react";

import { GOAL_CENTER_Y, GOAL_Y_HI, GOAL_Y_LO, GOAL_Z_BAR } from "../xg/psxgFeatures";
import type { GoalPoint } from "../xg/types";

const Y_LO = GOAL_Y_LO - 4; // 32 — a little wide/high of the frame, to tap near misses
const Y_HI = GOAL_Y_HI + 4; // 48
const Z_TOP = GOAL_Z_BAR + 1.3; // ~4.0 — "well over the bar"
const Z_BOTTOM = -0.4;
const svgY = (z: number) => Z_TOP - z;

interface Props {
  point: GoalPoint | null;
  onPlace: (p: GoalPoint) => void;
}

export function GoalFrame({ point, onPlace }: Props) {
  function toGoal(e: ReactPointerEvent<SVGSVGElement>): GoalPoint {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const y = Y_LO + fx * (Y_HI - Y_LO);
    const z = Z_TOP - fy * (Z_TOP - Z_BOTTOM);
    return [clamp(y, Y_LO, Y_HI), clamp(z, Z_BOTTOM, Z_TOP)];
  }

  return (
    <svg
      className="goalframe"
      viewBox={`${Y_LO} ${Z_BOTTOM} ${Y_HI - Y_LO} ${Z_TOP - Z_BOTTOM}`}
      onPointerDown={(e) => onPlace(toGoal(e))}
      role="img"
      aria-label="Goal mouth — tap where the shot crossed the line"
    >
      <rect x={Y_LO} y={Z_BOTTOM} width={Y_HI - Y_LO} height={Z_TOP - Z_BOTTOM} fill="#0d1512" />
      {/* ground */}
      <rect x={Y_LO} y={svgY(0)} width={Y_HI - Y_LO} height={svgY(Z_BOTTOM) - svgY(0)} fill="#0b7a43" />
      {/* net */}
      <rect
        x={GOAL_Y_LO} y={svgY(GOAL_Z_BAR)} width={GOAL_Y_HI - GOAL_Y_LO} height={svgY(0) - svgY(GOAL_Z_BAR)}
        fill="#eafff2" opacity={0.07}
      />
      {Array.from({ length: 5 }, (_, i) => GOAL_Y_LO + ((i + 1) * (GOAL_Y_HI - GOAL_Y_LO)) / 6).map((y) => (
        <line key={y} x1={y} y1={svgY(GOAL_Z_BAR)} x2={y} y2={svgY(0)} stroke="#eafff2" strokeWidth={0.05} opacity={0.4} />
      ))}
      {Array.from({ length: 3 }, (_, i) => ((i + 1) * GOAL_Z_BAR) / 4).map((z) => (
        <line key={z} x1={GOAL_Y_LO} y1={svgY(z)} x2={GOAL_Y_HI} y2={svgY(z)} stroke="#eafff2" strokeWidth={0.05} opacity={0.4} />
      ))}
      {/* frame */}
      <g stroke="#ffffff" strokeWidth={0.35} fill="none">
        <line x1={GOAL_Y_LO} y1={svgY(0)} x2={GOAL_Y_LO} y2={svgY(GOAL_Z_BAR)} />
        <line x1={GOAL_Y_HI} y1={svgY(0)} x2={GOAL_Y_HI} y2={svgY(GOAL_Z_BAR)} />
        <line x1={GOAL_Y_LO} y1={svgY(GOAL_Z_BAR)} x2={GOAL_Y_HI} y2={svgY(GOAL_Z_BAR)} />
      </g>
      <line x1={GOAL_CENTER_Y} y1={svgY(0)} x2={GOAL_CENTER_Y} y2={svgY(-0.2)} stroke="#eafff2" strokeWidth={0.08} opacity={0.5} />

      {point && (
        <circle cx={point[0]} cy={svgY(point[1])} r={0.5} fill="var(--pos)" stroke="#06231a" strokeWidth={0.1} />
      )}
    </svg>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
