// Owns the whole service-worker lifecycle in one place, so the match-list offline-mode
// toggle and this hook's own registration share a single instance instead of each managing
// their own (which would double-register the worker).
//
// Updates are fully automatic, on purpose (reverted from an earlier manual "Reload" prompt
// per operator request): the moment a new version is detected, it's activated and the page
// reloads immediately, no click needed. injectRegister stays `null` (vite.config.ts) — the
// registration is still done by hand here rather than the plugin's own auto-injected
// script, because that's the only way a runtime preference (offlineMode) can decide whether
// to register at all; a build-time-injected script can't consult localStorage.
//
// What auto-update *can't* do anything about is being offline: no connection means no way
// to check for or fetch a newer version, so whatever's currently active is, by definition,
// possibly stale. `isOffline` surfaces that as a passive fact for the UI to flag — not an
// action to take, just something the operator should know while it's true.
import { useCallback, useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

import { readOfflineMode, writeOfflineMode } from "./offlinePref";

async function unregisterAndClear(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  }
}

export interface PwaStatus {
  offlineMode: boolean;
  isOffline: boolean;
  setOfflineMode: (on: boolean) => void;
}

export function usePwa(): PwaStatus {
  const [offlineMode, setOfflineModeState] = useState(readOfflineMode);
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!offlineMode) return;
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        void update(true); // activate + reload immediately, no prompt
      },
    });
  }, [offlineMode]);

  // Registering/unregistering a service worker only fully takes effect from the next
  // navigation — there's no way to swap it under a running page — so both directions
  // reload immediately rather than leaving the toggle in a state that lies about what's
  // actually active until the operator happens to refresh some other way.
  const setOfflineMode = useCallback((on: boolean) => {
    writeOfflineMode(on);
    setOfflineModeState(on);
    if (on) {
      location.reload();
    } else {
      unregisterAndClear().finally(() => location.reload());
    }
  }, []);

  return { offlineMode, isOffline, setOfflineMode };
}
