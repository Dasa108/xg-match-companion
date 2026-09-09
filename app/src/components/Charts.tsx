// Inline-SVG charts for the end-of-match report. No chart library.

import type { Shot } from "../db/schema";
import type { HistogramBin, TimelinePoint } from "../xg/report";

const HOME = "#35d07f";
const AWAY = "#1f9dff";
const GOAL = "#ffd34d";

// --- cumulative xG timeline ------------------------------------------
export function XgTimeline({
  points, homeName, awayName,
}: {
  points: TimelinePoint[];
  homeName: string;
  awayName: string;
}) {
  const W = 320;
  const H = 150;
  const pad = { l: 26, r: 8, t: 8, b: 18 };
  const endMin = Math.max(1, points[points.length - 1]?.minute ?? 1);
  const maxXg = Math.max(0.5, ...points.map((p) => Math.max(p.home, p.away)));

  const sx = (m: number) => pad.l + (m / endMin) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / maxXg) * (H - pad.t - pad.b);

  const step = (key: "home" | "away") => {
    let d = `M ${sx(points[0].minute)} ${sy(points[0][key])}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${sx(points[i].minute)} ${sy(points[i - 1][key])}`;
      d += ` L ${sx(points[i].minute)} ${sy(points[i][key])}`;
    }
    return d;
  };

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative expected goals over time">
        {[0, 0.5, 1].map((f) => {
          const v = maxXg * f;
          return (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="#2b3a33" strokeWidth={0.5} />
              <text x={2} y={sy(v) + 3} fill="#9fb4aa" fontSize={8}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} stroke="#2b3a33" />
        <text x={pad.l} y={H - 4} fill="#9fb4aa" fontSize={8}>0′</text>
        <text x={W - pad.r} y={H - 4} fill="#9fb4aa" fontSize={8} textAnchor="end">{endMin}′</text>
        <path d={step("home")} fill="none" stroke={HOME} strokeWidth={2} />
        <path d={step("away")} fill="none" stroke={AWAY} strokeWidth={2} />
      </svg>
      <figcaption>
        <Key c={HOME} label={homeName} /> <Key c={AWAY} label={awayName} /> — cumulative xG
      </figcaption>
    </figure>
  );
}

// --- shot-quality histogram ---------------------------------------
export function XgHistogram({
  bins, homeName, awayName,
}: {
  bins: HistogramBin[];
  homeName: string;
  awayName: string;
}) {
  const W = 320;
  const H = 140;
  const pad = { l: 20, r: 8, t: 8, b: 26 };
  const maxCount = Math.max(1, ...bins.flatMap((b) => [b.home, b.away]));
  const bw = (W - pad.l - pad.r) / bins.length;

  const bar = (i: number, count: number, offset: number, fill: string) => {
    const h = (count / maxCount) * (H - pad.t - pad.b);
    return (
      <rect
        key={fill + i}
        x={pad.l + i * bw + offset + 1}
        y={H - pad.b - h}
        width={bw / 2 - 2}
        height={h}
        fill={fill}
      />
    );
  };

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Shot quality distribution">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#2b3a33" />
        {bins.map((b, i) => (
          <g key={b.label}>
            {bar(i, b.home, 0, HOME)}
            {bar(i, b.away, bw / 2, AWAY)}
            <text
              x={pad.l + i * bw + bw / 2}
              y={H - pad.b + 10}
              fill="#9fb4aa"
              fontSize={7}
              textAnchor="middle"
            >
              {b.lo.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} fill="#9fb4aa" fontSize={7}>xG per shot →</text>
      </svg>
      <figcaption>
        <Key c={HOME} label={homeName} /> <Key c={AWAY} label={awayName} /> — shots by chance quality
      </figcaption>
    </figure>
  );
}

// --- shot map -----------------------------------------------------
export function ShotMap({ shots }: { shots: Shot[] }) {
  return (
    <figure className="chart">
      <svg className="pitch" viewBox="58 -3 66 86" role="img" aria-label="Shot map">
        <rect x={58} y={-3} width={66} height={86} fill="#0b7a43" />
        <g stroke="#eafff2" strokeWidth={0.4} fill="none" opacity={0.9}>
          <line x1={60} y1={0} x2={60} y2={80} />
          <rect x={102} y={18} width={18} height={44} />
          <rect x={114} y={30} width={6} height={20} />
          <path d="M 102 32 A 10 10 0 0 1 102 48" />
          <line x1={120} y1={36} x2={120} y2={44} stroke="#fff" strokeWidth={0.9} />
        </g>
        {shots.map((s, i) => (
          <circle
            key={i}
            cx={s.input.x}
            cy={s.input.y}
            r={1 + s.xg * 6}
            fill={s.outcome === "goal" ? GOAL : s.side === "home" ? HOME : AWAY}
            opacity={s.outcome === "goal" ? 0.95 : 0.7}
            stroke="#06231a"
            strokeWidth={0.2}
          />
        ))}
      </svg>
      <figcaption>
        <Key c={HOME} label="home" /> <Key c={AWAY} label="away" /> <Key c={GOAL} label="goal" /> — dot size ∝ xG
      </figcaption>
    </figure>
  );
}

function Key({ c, label }: { c: string; label: string }) {
  return (
    <span className="key">
      <span className="swatch" style={{ background: c }} /> {label}
    </span>
  );
}
