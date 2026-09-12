import { useEffect, useState } from "react";

import { Icon } from "./components/Icon";
import { OfflineFlag } from "./components/OfflineFlag";
import { useMatch } from "./db/hooks";
import { usePwa } from "./pwa/usePwa";
import { MatchListScreen } from "./screens/MatchListScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { ReportScreen } from "./screens/ReportScreen";

const LAST_KEY = "xg.lastMatch";

export function App() {
  const pwa = usePwa();
  const [openId, setOpenId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  });
  const match = useMatch(openId);

  useEffect(() => {
    try {
      if (openId) localStorage.setItem(LAST_KEY, openId);
      else localStorage.removeItem(LAST_KEY);
    } catch {
      /* private mode — fine */
    }
  }, [openId]);

  // openId set but the match is gone (deleted elsewhere) -> back to list
  const missing = openId != null && match === undefined;

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => setOpenId(null)}>
          <Icon name="football" size={18} />
          xG Match Companion
        </button>
        {match && (
          <span className="tag">
            {match.homeName} v {match.awayName}
          </span>
        )}
      </header>

      {pwa.isOffline && <OfflineFlag />}

      {(!openId || missing) && (
        <MatchListScreen onOpen={setOpenId} offlineMode={pwa.offlineMode} onSetOfflineMode={pwa.setOfflineMode} />
      )}
      {match && match.status === "setup" && <SetupScreen match={match} onLive={() => {}} />}
      {match && match.status === "live" && <LiveScreen match={match} onReport={() => {}} />}
      {match && match.status === "finished" && (
        <ReportScreen match={match} onLive={() => {}} onHome={() => setOpenId(null)} />
      )}
    </div>
  );
}
