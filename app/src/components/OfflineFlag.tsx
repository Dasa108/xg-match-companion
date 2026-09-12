// A passive status flag, not a prompt — nothing to click, nothing to act on. Shown
// whenever the browser reports no connection (usePwa's isOffline), since that's exactly
// when auto-update can't have checked for anything newer: what's running might be stale
// and there's no way to know or fix that without a connection anyway.
export function OfflineFlag() {
  return (
    <div className="offline-flag" role="status">
      Offline — may not be the latest version.
    </div>
  );
}
