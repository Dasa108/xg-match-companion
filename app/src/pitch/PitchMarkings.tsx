// Full-pitch line markings in the 80x120 portrait SVG frame (see geometry.ts).
// Attacking goal is at the top (y = 0). Markup lives in pitchMarkingsSvg.ts so the
// standalone downloadable match report can embed the identical drawing.

import { PITCH_MARKINGS_SVG } from "./pitchMarkingsSvg";

export function PitchMarkings() {
  // eslint-disable-next-line react/no-danger -- static, module-owned markup, no user input
  return <g dangerouslySetInnerHTML={{ __html: PITCH_MARKINGS_SVG }} />;
}
