// Shown only once a new service-worker version is actually waiting (usePwa's needRefresh) —
// never speculative, never on every load. Fixed to the bottom so it doesn't reflow whatever
// screen is underneath, matching the existing "ambient chrome stays out of the way" rule.
import { Icon } from "./Icon";

export function UpdateBanner({ onReload }: { onReload: () => void }) {
  return (
    <div className="update-banner" role="status">
      <span>A new version is ready.</span>
      <button className="primary mini" onClick={onReload}>
        <Icon name="reset" size={13} /> Reload
      </button>
    </div>
  );
}
