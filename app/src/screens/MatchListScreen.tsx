import { useState } from "react";

import { Icon } from "../components/Icon";
import { useMatches } from "../db/hooks";
import { createMatch, deleteMatch } from "../db/schema";

interface Props {
  onOpen: (id: string) => void;
  offlineMode: boolean;
  onSetOfflineMode: (on: boolean) => void;
}

export function MatchListScreen({ onOpen, offlineMode, onSetOfflineMode }: Props) {
  const matches = useMatches();
  const [label, setLabel] = useState("");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [halfLength, setHalfLength] = useState("45");

  async function create() {
    if (!home.trim() || !away.trim()) return;
    const id = await createMatch({
      date: new Date().toISOString().slice(0, 10),
      label: label.trim() || "Match",
      venue: "",
      homeName: home.trim(),
      awayName: away.trim(),
      halfLengthMin: Number(halfLength) || 45,
    });
    setLabel("");
    setHome("");
    setAway("");
    setHalfLength("45");
    onOpen(id);
  }

  return (
    <div className="screen">
      <section className="card">
        <h2>New match</h2>
        <input placeholder="label (e.g. U16 league, R2)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="row gap">
          <input placeholder="home team" value={home} onChange={(e) => setHome(e.target.value)} />
          <input placeholder="away team" value={away} onChange={(e) => setAway(e.target.value)} />
        </div>
        <label className="row gap halflen">
          <span className="muted">half length</span>
          <input
            type="number"
            min={1}
            max={60}
            inputMode="numeric"
            value={halfLength}
            onChange={(e) => setHalfLength(e.target.value)}
          />
          <span className="muted">min</span>
        </label>
        <button className="primary" onClick={create} disabled={!home.trim() || !away.trim()}>
          Create
        </button>
      </section>

      <section>
        <h2>Matches</h2>
        {matches.length === 0 && (
          <p className="empty">
            <Icon name="football" size={22} className="empty-icon" />
            <br />
            No matches yet — create one above to kick off.
          </p>
        )}
        <ul className="matches">
          {matches.map((m) => (
            <li key={m.id}>
              <button className="matchrow" onClick={() => onOpen(m.id)}>
                <span className="teams">
                  {m.homeName} v {m.awayName}
                </span>
                <span className="sub">
                  {m.date} · {m.label} · <span className={`badge ${m.status}`}>{m.status}</span>
                </span>
              </button>
              <button
                className="mini danger"
                onClick={() => confirm(`Delete ${m.homeName} v ${m.awayName}?`) && deleteMatch(m.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="offline-setting">
        <p className="muted">
          {offlineMode
            ? "Offline mode is on — the app caches itself so it keeps working with no signal, but may show an older version until you reload."
            : "Offline mode is off — always loads the latest version, but needs a connection every time."}
        </p>
        <button className="mini ghost" onClick={() => onSetOfflineMode(!offlineMode)}>
          {offlineMode ? "Turn off & reload" : "Turn on & reload"}
        </button>
      </section>
    </div>
  );
}
