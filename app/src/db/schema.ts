// Local-only persistence (IndexedDB via Dexie). One database, all matches. Nothing leaves
// the device. Spec §7 — Team is folded into Match (there are always exactly two, keyed by
// `side`), everything else follows the spec field-for-field.

import Dexie, { type EntityTable } from "dexie";

import type { Bucket, FeatureRow, GoalPoint, ShotInput } from "../xg/types";

export type Side = "home" | "away";
export type MatchStatus = "setup" | "live" | "finished";
export type Outcome = "goal" | "saved" | "off_target" | "blocked" | "post";

export interface Match {
  id: string;
  date: string; // ISO yyyy-mm-dd
  label: string;
  venue: string;
  homeName: string;
  awayName: string;
  status: MatchStatus;
  createdAt: number;
  finishedAt?: number;
  // simple match clock: elapsed = accumMs + (startedAt ? now - startedAt : 0)
  clockStartedAt: number | null;
  clockAccumMs: number;
  // Half length as set by the operator at match creation (spec §7.1) — drives the half/
  // stoppage-time label in clockDisplay(). The clock itself stays one continuous
  // accumulator; halftime is just the operator pausing it as usual, same as any other
  // stoppage, and startSecondHalf() only flips which half a shot's minute is read against.
  halfLengthMin: number;
  currentHalf: 1 | 2;
}

export interface Player {
  id: string;
  matchId: string;
  side: Side;
  name: string;
  number: number | null;
  role: "start" | "sub";
  onPitch: boolean;
}

export interface Shot {
  id: string;
  matchId: string;
  side: Side;
  playerId: string | null;
  minute: number;
  input: ShotInput;
  features: FeatureRow;
  bucket: Bucket | "penalty";
  xg: number;
  raw: number | null;
  outcome: Outcome;
  createdAt: number;
  // Post-shot xG (v2, optional) — only set when the operator tapped a goal-mouth
  // placement for an on-target shot (goal / saved / post). See spec 8.9.
  goalmouth?: GoalPoint | null;
  psxg?: number | null;
  psxgRaw?: number | null;
  psxgBucket?: Bucket | null;
}

export const db = new Dexie("xg-match-companion") as Dexie & {
  matches: EntityTable<Match, "id">;
  players: EntityTable<Player, "id">;
  shots: EntityTable<Shot, "id">;
};

db.version(1).stores({
  matches: "id, status, createdAt",
  players: "id, matchId, [matchId+side]",
  shots: "id, matchId, [matchId+side], playerId, createdAt",
});

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// --- match lifecycle ---------------------------------------------------
export async function createMatch(fields: {
  date: string;
  label: string;
  venue: string;
  homeName: string;
  awayName: string;
  halfLengthMin?: number;
}): Promise<string> {
  const id = uid();
  const { halfLengthMin, ...rest } = fields;
  await db.matches.add({
    id,
    ...rest,
    status: "setup",
    createdAt: Date.now(),
    clockStartedAt: null,
    clockAccumMs: 0,
    halfLengthMin: halfLengthMin && halfLengthMin > 0 ? halfLengthMin : 45,
    currentHalf: 1,
  });
  return id;
}

export async function startMatch(id: string): Promise<void> {
  await db.matches.update(id, { status: "live", clockStartedAt: Date.now(), clockAccumMs: 0 });
}

export async function finishMatch(id: string): Promise<void> {
  const m = await db.matches.get(id);
  await db.matches.update(id, {
    status: "finished",
    finishedAt: Date.now(),
    clockAccumMs: elapsedMs(m),
    clockStartedAt: null,
  });
}

export async function reopenMatch(id: string): Promise<void> {
  await db.matches.update(id, { status: "live", clockStartedAt: null });
}

export async function deleteMatch(id: string): Promise<void> {
  await db.transaction("rw", db.matches, db.players, db.shots, async () => {
    await db.shots.where("matchId").equals(id).delete();
    await db.players.where("matchId").equals(id).delete();
    await db.matches.delete(id);
  });
}

// --- match clock -----------------------------------------------------
export function elapsedMs(m: Match | undefined): number {
  if (!m) return 0;
  return m.clockAccumMs + (m.clockStartedAt ? Date.now() - m.clockStartedAt : 0);
}
export function elapsedMinute(m: Match | undefined): number {
  return Math.max(0, Math.floor(elapsedMs(m) / 60000));
}
export async function toggleClock(m: Match): Promise<void> {
  if (m.clockStartedAt) {
    await db.matches.update(m.id, { clockStartedAt: null, clockAccumMs: elapsedMs(m) });
  } else {
    await db.matches.update(m.id, { clockStartedAt: Date.now() });
  }
}
export async function setClockMinute(id: string, minute: number): Promise<void> {
  await db.matches.update(id, { clockStartedAt: null, clockAccumMs: Math.max(0, minute) * 60000 });
}

// Flip to the second half. The clock is not reset or restarted from a fresh zero — it's
// the same continuous accumulator, exactly like every other clock pause/resume in this
// app (e.g. a water break) — this just resumes it if it was left paused for the halftime
// break, and relabels subsequent minutes as "2nd half" via clockDisplay() below.
export async function startSecondHalf(id: string): Promise<void> {
  const m = await db.matches.get(id);
  const patch: Partial<Match> = { currentHalf: 2 };
  if (m && !m.clockStartedAt) patch.clockStartedAt = Date.now();
  await db.matches.update(id, patch);
}

export interface ClockDisplay {
  half: 1 | 2;
  label: string; // "34'" in regulation, "45+3'" once a half runs past its target length
  overrun: boolean;
}
// Pure — derives the broadcast-style clock label from the raw elapsed minute, the
// operator's configured half length, and which half is currently marked. No new time
// state: "overrun" (into stoppage time) is just minute > that half's target.
export function clockDisplay(m: Match | undefined): ClockDisplay {
  if (!m) return { half: 1, label: "0'", overrun: false };
  const minute = elapsedMinute(m);
  const half = m.currentHalf;
  const target = half === 1 ? m.halfLengthMin : m.halfLengthMin * 2;
  const overrun = minute > target;
  return { half, overrun, label: overrun ? `${target}+${minute - target}'` : `${minute}'` };
}

// --- team sheets ---------------------------------------------------
export async function addPlayer(
  matchId: string,
  side: Side,
  p: { name: string; number: number | null; role: "start" | "sub" },
): Promise<string> {
  const id = uid();
  await db.players.add({ id, matchId, side, onPitch: p.role === "start", ...p });
  return id;
}
export const updatePlayer = (id: string, patch: Partial<Player>) => db.players.update(id, patch);
export const removePlayer = (id: string) => db.players.delete(id);

// --- shots -------------------------------------------------------
export async function saveShot(s: Omit<Shot, "id" | "createdAt">): Promise<string> {
  const id = uid();
  await db.shots.add({ id, createdAt: Date.now(), ...s });
  return id;
}
export const deleteShot = (id: string) => db.shots.delete(id);
