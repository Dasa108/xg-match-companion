import { useState } from "react";

import { addPlayer, type Player, removePlayer, updatePlayer } from "../db/schema";

interface Props {
  matchId: string;
  side: "home" | "away";
  name: string;
  players: Player[];
}

export function TeamSheet({ matchId, side, name, players }: Props) {
  const [pname, setPname] = useState("");
  const [pnum, setPnum] = useState("");

  const roster = [...players].sort(
    (a, b) => Number(b.role === "start") - Number(a.role === "start") || (a.number ?? 99) - (b.number ?? 99),
  );

  async function add() {
    const trimmed = pname.trim();
    if (!trimmed) return;
    await addPlayer(matchId, side, {
      name: trimmed,
      number: pnum.trim() ? Number(pnum) : null,
      role: "start",
    });
    setPname("");
    setPnum("");
  }

  return (
    <div className="sheet">
      <h3>
        {name} <span className="muted">· {players.length}</span>
      </h3>

      <ul>
        {roster.map((p) => (
          <li key={p.id}>
            <input
              className="num"
              inputMode="numeric"
              value={p.number ?? ""}
              onChange={(e) => updatePlayer(p.id, { number: e.target.value ? Number(e.target.value) : null })}
            />
            <input
              className="pn"
              value={p.name}
              onChange={(e) => updatePlayer(p.id, { name: e.target.value })}
            />
            <button
              className={`mini ${p.role === "start" ? "on" : ""}`}
              onClick={() =>
                updatePlayer(p.id, {
                  role: p.role === "start" ? "sub" : "start",
                  onPitch: p.role !== "start",
                })
              }
              title="starter / sub"
            >
              {p.role === "start" ? "XI" : "sub"}
            </button>
            <button className="mini danger" onClick={() => removePlayer(p.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="addrow">
        <input
          className="num"
          inputMode="numeric"
          placeholder="#"
          value={pnum}
          onChange={(e) => setPnum(e.target.value)}
        />
        <input
          className="pn"
          placeholder="add player"
          value={pname}
          onChange={(e) => setPname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="mini" onClick={add}>
          +
        </button>
      </div>
    </div>
  );
}
