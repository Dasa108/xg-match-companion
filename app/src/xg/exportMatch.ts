// Match export — full JSON and a flat shots CSV (spec §5.4). Pure string builders.

import type { Match, Player, Shot } from "../db/schema";
import { playerLeaderboard, teamAggs, verdictLine } from "./verdict";

export function matchToJson(match: Match, players: Player[], shots: Shot[]): string {
  const { home, away } = teamAggs(match, shots);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schema: "xg-match-companion/v1",
      match,
      summary: { home, away, verdict: verdictLine(home, away) },
      players,
      leaderboard: playerLeaderboard(shots, players),
      shots,
    },
    null,
    2,
  );
}

const CSV_COLS = [
  "match", "date", "minute", "side", "team", "number", "player",
  "x", "y", "shot_type", "body_part", "under_pressure",
  "bucket", "xg", "raw", "outcome", "is_goal",
] as const;

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function shotsToCsv(match: Match, players: Player[], shots: Shot[]): string {
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [...shots]
    .sort((a, b) => a.minute - b.minute || a.createdAt - b.createdAt)
    .map((s) => {
      const p = s.playerId ? byId.get(s.playerId) : undefined;
      return [
        match.label, match.date, s.minute, s.side,
        s.side === "home" ? match.homeName : match.awayName,
        p?.number ?? "", p?.name ?? "",
        s.input.x, s.input.y, s.input.shot_type, s.input.body_part, s.input.under_pressure,
        s.bucket, s.xg.toFixed(4), s.raw?.toFixed(4) ?? "", s.outcome, s.outcome === "goal" ? 1 : 0,
      ].map(csvCell).join(",");
    });
  return [CSV_COLS.join(","), ...rows].join("\n");
}

/** Browser download of a text blob (the app is the user's own; a plain anchor is fine). */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugMatch(m: Match): string {
  return `${m.date}_${m.homeName}-v-${m.awayName}`.replace(/[^\w.-]+/g, "_");
}
