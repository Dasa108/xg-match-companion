// Full pitch, portrait, attacking goal at the top. Tap to place the marker for the current
// tool (shot / keeper / defender). Coordinates handed out are StatsBomb 120x80 model units.

import type { PointerEvent as ReactPointerEvent } from "react";

import type { XY } from "../xg/types";
import { fromSvg, PITCH_VIEW, PITCH_VIEWBOX, toSvg } from "./geometry";
import { PitchMarkings } from "./PitchMarkings";

export type Tool = "shot" | "gk" | "defender";

interface Props {
  tool: Tool;
  shot: XY | null;
  gk: XY | null;
  defenders: XY[];
  onPlace: (p: XY) => void;
  onRemoveDefender: (i: number) => void;
}

export function Pitch({ tool, shot, gk, defenders, onPlace, onRemoveDefender }: Props) {
  function toModel(e: ReactPointerEvent<SVGSVGElement>): XY {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = PITCH_VIEW.x + ((e.clientX - r.left) / r.width) * PITCH_VIEW.w;
    const sy = PITCH_VIEW.y + ((e.clientY - r.top) / r.height) * PITCH_VIEW.h;
    return fromSvg(sx, sy);
  }

  const shotSvg = shot ? toSvg(shot[0], shot[1]) : null;
  const gkSvg = gk ? toSvg(gk[0], gk[1]) : null;

  return (
    <svg
      className="pitch"
      viewBox={PITCH_VIEWBOX}
      onPointerDown={(e) => onPlace(toModel(e))}
      role="img"
      aria-label="Pitch — tap where the shot was taken"
    >
      <PitchMarkings />

      {shotSvg && (
        <polygon
          points={`${shotSvg[0]},${shotSvg[1]} 36,0 44,0`}
          fill="#ffd34d"
          opacity={0.16}
          stroke="#ffd34d"
          strokeWidth={0.2}
        />
      )}

      {defenders.map((d, i) => {
        const [dx, dy] = toSvg(d[0], d[1]);
        return (
          <g key={i} onPointerDown={(e) => { e.stopPropagation(); onRemoveDefender(i); }}>
            <circle cx={dx} cy={dy} r={1.6} fill="#1f6feb" stroke="#fff" strokeWidth={0.3} />
          </g>
        );
      })}
      {gkSvg && <circle cx={gkSvg[0]} cy={gkSvg[1]} r={1.8} fill="#ff8c1a" stroke="#fff" strokeWidth={0.3} />}
      {shotSvg && <circle cx={shotSvg[0]} cy={shotSvg[1]} r={1.9} fill="#e5484d" stroke="#fff" strokeWidth={0.4} />}

      <text x={PITCH_VIEW.x + 1} y={PITCH_VIEW.y + 4} fill="#eafff2" fontSize={2.6} opacity={0.75}>
        tool: {tool}  ·  attack ↑
      </text>
    </svg>
  );
}
