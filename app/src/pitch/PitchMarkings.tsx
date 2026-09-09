// Full-pitch line markings in the 80x120 portrait SVG frame (see geometry.ts).
// Attacking goal is at the top (y = 0).

export function PitchMarkings() {
  return (
    <>
      <rect x={-4} y={-5} width={88} height={130} fill="#0b7a43" />
      {/* faint mow bands down the length */}
      {[0, 15, 30, 45, 60, 75, 90, 105].map((y) => (
        <rect key={y} x={0} y={y} width={80} height={15} fill="#0a7040" opacity={(y / 15) % 2 ? 0.35 : 0} />
      ))}

      <g stroke="#eafff2" strokeWidth={0.4} fill="none" opacity={0.9}>
        {/* boundary + halfway */}
        <rect x={0} y={0} width={80} height={120} />
        <line x1={0} y1={60} x2={80} y2={60} />
        <circle cx={40} cy={60} r={10} />
        <circle cx={40} cy={60} r={0.5} fill="#eafff2" />

        {/* attacking end (top) */}
        <rect x={18} y={0} width={44} height={18} />
        <rect x={30} y={0} width={20} height={6} />
        <circle cx={40} cy={12} r={0.5} fill="#eafff2" />
        <path d="M 32 18 A 10 10 0 0 0 48 18" />

        {/* own end (bottom) */}
        <rect x={18} y={102} width={44} height={18} />
        <rect x={30} y={114} width={20} height={6} />
        <circle cx={40} cy={108} r={0.5} fill="#eafff2" />
        <path d="M 32 102 A 10 10 0 0 1 48 102" />
      </g>

      {/* goals */}
      <line x1={36} y1={0} x2={44} y2={0} stroke="#ffffff" strokeWidth={1.1} />
      <line x1={36} y1={120} x2={44} y2={120} stroke="#ffffff" strokeWidth={0.9} opacity={0.7} />
    </>
  );
}
