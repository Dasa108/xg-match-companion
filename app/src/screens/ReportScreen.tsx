import { usePlayers, useShots } from "../db/hooks";
import { type Match, reopenMatch } from "../db/schema";
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
        </div>
        <p className="verdict">{verdictLine(home, away)}</p>
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
              <th>player</th>
              <th>sh</th>
              <th>xG</th>
              <th>xG/sh</th>
              <th>G</th>
              <th>G−xG</th>
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
              </tr>
            ))}
            {board.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No attributed shots.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Shot map</h3>
        <ShotMap shots={shots} />
      </section>

      <button className="ghost big" onClick={async () => { await reopenMatch(match.id); onLive(); }}>
        ← reopen match
      </button>
    </div>
  );
}

function ShotMap({ shots }: { shots: { input: { x: number; y: number }; xg: number; side: string; outcome: string }[] }) {
  return (
    <svg className="pitch" viewBox="58 -3 66 86" role="img" aria-label="Shot map">
      <rect x={58} y={-3} width={66} height={86} fill="#0b7a43" />
      <g stroke="#eafff2" strokeWidth={0.4} fill="none" opacity={0.9}>
        <line x1={60} y1={0} x2={60} y2={80} />
        <rect x={102} y={18} width={18} height={44} />
        <rect x={114} y={30} width={6} height={20} />
        <line x1={120} y1={36} x2={120} y2={44} stroke="#fff" strokeWidth={0.9} />
      </g>
      {shots.map((s, i) => (
        <circle
          key={i}
          cx={s.input.x}
          cy={s.input.y}
          r={1 + s.xg * 6}
          fill={s.outcome === "goal" ? "#ffd34d" : s.side === "home" ? "#35d07f" : "#1f9dff"}
          opacity={0.75}
          stroke="#06231a"
          strokeWidth={0.2}
        />
      ))}
    </svg>
  );
}
