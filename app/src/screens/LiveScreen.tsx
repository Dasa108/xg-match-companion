import { useEffect, useState } from "react";

import { Confetti } from "../components/Confetti";
import { Icon } from "../components/Icon";
import { OutcomeGlyph } from "../components/OutcomeGlyph";
import { ShotEntry } from "../components/ShotEntry";
import { usePlayers, useShots } from "../db/hooks";
import {
  deleteShot, elapsedMinute, finishMatch, type Match, setClockMinute, toggleClock,
} from "../db/schema";
import { warmModel } from "../xg/model";
import { playerLeaderboard, teamAggs } from "../xg/verdict";

export function LiveScreen({ match, onReport }: { match: Match; onReport: () => void }) {
  const players = usePlayers(match.id);
  const shots = useShots(match.id);
  const [, tick] = useState(0);
  const [showPlayers, setShowPlayers] = useState(false);
  const [goalBurst, setGoalBurst] = useState(0);

  useEffect(() => warmModel(), []);

  // keep the clock display ticking while it runs
  useEffect(() => {
    if (!match.clockStartedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [match.clockStartedAt]);

  const minute = elapsedMinute(match);
  const { home, away } = teamAggs(match, shots);
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="screen">
      <div className="scoreboard">
        <Team a={home} />
        <div className="clock">
          <button className="mini" onClick={() => toggleClock(match)}>
            <Icon name={match.clockStartedAt ? "pause" : "play"} size={13} />
            <span className="tnum">{minute}′</span>
          </button>
          <button
            className="mini ghost"
            onClick={() => {
              const v = prompt("set minute", String(minute));
              if (v != null && !Number.isNaN(Number(v))) setClockMinute(match.id, Number(v));
            }}
          >
            edit
          </button>
        </div>
        <Team a={away} right />
      </div>

      {goalBurst > 0 && <Confetti key={goalBurst} />}

      <ShotEntry
        match={match}
        players={players}
        minute={minute}
        onSaved={(outcome) => {
          tick((n) => n + 1);
          if (outcome === "goal") setGoalBurst((n) => n + 1);
        }}
      />

      <section>
        <h3 className="row spread">
          <span>Players</span>
          <button className="mini ghost" onClick={() => setShowPlayers((v) => !v)}>
            {showPlayers ? "hide" : "show xG"}
          </button>
        </h3>
        {showPlayers && (
          <table className="board">
            <thead>
              <tr><th>player</th><th>sh</th><th>xG</th><th>G</th></tr>
            </thead>
            <tbody>
              {playerLeaderboard(shots, players).map((p) => (
                <tr key={p.playerId}>
                  <td>
                    {p.number != null ? `${p.number}. ` : ""}{p.name}
                    <span className="muted"> · {p.side === "home" ? home.name : away.name}</span>
                  </td>
                  <td>{p.shots}</td>
                  <td>{p.xg.toFixed(2)}</td>
                  <td>{p.goals}</td>
                </tr>
              ))}
              {shots.length === 0 && <tr><td colSpan={4} className="muted">No shots yet.</td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>
          Shots <span className="muted">· {shots.length}</span>
        </h3>
        <ul className="shotlog">
          {[...shots].reverse().map((s) => (
            <li key={s.id}>
              <OutcomeGlyph outcome={s.outcome} />
              <span className="min">{s.minute}′</span>
              <span className="who">{nameOf(s.playerId)}</span>
              <span className="sxg">{s.xg.toFixed(2)}</span>
              <span className="oc">
                {s.outcome.replace("_", " ")}
                {s.psxg != null && <span className="psxg-tag"> · PSxG {s.psxg.toFixed(2)}</span>}
              </span>
              <button className="mini danger" onClick={() => deleteShot(s.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <button
        className="primary big"
        onClick={async () => {
          await finishMatch(match.id);
          onReport();
        }}
      >
        Full time →
      </button>
    </div>
  );
}

function Team({ a, right }: { a: { name: string; xg: number; goals: number; shots: number }; right?: boolean }) {
  return (
    <div className={`sbteam ${right ? "right" : ""}`}>
      <div className="sbname">{a.name}</div>
      <div className="sbgoals">{a.goals}</div>
      <div className="sbxg">
        {a.xg.toFixed(2)} xG · {a.shots} sh
      </div>
    </div>
  );
}
