// Thin live-query hooks over the Dexie tables. Components re-render on any DB write.

import { useLiveQuery } from "dexie-react-hooks";

import { db, type Side } from "./schema";

export const useMatches = () =>
  useLiveQuery(() => db.matches.orderBy("createdAt").reverse().toArray(), [], []);

export const useMatch = (id: string | null) =>
  useLiveQuery(() => (id ? db.matches.get(id) : undefined), [id]);

export const usePlayers = (matchId: string | null, side?: Side) =>
  useLiveQuery(
    () => {
      if (!matchId) return [];
      const coll = side
        ? db.players.where("[matchId+side]").equals([matchId, side])
        : db.players.where("matchId").equals(matchId);
      return coll.toArray();
    },
    [matchId, side],
    [],
  );

export const useShots = (matchId: string | null) =>
  useLiveQuery(
    () => (matchId ? db.shots.where("matchId").equals(matchId).sortBy("createdAt") : []),
    [matchId],
    [],
  );
