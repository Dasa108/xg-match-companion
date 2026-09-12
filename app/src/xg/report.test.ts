import { describe, expect, it } from "vitest";

import type { Shot } from "../db/schema";
import { matchToJson, shotsToCsv } from "./exportMatch";
import { confidenceBand, explainXg } from "./reason";
import { cumulativeXgSeries, xgHistogram } from "./report";
import type { Match } from "../db/schema";

const S = (side: "home" | "away", minute: number, xg: number, outcome: Shot["outcome"] = "saved"): Shot => ({
  id: `${side}-${minute}-${xg}`, matchId: "m", side, playerId: side === "home" ? "p1" : null, minute,
  input: { x: 108, y: 40, shot_type: "open_play", play_pattern: "regular_play", body_part: "right_foot", under_pressure: false },
  features: { distance: 12, angle: 0.6 }, bucket: "minimal", xg, raw: xg, outcome, createdAt: minute,
});

describe("cumulativeXgSeries", () => {
  it("accumulates per side and pads to the end minute", () => {
    const pts = cumulativeXgSeries([S("home", 10, 0.2), S("away", 20, 0.1), S("home", 30, 0.3)], 90);
    expect(pts[0]).toEqual({ minute: 0, home: 0, away: 0 });
    expect(pts[pts.length - 1]).toMatchObject({ minute: 90 });
    expect(pts[pts.length - 1].home).toBeCloseTo(0.5, 5);
    expect(pts[pts.length - 1].away).toBeCloseTo(0.1, 5);
  });
});

describe("xgHistogram", () => {
  it("bins shots by xG per side", () => {
    const bins = xgHistogram([S("home", 1, 0.03), S("home", 2, 0.15), S("away", 3, 0.15), S("away", 4, 0.9)]);
    expect(bins[0].home).toBe(1); // 0.00–0.05
    const mid = bins.find((b) => 0.15 >= b.lo && 0.15 < b.hi)!;
    expect(mid.home).toBe(1);
    expect(mid.away).toBe(1);
    expect(bins[bins.length - 1].away).toBe(1); // 0.60–1.00
  });
});

describe("explainXg / confidenceBand", () => {
  it("headlines the biggest factor", () => {
    expect(explainXg({ distance: 3, angle: 0.9, open_goal: 1 }, "full")).toMatch(/open goal/);
    expect(explainXg({ distance: 34, angle: 0.2 }, "minimal")).toMatch(/long range/);
    expect(explainXg({}, "penalty")).toBe("penalty");
  });
  it("band widens as inputs thin out", () => {
    const w = (b: Parameters<typeof confidenceBand>[1]) => {
      const [lo, hi] = confidenceBand(0.4, b);
      return hi - lo;
    };
    expect(w("minimal")).toBeGreaterThan(w("partial"));
    expect(w("partial")).toBeGreaterThan(w("full"));
  });
});

describe("export", () => {
  const match: Match = {
    id: "m", date: "2026-09-10", label: "friendly", venue: "",
    homeName: "Rovers", awayName: "City", status: "finished", createdAt: 0,
    clockStartedAt: null, clockAccumMs: 0, halfLengthMin: 45, currentHalf: 1,
  };
  const players = [
    { id: "p1", matchId: "m", side: "home" as const, name: "Ada", number: 9, role: "start" as const, onPitch: true },
  ];
  const shots = [S("home", 10, 0.34, "goal"), S("away", 22, 0.08)];

  it("JSON export round-trips and carries a verdict", () => {
    const parsed = JSON.parse(matchToJson(match, players, shots));
    expect(parsed.schema).toBe("xg-match-companion/v1");
    expect(parsed.shots).toHaveLength(2);
    expect(parsed.summary.verdict).toBeTypeOf("string");
  });

  it("CSV has a header and one row per shot, quoting where needed", () => {
    const csv = shotsToCsv(match, [{ ...players[0], name: "O'Neil, A" }], shots);
    const lines = csv.split("\n");
    expect(lines[0].startsWith("match,date,minute")).toBe(true);
    expect(lines).toHaveLength(3);
    expect(csv).toContain('"O\'Neil, A"');
  });
});
