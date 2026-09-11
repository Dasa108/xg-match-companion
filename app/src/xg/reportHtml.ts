// The downloadable full match report — a single self-contained HTML file with everything
// collected during the match: score, verdict, xG timeline, shot map, the player leaderboard
// (incl. PSxG where placed), and a complete per-shot data table. No server, no external
// assets — opens from disk, and prints/saves-as-PDF cleanly (a plain "text/html" download,
// same mechanism as the JSON/CSV export).

import type { Match, Player, Shot } from "../db/schema";
import { toSvg } from "../pitch/geometry";
import { outcomeMarker } from "../pitch/outcomeMarker";
import { PITCH_MARKINGS_SVG } from "../pitch/pitchMarkingsSvg";
import { cumulativeXgSeries } from "./report";
import { bestXgPlayer, efficiencyPick, playerLeaderboard, teamAggs, verdictLine } from "./verdict";

// Same validated categorical palette as the live app (process.md has the CVD check).
const HOME = "#1fae66", AWAY = "#2c86d1", GOAL = "#bd8a12";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function timelineSvg(shots: Shot[], endMinute: number, homeName: string, awayName: string): string {
  const points = cumulativeXgSeries(shots, endMinute);
  const W = 640, H = 220, padL = 34, padR = 12, padT = 10, padB = 26;
  const end = Math.max(1, points[points.length - 1]?.minute ?? 1);
  const maxXg = Math.max(0.5, ...points.map((p) => Math.max(p.home, p.away)));
  const sx = (m: number) => padL + (m / end) * (W - padL - padR);
  const sy = (v: number) => H - padB - (v / maxXg) * (H - padT - padB);
  const step = (key: "home" | "away") => {
    let d = `M ${sx(points[0].minute)} ${sy(points[0][key])}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${sx(points[i].minute)} ${sy(points[i - 1][key])} L ${sx(points[i].minute)} ${sy(points[i][key])}`;
    }
    return d;
  };
  const gridlines = [0, 0.5, 1]
    .map((f) => {
      const v = maxXg * f;
      return `<line x1="${padL}" x2="${W - padR}" y1="${sy(v)}" y2="${sy(v)}" stroke="#33443c" stroke-width="1"/>`
        + `<text x="2" y="${sy(v) + 4}" fill="#93ab9f" font-size="11">${v.toFixed(1)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:640px">
    ${gridlines}
    <line x1="${padL}" x2="${W - padR}" y1="${sy(0)}" y2="${sy(0)}" stroke="#33443c"/>
    <text x="${padL}" y="${H - 6}" fill="#93ab9f" font-size="11">0'</text>
    <text x="${W - padR}" y="${H - 6}" fill="#93ab9f" font-size="11" text-anchor="end">${end}'</text>
    <path d="${step("home")}" fill="none" stroke="${HOME}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="${step("away")}" fill="none" stroke="${AWAY}" stroke-width="2.5" stroke-linecap="round"/>
    <text x="${padL}" y="16" fill="${HOME}" font-size="12" font-weight="700">${esc(homeName)}</text>
    <text x="${padL + 90}" y="16" fill="${AWAY}" font-size="12" font-weight="700">${esc(awayName)}</text>
  </svg>`;
}

function shotMapSvg(shots: Shot[]): string {
  const dots = shots
    .map((s) => {
      const [cx, cy] = toSvg(s.input.x, s.input.y);
      const fill = s.outcome === "goal" ? GOAL : s.side === "home" ? HOME : AWAY;
      return outcomeMarker(s.outcome, cx, cy, 1 + s.xg * 6, fill);
    })
    .join("\n");
  return `<svg viewBox="-4 -5 88 130" width="100%" style="max-width:340px;border-radius:8px">
    ${PITCH_MARKINGS_SVG}
    ${dots}
  </svg>
  <p class="meta" style="margin-top:6px">shape = outcome (★ goal, ● saved, ◆ post, ▲ blocked, ○ off target) · colour = team · size ∝ xG</p>`;
}

export function buildReportHtml(match: Match, players: Player[], shots: Shot[]): string {
  const { home, away } = teamAggs(match, shots);
  const board = playerLeaderboard(shots, players);
  const best = bestXgPlayer(board);
  const eff = efficiencyPick(board);
  const verdict = verdictLine(home, away);
  const hasPsxg = board.some((p) => p.psxg != null);
  const byId = new Map(players.map((p) => [p.id, p]));
  const sortedShots = [...shots].sort((a, b) => a.minute - b.minute || a.createdAt - b.createdAt);

  const playerRows = board
    .map((p) => `<tr>
      <td>${p.number != null ? esc(p.number) + ". " : ""}${esc(p.name)}
        <span class="muted"> · ${p.side === "home" ? esc(home.name) : esc(away.name)}</span></td>
      <td>${p.shots}</td><td>${p.xg.toFixed(2)}</td><td>${p.xgPerShot.toFixed(2)}</td>
      <td>${p.goals}</td>
      <td class="${p.finishingDelta >= 0 ? "pos" : "neg"}">${p.finishingDelta >= 0 ? "+" : ""}${p.finishingDelta.toFixed(2)}</td>
      ${hasPsxg ? `<td>${p.psxg != null ? p.psxg.toFixed(2) : "—"}</td>` : ""}
    </tr>`)
    .join("\n");

  const shotRows = sortedShots
    .map((s) => {
      const p = s.playerId ? byId.get(s.playerId) : undefined;
      const teamName = s.side === "home" ? home.name : away.name;
      return `<tr>
        <td>${s.minute}'</td>
        <td>${esc(teamName)}</td>
        <td>${p ? (p.number != null ? esc(p.number) + ". " : "") + esc(p.name) : "—"}</td>
        <td>${s.input.x.toFixed(1)}, ${s.input.y.toFixed(1)}</td>
        <td>${esc(s.input.shot_type)}</td>
        <td>${esc(s.input.body_part)}</td>
        <td>${s.input.under_pressure ? "yes" : "no"}</td>
        <td>${esc(s.bucket)}</td>
        <td>${s.xg.toFixed(3)}</td>
        <td>${esc(s.outcome.replace("_", " "))}</td>
        <td>${s.psxg != null ? s.psxg.toFixed(3) : "—"}</td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(match.homeName)} v ${esc(match.awayName)} — xG report</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0a0f0c; color:#f2f7f4; font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 18px 60px; }
  h1 { font-size: 21px; margin: 0 0 2px; font-weight: 800; letter-spacing: -0.01em; }
  h2 { font-size: 13px; margin: 30px 0 10px; border-top: 1px solid #2b3a33; padding-top: 18px;
       text-transform: uppercase; letter-spacing: .07em; color: #93ab9f; font-weight: 700; }
  .muted { color: #93ab9f; }
  .card {
    background: radial-gradient(90% 160% at 0% 0%, rgba(31,174,102,.16), transparent 60%),
                radial-gradient(90% 160% at 100% 0%, rgba(44,134,209,.16), transparent 60%), #182922;
    border:1px solid #2b3a33; border-radius:18px; padding:20px; text-align:center;
  }
  .ftscore { font-size: 15px; margin: 8px 0 4px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .ftscore b { font-size: 40px; font-weight: 900; letter-spacing: -.02em; margin: 0 10px; font-variant-numeric: tabular-nums; }
  .verdict { margin: 12px 0 0; font-size: 14.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: right; padding: 7px 8px; border-bottom: 1px solid #2b3a33; font-variant-numeric: tabular-nums; }
  th { color:#93ab9f; font-size:11px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3) { text-align: left; font-variant-numeric: normal; }
  tbody tr:nth-child(even) { background: rgba(255,255,255,.025); }
  .pos { color: #bd8a12; font-weight:700; } .neg { color: #e2465c; font-weight:700; }
  .meta { color:#93ab9f; font-size:12px; margin-top:16px; }
  @media print {
    body { background:#fff; color:#111; }
    .card { background:#fff; }
    table { background:#fff; }
    th, td { border-color:#ccc; }
    .muted, h2 { color:#555; }
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(match.homeName)} v ${esc(match.awayName)}</h1>
  <p class="muted">${esc(match.date)} · ${esc(match.label)}${match.venue ? " · " + esc(match.venue) : ""}</p>

  <div class="card">
    <div class="ftscore">${esc(home.name)} <b>${home.goals} – ${away.goals}</b> ${esc(away.name)}</div>
    <div class="muted">xG ${home.xg.toFixed(2)} – ${away.xg.toFixed(2)} · ${home.shots + away.shots} shots
      ${hasPsxg ? ` · PSxG ${home.psxg?.toFixed(2) ?? "—"} – ${away.psxg?.toFixed(2) ?? "—"}` : ""}</div>
    <p class="verdict">${esc(verdict)}</p>
  </div>

  <h2>xG timeline</h2>
  ${timelineSvg(shots, shots.reduce((m, s) => Math.max(m, s.minute), 0), home.name, away.name)}

  <h2>Shot map</h2>
  ${shotMapSvg(shots)}

  <h2>Player xG</h2>
  ${best ? `<p class="muted">Best xG: <b>${esc(best.name)}</b> (${best.xg.toFixed(2)} from ${best.shots}).`
    + (eff && eff.playerId !== best.playerId
        ? ` Most efficient: <b>${esc(eff.name)}</b> (${eff.xgPerShot.toFixed(2)}/shot).` : "") + "</p>" : ""}
  <table>
    <thead><tr><th>player</th><th>sh</th><th>xG</th><th>xG/sh</th><th>G</th><th>G−xG</th>${hasPsxg ? "<th>PSxG</th>" : ""}</tr></thead>
    <tbody>${playerRows || `<tr><td colspan="${hasPsxg ? 7 : 6}" class="muted">No attributed shots.</td></tr>`}</tbody>
  </table>

  <h2>Every shot</h2>
  <table>
    <thead><tr>
      <th>min</th><th>team</th><th>player</th><th>x, y</th><th>situation</th><th>body</th>
      <th>pressure</th><th>bucket</th><th>xG</th><th>outcome</th><th>PSxG</th>
    </tr></thead>
    <tbody>${shotRows || `<tr><td colspan="11" class="muted">No shots logged.</td></tr>`}</tbody>
  </table>

  <p class="meta">Generated by xG Match Companion, ${new Date().toISOString()}. All data was collected and
    computed on the operator's device; nothing here was sent to a server.</p>
</div>
</body>
</html>`;
}
