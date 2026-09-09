// Interactive attacking-half pitch in StatsBomb 120x80 units. Tap to drop the marker for
// the current tool (shot / keeper / defender).

import type { PointerEvent as ReactPointerEvent } from "react";

import type { XY } from "../xg/types";

export type Tool = "shot" | "gk" | "defender";

const VIEW = { x0: 58, y0: -3, w: 66, h: 86 }; // a bit past the goal line and touchlines

interface Props {
  tool: Tool;
  shot: XY | null;
  gk: XY | null;
  defenders: XY[];
  onPlace: (p: XY) => void;
  onRemoveDefender: (i: number) => void;
}

export function Pitch({ tool, shot, gk, defenders, onPlace, onRemoveDefender }: Props) {
  function toPitch(e: ReactPointerEvent<SVGSVGElement>): XY {
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const x = VIEW.x0 + px * VIEW.w;
    const y = VIEW.y0 + py * VIEW.h;
    return [clamp(x, 60, 120), clamp(y, 0, 80)];
  }

  return (
    <svg
      className="pitch"
      viewBox={`${VIEW.x0} ${VIEW.y0} ${VIEW.w} ${VIEW.h}`}
      onPointerDown={(e) => onPlace(toPitch(e))}
      role="img"
      aria-label="Pitch — tap to place the shot"
    >
      {/* turf */}
      <rect x={VIEW.x0} y={VIEW.y0} width={VIEW.w} height={VIEW.h} fill="#0b7a43" />
      {[62, 70, 78, 86, 94, 102, 110, 118].map((x) => (
        <rect key={x} x={x} y={0} width={4} height={80} fill="#0a7040" opacity={x % 8 === 0 ? 0.5 : 0} />
      ))}

      <g stroke="#eafff2" strokeWidth={0.4} fill="none" opacity={0.9}>
        <line x1={60} y1={0} x2={60} y2={80} />
        <rect x={102} y={18} width={18} height={44} />
        <rect x={114} y={30} width={6} height={20} />
        <path d="M 102 32 A 10 10 0 0 1 102 48" />
        <circle cx={108} cy={40} r={0.5} fill="#eafff2" />
        <line x1={120} y1={36} x2={120} y2={44} stroke="#ffffff" strokeWidth={0.9} />
      </g>

      {/* shot cone */}
      {shot && (
        <polygon
          points={`${shot[0]},${shot[1]} 120,36 120,44`}
          fill="#ffd34d"
          opacity={0.16}
          stroke="#ffd34d"
          strokeWidth={0.2}
        />
      )}

      {defenders.map(([x, y], i) => (
        <g key={i} onPointerDown={(e) => { e.stopPropagation(); onRemoveDefender(i); }}>
          <circle cx={x} cy={y} r={1.6} fill="#1f6feb" stroke="#fff" strokeWidth={0.3} />
        </g>
      ))}
      {gk && <circle cx={gk[0]} cy={gk[1]} r={1.8} fill="#ff8c1a" stroke="#fff" strokeWidth={0.3} />}
      {shot && <circle cx={shot[0]} cy={shot[1]} r={1.9} fill="#e5484d" stroke="#fff" strokeWidth={0.4} />}

      <text x={VIEW.x0 + 1} y={VIEW.y0 + 5} fill="#eafff2" fontSize={2.6} opacity={0.8}>
        tool: {tool}
      </text>
    </svg>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
