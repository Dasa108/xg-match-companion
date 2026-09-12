// Whether the app should register a service worker and precache itself for offline use.
// Pure read/write so it's unit-testable without touching the real service worker machinery
// (that lives in usePwa.ts, which only a real browser/Vite build can exercise).
//
// Default true — spec §11 locks "offline-first" as a v1 requirement (this is the whole
// reason the app works pitchside with no signal). This is a deliberate opt-OUT for an
// operator who'd rather always fetch the latest version over a connection than risk ever
// seeing a stale cached one — trading away offline capability to get it, not a setting
// most people should need to touch.
const KEY = "xg.offlineMode";

export function readOfflineMode(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "1";
  } catch {
    return true; // private mode / storage blocked — fall back to the documented default
  }
}

export function writeOfflineMode(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode — the toggle just won't persist across reloads, still works this session */
  }
}
