import { TeamSheet } from "../components/TeamSheet";
import { usePlayers } from "../db/hooks";
import { type Match, startMatch } from "../db/schema";

export function SetupScreen({ match, onLive }: { match: Match; onLive: () => void }) {
  const players = usePlayers(match.id);
  const home = players.filter((p) => p.side === "home");
  const away = players.filter((p) => p.side === "away");
  const ready = home.length > 0 && away.length > 0;

  return (
    <div className="screen">
      <section className="card">
        <h2>
          {match.homeName} v {match.awayName}
        </h2>
        <p className="muted">
          {match.date} · {match.label}
        </p>
        <p className="muted">
          Enter both line-ups. Names + numbers can be edited any time (subs come on from the bench during the match).
        </p>
      </section>

      <div className="sheets">
        <TeamSheet matchId={match.id} side="home" name={match.homeName} players={home} />
        <TeamSheet matchId={match.id} side="away" name={match.awayName} players={away} />
      </div>

      <button
        className="primary big"
        disabled={!ready}
        onClick={async () => {
          await startMatch(match.id);
          onLive();
        }}
      >
        {ready ? "Kick off →" : "add at least one player per side"}
      </button>
    </div>
  );
}
