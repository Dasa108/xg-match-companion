// Match lifecycle + persistence, against an in-memory IndexedDB.

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import type { ShotInput } from "../xg/types";
import { teamAggs } from "../xg/verdict";
import {
  addPlayer, clockDisplay, createMatch, db, deleteMatch, elapsedMinute, finishMatch,
  isBeforeFullTime, reopenMatch, saveShot, setClockMinute, startMatch, startSecondHalf,
} from "./schema";

const shotInput: ShotInput = {
  x: 108, y: 40, shot_type: "open_play", play_pattern: "regular_play",
  body_part: "right_foot", under_pressure: false,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("match lifecycle", () => {
  it("setup -> live -> finished, with a working clock", async () => {
    const id = await createMatch({
      date: "2026-09-10", label: "friendly", venue: "",
      homeName: "Rovers", awayName: "City",
    });
    expect((await db.matches.get(id))!.status).toBe("setup");

    await addPlayer(id, "home", { name: "Ada", number: 9, role: "start" });
    await addPlayer(id, "away", { name: "Bo", number: 7, role: "start" });

    await startMatch(id);
    let m = (await db.matches.get(id))!;
    expect(m.status).toBe("live");
    expect(m.clockStartedAt).toBeTypeOf("number");

    await setClockMinute(id, 12);
    expect(elapsedMinute((await db.matches.get(id))!)).toBe(12);

    await finishMatch(id);
    m = (await db.matches.get(id))!;
    expect(m.status).toBe("finished");
    expect(m.clockStartedAt).toBeNull();
    expect(elapsedMinute(m)).toBe(12); // frozen

    await reopenMatch(id);
    expect((await db.matches.get(id))!.status).toBe("live");
  });

  it("defaults to a 45-minute half, and lets the operator set a custom length", async () => {
    const id = await createMatch({
      date: "2026-09-10", label: "x", venue: "", homeName: "R", awayName: "C",
    });
    expect((await db.matches.get(id))!.halfLengthMin).toBe(45);
    expect((await db.matches.get(id))!.currentHalf).toBe(1);

    const custom = await createMatch({
      date: "2026-09-10", label: "x", venue: "", homeName: "R", awayName: "C",
      halfLengthMin: 30,
    });
    expect((await db.matches.get(custom))!.halfLengthMin).toBe(30);
  });

  it("clockDisplay labels regulation time, stoppage time, and the current half", async () => {
    const id = await createMatch({
      date: "2026-09-10", label: "x", venue: "", homeName: "R", awayName: "C",
      halfLengthMin: 20,
    });
    await startMatch(id);

    await setClockMinute(id, 12);
    let m = (await db.matches.get(id))!;
    expect(clockDisplay(m)).toEqual({ half: 1, label: "12'", overrun: false });

    // past the configured half length but still marked as the 1st half -> stoppage time
    await setClockMinute(id, 23);
    m = (await db.matches.get(id))!;
    expect(clockDisplay(m)).toEqual({ half: 1, label: "20+3'", overrun: true });

    // flips the half label and resumes a paused clock without losing accumulated time
    await startSecondHalf(id);
    m = (await db.matches.get(id))!;
    expect(m.currentHalf).toBe(2);
    expect(m.clockStartedAt).toBeTypeOf("number");
    expect(elapsedMinute(m)).toBe(23); // unchanged — same continuous accumulator

    await setClockMinute(id, 35);
    m = (await db.matches.get(id))!;
    expect(clockDisplay(m)).toEqual({ half: 2, label: "35'", overrun: false });

    await setClockMinute(id, 45);
    m = (await db.matches.get(id))!;
    expect(clockDisplay(m)).toEqual({ half: 2, label: "40+5'", overrun: true });
  });

  it("isBeforeFullTime flags ending early regardless of which half is marked", async () => {
    const id = await createMatch({
      date: "2026-09-10", label: "x", venue: "", homeName: "R", awayName: "C",
      halfLengthMin: 20,
    });
    await startMatch(id);

    await setClockMinute(id, 12);
    expect(isBeforeFullTime((await db.matches.get(id))!)).toBe(true); // still 1st half

    await startSecondHalf(id);
    await setClockMinute(id, 35);
    expect(isBeforeFullTime((await db.matches.get(id))!)).toBe(true); // 2nd half, still short

    await setClockMinute(id, 40);
    expect(isBeforeFullTime((await db.matches.get(id))!)).toBe(false); // exactly full time

    await setClockMinute(id, 43);
    expect(isBeforeFullTime((await db.matches.get(id))!)).toBe(false); // into stoppage time
  });

  it("saves shots and aggregates them by side", async () => {
    const id = await createMatch({
      date: "2026-09-10", label: "x", venue: "", homeName: "Rovers", awayName: "City",
    });
    const ada = await addPlayer(id, "home", { name: "Ada", number: 9, role: "start" });
    await addPlayer(id, "away", { name: "Bo", number: 7, role: "start" });
    await startMatch(id);

    await saveShot({
      matchId: id, side: "home", playerId: ada, minute: 10,
      input: shotInput, features: { distance: 12 }, bucket: "minimal", xg: 0.34, raw: 0.31, outcome: "goal",
    });
    await saveShot({
      matchId: id, side: "home", playerId: ada, minute: 20,
      input: shotInput, features: { distance: 20 }, bucket: "minimal", xg: 0.06, raw: 0.05, outcome: "saved",
    });
    await saveShot({
      matchId: id, side: "away", playerId: null, minute: 25,
      input: shotInput, features: {}, bucket: "minimal", xg: 0.12, raw: 0.11, outcome: "off_target",
    });

    const shots = await db.shots.where("matchId").equals(id).toArray();
    const m = (await db.matches.get(id))!;
    const { home, away } = teamAggs(m, shots);
    expect(home.shots).toBe(2);
    expect(home.xg).toBeCloseTo(0.4, 5);
    expect(home.goals).toBe(1);
    expect(away.xg).toBeCloseTo(0.12, 5);
  });

  it("deleteMatch cascades to players and shots", async () => {
    const id = await createMatch({
      date: "2026-09-10", label: "x", venue: "", homeName: "R", awayName: "C",
    });
    const p = await addPlayer(id, "home", { name: "Ada", number: 9, role: "start" });
    await saveShot({
      matchId: id, side: "home", playerId: p, minute: 1,
      input: shotInput, features: {}, bucket: "minimal", xg: 0.1, raw: 0.1, outcome: "saved",
    });

    await deleteMatch(id);
    expect(await db.matches.get(id)).toBeUndefined();
    expect(await db.players.where("matchId").equals(id).count()).toBe(0);
    expect(await db.shots.where("matchId").equals(id).count()).toBe(0);
  });
});
