import { useEffect, useState } from "react";

import { ShotEntry } from "../components/ShotEntry";
import { usePlayers, useShots } from "../db/hooks";
import {
  deleteShot, elapsedMinute, finishMatch, type Match, setClockMinute, toggleClock,
} from "../db/schema";
import { teamAggs } from "../xg/verdict";

export function LiveScreen({ match, onReport }: { match: Match; onReport: () => void }) {
  const players = usePlayers(match.id);
  const shots = useShots(match.id);
  const [, tick] = useState(0);

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
            {match.clockStartedAt ? "⏸" : "▶"} {minute}′
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

      <ShotEntry match={match} players={players} minute={minute} onSaved={() => tick((n) => n + 1)} />

      <section>
        <h3>
          Shots <span className="muted">· {shots.length}</span>
        </h3>
        <ul className="shotlog">
          {[...shots].reverse().map((s) => (
            <li key={s.id}>
              <span className={`dot ${s.outcome}`} />
              <span className="min">{s.minute}′</span>
              <span className="who">{nameOf(s.playerId)}</span>
              <span className="sxg">{s.xg.toFixed(2)}</span>
              <span className="oc">{s.outcome.replace("_", " ")}</span>
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
