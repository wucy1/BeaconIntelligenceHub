import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../api';
import { loadActiveWindowSnapshot, saveActiveWindowSnapshot } from '../offline/crisisCache';

export type ActiveWindow = {
  window_id: string;
  crisis_id: string;
  slug: string;
  name: Record<string, string>;
  /** 可選：管理員事後劃定的參考區，不限制回報 */
  bounds: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  bounds_role?: 'optional_reference' | null;
  reporting_unbounded?: boolean;
  /** unspecified = 管理員尚未劃定範圍；defined = 已有參考 AOI */
  reporting_phase?: 'unspecified' | 'defined';
  is_open: boolean;
};

export function useActiveWindow() {
  const [window, setWindow] = useState<ActiveWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  /** 目前危機資料來自本機快照（離線填報模式） */
  const [fromCache, setFromCache] = useState(false);
  /** 從未連線成功過，無快照可填報 */
  const [needsFirstOnline, setNeedsFirstOnline] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) setLoading(false);
    };

    const applyCache = (data: ActiveWindow) => {
      setWindow(data);
      setError(null);
      setFromCache(true);
      setNeedsFirstOnline(false);
    };

    const load = async () => {
      setLoading(true);
      setError(null);
      setFromCache(false);
      setNeedsFirstOnline(false);

      if (!navigator.onLine) {
        const cached = await loadActiveWindowSnapshot();
        if (cancelled) return;
        if (cached?.data) {
          applyCache(cached.data);
        } else {
          setWindow(null);
          setNeedsFirstOnline(true);
        }
        finish();
        return;
      }

      try {
        const w = await apiGet<ActiveWindow>('/v1/public/active-window');
        if (cancelled) return;
        setWindow(w);
        setError(null);
        setFromCache(false);
        setNeedsFirstOnline(false);
        void saveActiveWindowSnapshot(w).catch(() => {});
      } catch (e) {
        if (cancelled) return;
        const cached = await loadActiveWindowSnapshot();
        if (cached?.data) {
          applyCache(cached.data);
        } else {
          setWindow(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        finish();
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return { window, error, loading, reload, fromCache, needsFirstOnline };
}
