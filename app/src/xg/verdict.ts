// End-of-match analytics (spec §9). Pure — unit-tested in verdict.test.ts.

import type { Match, Player, Shot, Side } from "../db/schema";

export interface TeamAgg {
  side: Side;
  name: string;
  shots: number;
  xg: number;
  goals: number;
}

export interface PlayerAgg {
  playerId: string;
  name: string;
  number: number | null;
  side: Side;
  shots: number;
  xg: number;
  xgPerShot: number;
  biggest: number;
  goals: number;
  finishingDelta: number; // goals - xg
}

export function teamAggs(match: Match, shots: Shot[]): { home: TeamAgg; away: TeamAgg } {
  const mk = (side: Side, name: string): TeamAgg => {
    const s = shots.filter((x) => x.side === side);
    return {
      side,
      name,
      shots: s.length,
      xg: round2(sum(s.map((x) => x.xg))),
      goals: s.filter((x) => x.outcome === "goal").length,
    };
  };
  return { home: mk("home", match.homeName), away: mk("away", match.awayName) };
}

/** Spec §9 verdict string. */
export function verdictLine(home: TeamAgg, away: TeamAgg): string {
  const diff = home.xg - away.xg;
  const [hi, lo] = diff >= 0 ? [home, away] : [away, home];
  const absDiff = Math.abs(diff);

  const scoreWinner =
    home.goals === away.goals ? null : home.goals > away.goals ? home : away;
  const xgWinner = absDiff < 1e-9 ? null : hi;

  if (absDiff < 0.3) {
    return home.goals === away.goals
      ? "Even game on chances, and the scoreline agreed."
      : `Even game on chances — ${scoreWinner!.name} took theirs.`;
  }

  if (home.goals === away.goals) {
    return absDiff >= 0.75
      ? `${hi.name} will feel they should have won — ${fmt(hi.xg)} xG to ${fmt(lo.xg)}.`
      : `Honours even, ${hi.name} shading the chances ${fmt(hi.xg)}–${fmt(lo.xg)}.`;
  }

  if (scoreWinner && xgWinner && scoreWinner.side === xgWinner.side) {
    return `Deserved result — ${hi.name} led the expected-goals count ${fmt(hi.xg)}–${fmt(lo.xg)}.`;
  }

  // score winner is not the xG winner
  const robbed = scoreWinner!.side === lo.side; // team that won on the board also trailed xG
  if (robbed && absDiff >= 0.75) {
    return `Smash-and-grab — ${scoreWinner!.name} won on the scoreboard but ${hi.name} `
      + `created the better chances (${fmt(hi.xg)}–${fmt(lo.xg)}).`;
  }
  return `${scoreWinner!.name} edged it despite ${hi.name} leading xG ${fmt(hi.xg)}–${fmt(lo.xg)}.`;
}

export function playerLeaderboard(shots: Shot[], players: Player[]): PlayerAgg[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const groups = new Map<string, Shot[]>();
  for (const s of shots) {
    if (!s.playerId) continue;
    let bucket = groups.get(s.playerId);
    if (!bucket) groups.set(s.playerId, (bucket = []));
    bucket.push(s);
  }
  const out: PlayerAgg[] = [];
  for (const [pid, s] of groups) {
    const p = byId.get(pid);
    const xg = sum(s.map((x) => x.xg));
    const goals = s.filter((x) => x.outcome === "goal").length;
    out.push({
      playerId: pid,
      name: p?.name ?? "Unknown",
      number: p?.number ?? null,
      side: p?.side ?? s[0].side,
      shots: s.length,
      xg: round2(xg),
      xgPerShot: round2(xg / s.length),
      biggest: round2(Math.max(...s.map((x) => x.xg))),
      goals,
      finishingDelta: round2(goals - xg),
    });
  }
  return out.sort((a, b) => b.xg - a.xg);
}

export const bestXgPlayer = (board: PlayerAgg[]): PlayerAgg | null => board[0] ?? null;

export function efficiencyPick(board: PlayerAgg[], minShots = 3): PlayerAgg | null {
  const eligible = board.filter((p) => p.shots >= minShots);
  return eligible.length
    ? eligible.reduce((a, b) => (b.xgPerShot > a.xgPerShot ? b : a))
    : null;
}

// --- helpers -------------------------------------------------------
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => x.toFixed(2);
