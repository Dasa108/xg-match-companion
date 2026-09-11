import { describe, expect, it } from "vitest";

import type { Match, Player, Shot } from "../db/schema";
import { buildReportHtml } from "./reportHtml";

const match: Match = {
  id: "m", date: "2026-09-10", label: "friendly", venue: "Sunny Park",
  homeName: "Rovers", awayName: "City", status: "finished",
  createdAt: 0, clockStartedAt: null, clockAccumMs: 0,
};

const players: Player[] = [
  { id: "p1", matchId: "m", side: "home", name: "Ada", number: 9, role: "start", onPitch: true },
];

function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: Math.random().toString(), matchId: "m", side: "home", playerId: "p1", minute: 10,
    input: { x: 108, y: 40, shot_type: "open_play", play_pattern: "regular_play", body_part: "right_foot", under_pressure: false },
    features: { distance: 12 }, bucket: "full", xg: 0.3, raw: 0.3, outcome: "goal", createdAt: 0,
    ...over,
  };
}

describe("buildReportHtml", () => {
  it("is a well-formed, self-contained document with the match data in it", () => {
    const html = buildReportHtml(match, players, [shot()]);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<title>Rovers v City — xG report</title>");
    expect(html).toContain("Ada");
    expect(html).toContain("Sunny Park");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("escapes team/player names so injected markup can't break the document", () => {
    const evilPlayers: Player[] = [{ ...players[0], name: '<script>alert(1)</script>' }];
    const html = buildReportHtml(match, evilPlayers, [shot()]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("adds a PSxG column to the player table only when at least one shot has a placement", () => {
    // the per-shot table always has a PSxG column ("—" when absent); the player
    // leaderboard only gains one when some shot actually has a placement.
    const without = buildReportHtml(match, players, [shot()]);
    expect(without).not.toContain("<th>G−xG</th><th>PSxG</th>");

    const withPsxg = buildReportHtml(match, players, [shot({ psxg: 0.55, psxgRaw: 0.5, psxgBucket: "full" })]);
    expect(withPsxg).toContain("<th>G−xG</th><th>PSxG</th>");
    expect(withPsxg).toContain("0.55");
  });

  it("handles an empty match without crashing", () => {
    const html = buildReportHtml(match, [], []);
    expect(html).toContain("No shots logged.");
    expect(html).toContain("No attributed shots.");
  });
});
