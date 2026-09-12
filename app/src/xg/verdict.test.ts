import { describe, expect, it } from "vitest";

import type { Match, Player, Shot } from "../db/schema";
import { efficiencyPick, playerLeaderboard, teamAggs, verdictLine } from "./verdict";

const match: Match = {
  id: "m", date: "2026-09-10", label: "friendly", venue: "",
  homeName: "Rovers", awayName: "City", status: "finished",
  createdAt: 0, clockStartedAt: null, clockAccumMs: 0, halfLengthMin: 45, currentHalf: 1,
};

function shot(side: "home" | "away", xg: number, outcome: Shot["outcome"], playerId: string | null = null): Shot {
  return {
    id: Math.random().toString(), matchId: "m", side, playerId, minute: 1,
    input: {} as Shot["input"], features: {}, bucket: "full", xg, raw: xg, outcome, createdAt: 0,
  };
}

describe("teamAggs", () => {
  it("sums xg and counts goals per side", () => {
    const { home, away } = teamAggs(match, [
      shot("home", 0.4, "goal"), shot("home", 0.1, "saved"), shot("away", 0.2, "off_target"),
    ]);
    expect(home.shots).toBe(2);
    expect(home.xg).toBeCloseTo(0.5, 5);
    expect(home.goals).toBe(1);
    expect(away.xg).toBeCloseTo(0.2, 5);
    expect(away.goals).toBe(0);
  });
});

describe("verdictLine", () => {
  const T = (side: "home" | "away", name: string, xg: number, goals: number) =>
    ({ side, name, xg, goals, shots: 0, psxg: null, psxgShots: 0 });

  it("close xG -> even game", () => {
    expect(verdictLine(T("home", "R", 1.2, 1), T("away", "C", 1.1, 1))).toMatch(/Even game/);
  });
  it("xG winner == score winner -> deserved", () => {
    expect(verdictLine(T("home", "R", 2.4, 2), T("away", "C", 0.6, 0))).toMatch(/Deserved/);
  });
  it("score winner trailed xG by a lot -> smash-and-grab", () => {
    const line = verdictLine(T("home", "Rovers", 0.5, 2), T("away", "City", 1.9, 1));
    expect(line).toMatch(/Smash-and-grab/);
    expect(line).toMatch(/City created the better/);
  });
  it("draw with a big xG gap -> should have won", () => {
    expect(verdictLine(T("home", "R", 2.1, 1), T("away", "C", 1.0, 1))).toMatch(/should have won/);
  });
});

describe("playerLeaderboard", () => {
  const players: Player[] = [
    { id: "p1", matchId: "m", side: "home", name: "Ada", number: 9, role: "start", onPitch: true },
    { id: "p2", matchId: "m", side: "home", name: "Bo", number: 10, role: "start", onPitch: true },
  ];
  const shots = [
    shot("home", 0.5, "goal", "p1"), shot("home", 0.3, "saved", "p1"), shot("home", 0.05, "off_target", "p1"),
    shot("home", 0.7, "goal", "p2"),
  ];

  it("ranks by total xg, computes per-shot + finishing delta", () => {
    const board = playerLeaderboard(shots, players);
    expect(board.map((p) => p.playerId)).toEqual(["p1", "p2"]); // 0.85 vs 0.70
    expect(board[0].xgPerShot).toBeCloseTo(0.28, 2);
    expect(board[0].finishingDelta).toBeCloseTo(0.15, 2); // 1 goal - 0.85 xg
    expect(board[1].finishingDelta).toBeCloseTo(0.3, 2);
  });

  it("efficiency award needs >= 3 shots", () => {
    expect(efficiencyPick(playerLeaderboard(shots, players))?.playerId).toBe("p1");
  });
});
