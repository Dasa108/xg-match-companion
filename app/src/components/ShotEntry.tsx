import { useEffect, useMemo, useState } from "react";

import type { Match, Outcome, Player, Side } from "../db/schema";
import { saveShot } from "../db/schema";
import { Pitch, type Tool } from "../pitch/Pitch";
import { predictXg } from "../xg/model";
import { confidenceBand, explainXg } from "../xg/reason";
import type {
  AssistType, BodyPart, PlayPattern, ShotContext, ShotInput, Technique, XgResult, XY,
} from "../xg/types";

const BODY: BodyPart[] = ["right_foot", "left_foot", "head", "other"];
const SITUATION: { key: ShotInput["shot_type"]; play: PlayPattern; label: string }[] = [
  { key: "open_play", play: "regular_play", label: "open play" },
  { key: "open_play", play: "from_counter", label: "fast break" },
  { key: "corner", play: "from_corner", label: "corner" },
  { key: "free_kick", play: "from_free_kick", label: "free kick" },
  { key: "free_kick", play: "from_throw_in", label: "throw-in" },
  { key: "penalty", play: "other", label: "penalty" },
];
const PRESSURE = ["none", "light", "heavy"] as const;
const ASSIST: AssistType[] = ["none", "cross", "through_ball", "cutback", "low_pass", "high_pass"];
const TECHNIQUE: Technique[] = ["normal", "volley", "half_volley", "lob", "overhead_kick"];
const OUTCOMES: Outcome[] = ["goal", "saved", "off_target", "blocked", "post"];

interface Props {
  match: Match;
  players: Player[];
  minute: number;
  onSaved: () => void;
}

