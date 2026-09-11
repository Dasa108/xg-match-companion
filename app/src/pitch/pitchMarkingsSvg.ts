// Raw SVG markup for the full-pitch line markings (80x120 portrait frame, attacking goal
// at y=0 — see geometry.ts). A plain string so it can be embedded identically in both the
// React pitch components (via dangerouslySetInnerHTML) and the standalone downloadable
// match report (xg/reportHtml.ts), which isn't a React tree.

export const PITCH_MARKINGS_SVG = `
<rect x="-4" y="-5" width="88" height="130" fill="#0b7a43" />
${[0, 15, 30, 45, 60, 75, 90, 105]
  .map((y) => `<rect x="0" y="${y}" width="80" height="15" fill="#0a7040" opacity="${(y / 15) % 2 ? 0.35 : 0}" />`)
  .join("\n")}
<g stroke="#eafff2" stroke-width="0.4" fill="none" opacity="0.9">
  <rect x="0" y="0" width="80" height="120" />
  <line x1="0" y1="60" x2="80" y2="60" />
  <circle cx="40" cy="60" r="10" />
  <circle cx="40" cy="60" r="0.5" fill="#eafff2" />
  <rect x="18" y="0" width="44" height="18" />
  <rect x="30" y="0" width="20" height="6" />
  <circle cx="40" cy="12" r="0.5" fill="#eafff2" />
  <path d="M 32 18 A 10 10 0 0 0 48 18" />
  <rect x="18" y="102" width="44" height="18" />
  <rect x="30" y="114" width="20" height="6" />
  <circle cx="40" cy="108" r="0.5" fill="#eafff2" />
  <path d="M 32 102 A 10 10 0 0 1 48 102" />
</g>
<line x1="36" y1="0" x2="44" y2="0" stroke="#ffffff" stroke-width="1.1" />
<line x1="36" y1="120" x2="44" y2="120" stroke="#ffffff" stroke-width="0.9" opacity="0.7" />
`.trim();
