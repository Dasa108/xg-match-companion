import { ShotMap, XgHistogram, XgTimeline } from "../components/Charts";
import { Icon } from "../components/Icon";
import { usePlayers, useShots } from "../db/hooks";
import { elapsedMinute, type Match, reopenMatch } from "../db/schema";
import { downloadText, matchToJson, shotsToCsv, slugMatch } from "../xg/exportMatch";
import { cumulativeXgSeries, xgHistogram } from "../xg/report";
import { buildReportHtml } from "../xg/reportHtml";
import {
  bestXgPlayer, efficiencyPick, playerLeaderboard, teamAggs, verdictLine,
} from "../xg/verdict";

export function ReportScreen({ match, onLive }: { match: Match; onLive: () => void }) {
  const players = usePlayers(match.id);
  const shots = useShots(match.id);
  const { home, away } = teamAggs(match, shots);
  const board = playerLeaderboard(shots, players);
  const best = bestXgPlayer(board);
  const eff = efficiencyPick(board);
  const timeline = cumulativeXgSeries(shots, elapsedMinute(match) || 90);
  const hist = xgHistogram(shots);
  const hasPsxg = board.some((p) => p.psxg != null);

  return (
    <div className="screen">
      <section className="card center">
        <div className="muted">{match.date} · {match.label}</div>
        <div className="ftscore">
          <span>{home.name}</span>
          <b>{home.goals} – {away.goals}</b>
          <span>{away.name}</span>
        </div>
        <div className="ftxg">
          xG {home.xg.toFixed(2)} – {away.xg.toFixed(2)} · {home.shots + away.shots} shots
          {hasPsxg && (
            <> · PSxG {home.psxg?.toFixed(2) ?? "—"} – {away.psxg?.toFixed(2) ?? "—"}</>
          )}
        </div>
        <p className="verdict">{verdictLine(home, away)}</p>
      </section>

      <section>
        <h3>xG timeline</h3>
        <XgTimeline points={timeline} homeName={home.name} awayName={away.name} />
      </section>

      <section>
        <h3>Shot map</h3>
        <ShotMap shots={shots} />
      </section>

      <section>
        <h3>Chance quality</h3>
        <XgHistogram bins={hist} homeName={home.name} awayName={away.name} />
      </section>

      <section>
        <h3>Player xG</h3>
        {best && (
          <p className="muted">
            Best xG: <b>{best.name}</b> ({best.xg.toFixed(2)} from {best.shots}).
            {eff && eff.playerId !== best.playerId && (
              <> Most efficient: <b>{eff.name}</b> ({eff.xgPerShot.toFixed(2)}/shot).</>
            )}
          </p>
        )}
        <table className="board">
          <thead>
            <tr>
              <th>player</th><th>sh</th><th>xG</th><th>xG/sh</th><th>G</th><th>G−xG</th>
              {hasPsxg && <th>PSxG</th>}
            </tr>
          </thead>
          <tbody>
            {board.map((p) => (
              <tr key={p.playerId}>
                <td>
                  {p.number != null ? `${p.number}. ` : ""}
                  {p.name}
                  <span className="muted"> · {p.side === "home" ? home.name : away.name}</span>
                </td>
                <td>{p.shots}</td>
                <td>{p.xg.toFixed(2)}</td>
                <td>{p.xgPerShot.toFixed(2)}</td>
                <td>{p.goals}</td>
                <td className={p.finishingDelta >= 0 ? "pos" : "neg"}>
                  {p.finishingDelta >= 0 ? "+" : ""}
                  {p.finishingDelta.toFixed(2)}
                </td>
                {hasPsxg && <td>{p.psxg != null ? p.psxg.toFixed(2) : "—"}</td>}
              </tr>
            ))}
            {board.length === 0 && (
              <tr><td colSpan={hasPsxg ? 7 : 6} className="muted">No attributed shots.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Export</h3>
        <p className="muted">The full report has every shot's full data; JSON/CSV are for further analysis.</p>
        <div className="row gap wrap">
          <button
            className="primary"
            onClick={() =>
              downloadText(`${slugMatch(match)}_report.html`, buildReportHtml(match, players, shots), "text/html")
            }
          >
            <Icon name="download" size={15} /> full report
          </button>
          <button
            onClick={() =>
              downloadText(`${slugMatch(match)}.json`, matchToJson(match, players, shots), "application/json")
            }
          >
            match JSON
          </button>
          <button
            onClick={() =>
              downloadText(`${slugMatch(match)}_shots.csv`, shotsToCsv(match, players, shots), "text/csv")
            }
          >
            shots CSV
          </button>
        </div>
      </section>

      <button className="ghost big" onClick={async () => { await reopenMatch(match.id); onLive(); }}>
        <Icon name="chevron" className="rot180" size={14} /> reopen match
      </button>
    </div>
  );
}