export function ShotEntry({ match, players, minute, onSaved }: Props) {
  const [tool, setTool] = useState<Tool>("shot");
  const [shot, setShot] = useState<XY | null>(null);
  const [gk, setGk] = useState<XY | null>(null);
  const [defenders, setDefenders] = useState<XY[]>([]);
  const [passOrigin, setPassOrigin] = useState<XY | null>(null);

  const [side, setSide] = useState<Side>("home");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bodyPart, setBodyPart] = useState<BodyPart>("right_foot");
  const [sitIdx, setSitIdx] = useState(0);
  const [pressure, setPressure] = useState<(typeof PRESSURE)[number]>("none");
  const [assist, setAssist] = useState<AssistType | null>(null);
  const [firstTime, setFirstTime] = useState(false);
  const [oneOnOne, setOneOnOne] = useState(false);
  const [technique, setTechnique] = useState<Technique | null>(null);
  const [followsDribble, setFollowsDribble] = useState(false);
  const [openGoal, setOpenGoal] = useState(false);
  const [rebound, setRebound] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("saved");
  const [showMore, setShowMore] = useState(false);

  const [result, setResult] = useState<XgResult | null>(null);
  const [saving, setSaving] = useState(false);

  const sidePlayers = useMemo(
    () => players.filter((p) => p.side === side && p.onPitch).sort(byNumber),
    [players, side],
  );

  const input: ShotInput | null = useMemo(() => {
    if (!shot) return null;
    const sit = SITUATION[sitIdx];
    const hasFreeze = gk != null || defenders.length > 0;
    const ctxFlags: ShotContext = {
      first_time: firstTime,
      follows_dribble: followsDribble,
      one_on_one: oneOnOne,
      open_goal: openGoal,
      rebound,
    };
    const anyCtx = Object.values(ctxFlags).some(Boolean);
    return {
      x: shot[0],
      y: shot[1],
      shot_type: sit.key,
      play_pattern: sit.play,
      body_part: bodyPart,
      under_pressure: pressure !== "none",
      freeze_frame: hasFreeze ? { gk, opponents: defenders, teammates_in_box: 0 } : null,
      assist_type: assist,
      technique,
      pass_origin: passOrigin,
      context: anyCtx ? ctxFlags : null,
    };
  }, [shot, gk, defenders, passOrigin, bodyPart, sitIdx, pressure, assist, technique,
      firstTime, followsDribble, oneOnOne, openGoal, rebound]);

  useEffect(() => {
    if (!input) return setResult(null);
    let live = true;
    predictXg(input).then((r) => live && setResult(r)).catch(() => live && setResult(null));
    return () => {
      live = false;
    };
  }, [input]);

  function place(p: XY) {
    if (tool === "shot") setShot(p);
    else if (tool === "gk") setGk(p);
    else if (tool === "pass") setPassOrigin(p);
    else setDefenders((d) => [...d, p]);
  }

  function reset() {
    setShot(null);
    setGk(null);
    setDefenders([]);
    setPassOrigin(null);
    setPlayerId(null);
    setAssist(null);
    setTechnique(null);
    setFirstTime(false);
    setFollowsDribble(false);
    setOneOnOne(false);
    setOpenGoal(false);
    setRebound(false);
    setOutcome("saved");
    setTool("shot");
    setResult(null);
  }

  async function commit() {
    if (!input || !result || !playerId) return;
    setSaving(true);
    try {
      await saveShot({
        matchId: match.id,
        side,
        playerId,
        minute,
        input,
        features: result.features,
        bucket: result.bucket,
        xg: result.xg,
        raw: result.raw,
        outcome,
      });
      reset();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!input && !!result && !!playerId && !saving;

  return (
    <div className="entry">
      <Pitch
        tool={tool}
        shot={shot}
        gk={gk}
        defenders={defenders}
        passOrigin={passOrigin}
        onPlace={place}
        onRemoveDefender={(i) => setDefenders((d) => d.filter((_, k) => k !== i))}
      />

      <div className="tools">
        {(
          [
            ["shot", "◎ shot"],
            ["gk", "🧤 keeper"],
            ["defender", "▲ defender"],
            ["pass", "⟶ pass"],
          ] as [Tool, string][]
        ).map(([t, label]) => (
          <button key={t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
        <button onClick={reset}>reset</button>
      </div>

      <div className="result">
        {!shot && <p className="hint">Tap the pitch where the shot was taken.</p>}
        {shot && !result && <p className="hint">computing xG…</p>}
        {result && (
          <>
            <div className="row spread">
              <div>
                <span className="xg">{result.xg.toFixed(2)}</span>
                <span className="xg-unit"> xG</span>
                {(() => {
                  const [lo, hi] = confidenceBand(result.xg, result.bucket);
                  return <span className="band"> {lo.toFixed(2)}–{hi.toFixed(2)}</span>;
                })()}
              </div>
              <div className="meta">
                {result.bucket}
                {result.raw != null &&
                  ` · d${Number(result.features.distance).toFixed(0)} · ${(
                    (Number(result.features.angle) * 180) / Math.PI
                  ).toFixed(0)}°`}
              </div>
            </div>
            <div className="why">{explainXg(result.features, result.bucket)}</div>
          </>
        )}
      </div>

      <fieldset>
        <legend>shooter</legend>
        <div className="chips">
          <Chip on={side === "home"} onClick={() => { setSide("home"); setPlayerId(null); }} label={match.homeName} />
          <Chip on={side === "away"} onClick={() => { setSide("away"); setPlayerId(null); }} label={match.awayName} />
        </div>
        <select value={playerId ?? ""} onChange={(e) => setPlayerId(e.target.value || null)}>
          <option value="">— pick player —</option>
          {sidePlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number != null ? `${p.number}. ` : ""}
              {p.name}
            </option>
          ))}
        </select>
      </fieldset>

      <ChipRow legend="body part" values={BODY} pick={bodyPart} set={setBodyPart} fmt={(b) => b.replace("_", " ")} />
      <fieldset>
        <legend>situation</legend>
        {SITUATION.map((s, i) => (
          <Chip key={s.label} on={sitIdx === i} onClick={() => setSitIdx(i)} label={s.label} />
        ))}
      </fieldset>
      <ChipRow legend="pressure" values={PRESSURE} pick={pressure} set={setPressure} />
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

      <button className="ghost mini" onClick={() => setShowMore((v) => !v)}>
        {showMore ? "− less detail" : "+ more detail"}
      </button>
      {showMore && (
        <>
          <fieldset>
            <legend>technique (optional)</legend>
            <Chip on={technique === null} onClick={() => setTechnique(null)} label="—" />
            {TECHNIQUE.map((t) => (
              <Chip key={t} on={technique === t} onClick={() => setTechnique(t)} label={t.replace("_", " ")} />
            ))}
          </fieldset>
          <fieldset>
            <legend>more context (optional)</legend>
            <Chip on={followsDribble} onClick={() => setFollowsDribble((v) => !v)} label="beat a defender" />
            <Chip on={openGoal} onClick={() => setOpenGoal((v) => !v)} label="open goal" />
            <Chip on={rebound} onClick={() => setRebound((v) => !v)} label="rebound" />
          </fieldset>
          <p className="hint">
            Use the <b>⟶ pass</b> tool to mark where the assist came from.
          </p>
        </>
      )}

      <ChipRow legend="outcome" values={OUTCOMES} pick={outcome} set={setOutcome} fmt={(o) => o.replace("_", " ")} />

      <button className="primary" disabled={!canSave} onClick={commit}>
        {saving ? "saving…" : playerId ? `Save shot (${minute}′)` : "pick a shooter to save"}
      </button>
    </div>
  );
}

const byNumber = (a: Player, b: Player) => (a.number ?? 99) - (b.number ?? 99);

function Chip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`chip ${on ? "on" : ""}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function ChipRow<T extends string>({
  legend, values, pick, set, fmt,
}: {
  legend: string;
  values: readonly T[];
  pick: T;
  set: (v: T) => void;
  fmt?: (v: T) => string;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {values.map((v) => (
        <Chip key={v} on={pick === v} onClick={() => set(v)} label={fmt ? fmt(v) : v} />
      ))}
    </fieldset>
  );
}
