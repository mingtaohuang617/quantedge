import { useCallback, useEffect, useState } from 'react';
import { DAILY_SNAPSHOT_KEY, loadPublishedDaily, loadDailySnapshots } from '../lib/dailyWatchlist.js';
export default function useDailyQuotes(request) {
  const [state, setState] = useState({ snapshots: {}, published: null });
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setState(await loadPublishedDaily(request, localStorage)); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => {
    let active = true;
    loadPublishedDaily(request, localStorage).then(next => { if (active) setState(next); });
    const sync = event => {
      if (!event.key || event.key === DAILY_SNAPSHOT_KEY) setState(prev => ({ ...prev, snapshots: loadDailySnapshots(localStorage) }));
    };
    window.addEventListener('storage', sync);
    return () => { active = false; window.removeEventListener('storage', sync); };
  }, [request]);
  return { ...state, loading, refresh };
}
