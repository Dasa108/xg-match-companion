import { beforeEach, describe, expect, it } from "vitest";

import { readOfflineMode, writeOfflineMode } from "./offlinePref";

// Tests run in vitest's node environment (vitest.config.ts) — no browser globals, so
// localStorage doesn't exist here the way it does in a real page. A minimal in-memory
// stand-in is enough to exercise the read/write logic itself; this test isn't trying to
// verify browser storage semantics, just this module's behavior on top of them.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

beforeEach(() => {
  localStorage.clear();
});

describe("offlinePref", () => {
  it("defaults to true (offline-first, spec §11) when nothing is stored", () => {
    expect(readOfflineMode()).toBe(true);
  });

  it("round-trips an explicit off", () => {
    writeOfflineMode(false);
    expect(readOfflineMode()).toBe(false);
  });

  it("round-trips an explicit on", () => {
    writeOfflineMode(false);
    writeOfflineMode(true);
    expect(readOfflineMode()).toBe(true);
  });
});
