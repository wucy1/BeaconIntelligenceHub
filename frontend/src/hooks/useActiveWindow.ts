import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../api';

export type ActiveWindow = {
  window_id: string;
  crisis_id: string;
  slug: string;
  name: Record<string, string>;
  /** 可選：管理員事後劃定的參考區，不限制回報 */
  bounds: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  bounds_role?: 'optional_reference' | null;
  reporting_unbounded?: boolean;
  is_open: boolean;
};

export function useActiveWindow() {
  const [window, setWindow] = useState<ActiveWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiGet<ActiveWindow>('/v1/public/active-window')
      .then((w) => {
        if (!cancelled) {
          setWindow(w);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setWindow(null);
          setError(e.message);
        }
      })
      .finally(() => {
        // 一律結束 loading（避免 React Strict Mode 取消後永遠卡在 Loading）
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return { window, error, loading, reload };
}
