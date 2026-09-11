// Small shot-outcome glyph for list rows — shape + color (never color-alone).

import type { Outcome } from "../db/schema";
import { outcomeMarker, OUTCOME_COLOR } from "../pitch/outcomeMarker";

export function OutcomeGlyph({ outcome, size = 12 }: { outcome: Outcome; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-5 -5 10 10"
      className="outcome-glyph"
      role="img"
      aria-label={outcome.replace("_", " ")}
      // eslint-disable-next-line react/no-danger -- generated shape markup, no user input
      dangerouslySetInnerHTML={{ __html: outcomeMarker(outcome, 0, 0, 4, OUTCOME_COLOR[outcome]) }}
    />
  );
}
