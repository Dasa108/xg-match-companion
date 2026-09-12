// Owns the whole service-worker lifecycle in one place, so the header's offline-mode
// toggle and the update banner share a single registration instead of each managing their
// own (which would double-register the worker). Uses registerType:"prompt" (vite.config.ts)
// — a new version is fetched and left waiting, never silently swapped in — so `needRefresh`
// only flips once there's actually something to offer the operator, and `reload()` is the
// only thing that activates it.
import { useCallback, useEffect, useRef, useState } from "react";
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
  needRefresh: boolean;
  setOfflineMode: (on: boolean) => void;
  reload: () => void;
}

export function usePwa(): PwaStatus {
  const [offlineMode, setOfflineModeState] = useState(readOfflineMode);
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!offlineMode) return;
    updateRef.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
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

  const reload = useCallback(() => {
    void updateRef.current?.(true);
  }, []);

  return { offlineMode, needRefresh, setOfflineMode, reload };
}
