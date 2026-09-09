import { useEffect, useMemo, useState } from "react";

import { Pitch, type Tool } from "./pitch/Pitch";
import { predictXg, warmModel } from "./xg/model";
import type {
  AssistType, BodyPart, PlayPattern, ShotInput, XgResult, XY,
} from "./xg/types";

const BODY: BodyPart[] = ["right_foot", "left_foot", "head", "other"];
const SITUATION: { key: ShotInput["shot_type"]; play: PlayPattern; label: string }[] = [
  { key: "open_play", play: "regular_play", label: "open play" },
  { key: "open_play", play: "from_counter", label: "fast break" },
  { key: "corner", play: "from_corner", label: "corner" },
  { key: "free_kick", play: "from_free_kick", label: "free kick" },
  { key: "penalty", play: "other", label: "penalty" },
];
const PRESSURE = ["none", "light", "heavy"] as const;
const ASSIST: AssistType[] = ["none", "cross", "through_ball", "cutback", "low_pass"];

export function App() {
  const [tool, setTool] = useState<Tool>("shot");
  const [shot, setShot] = useState<XY | null>(null);
  const [gk, setGk] = useState<XY | null>(null);
  const [defenders, setDefenders] = useState<XY[]>([]);

  const [bodyPart, setBodyPart] = useState<BodyPart>("right_foot");
  const [sitIdx, setSitIdx] = useState(0);
  const [pressure, setPressure] = useState<(typeof PRESSURE)[number]>("none");
  const [assist, setAssist] = useState<AssistType | null>(null);
  const [firstTime, setFirstTime] = useState(false);
  const [oneOnOne, setOneOnOne] = useState(false);

  const [result, setResult] = useState<XgResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => warmModel(), []);

  const input: ShotInput | null = useMemo(() => {
    if (!shot) return null;
    const sit = SITUATION[sitIdx];
    const hasFreeze = gk != null || defenders.length > 0;
    return {
      x: shot[0],
      y: shot[1],
      shot_type: sit.key,
      play_pattern: sit.play,
      body_part: bodyPart,
      under_pressure: pressure !== "none",
      freeze_frame: hasFreeze ? { gk, opponents: defenders, teammates_in_box: 0 } : null,
      assist_type: assist,
      context:
        firstTime || oneOnOne
          ? { first_time: firstTime, follows_dribble: false, one_on_one: oneOnOne, open_goal: false, rebound: false }
          : null,
    };
  }, [shot, gk, defenders, bodyPart, sitIdx, pressure, assist, firstTime, oneOnOne]);

  useEffect(() => {
    if (!input) {
      setResult(null);
      return;
    }
    let live = true;
    predictXg(input)
      .then((r) => live && (setResult(r), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [input]);

  function place(p: XY) {
    if (tool === "shot") setShot(p);
    else if (tool === "gk") setGk(p);
    else setDefenders((d) => [...d, p]);
  }

  return (
    <div className="app">
      <header>
        <h1>xG Match Companion</h1>
        <span className="tag">M2 · shot xG demo</span>
      </header>

      <Pitch
        tool={tool}
        shot={shot}
        gk={gk}
        defenders={defenders}
        onPlace={place}
        onRemoveDefender={(i) => setDefenders((d) => d.filter((_, k) => k !== i))}
      />

      <div className="tools">
        {(["shot", "gk", "defender"] as Tool[]).map((t) => (
          <button key={t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
            {t === "shot" ? "◎ shot" : t === "gk" ? "🧤 keeper" : "▲ defender"}
          </button>
        ))}
        <button
          onClick={() => {
            setShot(null);
            setGk(null);
            setDefenders([]);
          }}
        >
          clear
        </button>
      </div>

      <div className="result">
        {err && <p className="err">{err}</p>}
        {!shot && <p className="hint">Tap the pitch to place a shot.</p>}
        {result && (
          <>
            <div className="xg">
              {result.xg.toFixed(2)}
              <span> xG</span>
            </div>
            <div className="meta">
              {result.bucket} inputs
              {result.raw != null && ` · model ${result.raw.toFixed(3)}`}
              {" · "}
              dist {Number(result.features.distance).toFixed(1)} · angle{" "}
              {((Number(result.features.angle) * 180) / Math.PI).toFixed(0)}°
            </div>
          </>
        )}
      </div>

      <fieldset>
        <legend>body part</legend>
        {BODY.map((b) => (
          <Chip key={b} on={bodyPart === b} onClick={() => setBodyPart(b)} label={b.replace("_", " ")} />
        ))}
      </fieldset>

      <fieldset>
        <legend>situation</legend>
        {SITUATION.map((s, i) => (
          <Chip key={s.label} on={sitIdx === i} onClick={() => setSitIdx(i)} label={s.label} />
        ))}
      </fieldset>

      <fieldset>
        <legend>pressure</legend>
        {PRESSURE.map((p) => (
          <Chip key={p} on={pressure === p} onClick={() => setPressure(p)} label={p} />
        ))}
      </fieldset>

      <fieldset>
        <legend>assist (optional)</legend>
        <Chip on={assist === null} onClick={() => setAssist(null)} label="—" />
        {ASSIST.map((a) => (
          <Chip key={a} on={assist === a} onClick={() => setAssist(a)} label={a.replace("_", " ")} />
        ))}
      </fieldset>

      <fieldset>
        <legend>context (optional)</legend>
        <Chip on={firstTime} onClick={() => setFirstTime((v) => !v)} label="first-time" />
        <Chip on={oneOnOne} onClick={() => setOneOnOne((v) => !v)} label="one-on-one" />
      </fieldset>
    </div>
  );
}

function Chip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`chip ${on ? "on" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}
