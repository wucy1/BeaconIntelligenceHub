import { useCallback, useEffect, useRef, useState } from 'react';

import {
  countCachedTiles,
  hasOfflineTilesReady,
  listRegionMeta,
  type MapRegionMeta,
  tileCoverageRatio,
} from '../offline/tileCache';
import { prefetchMapTiles, type PrefetchProgress } from '../offline/tilePrefetch';
import { DEFAULT_RADIUS_KM, type LatLng } from '../offline/tileMath';

export function useOfflineMapTiles(center: LatLng | null) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [coverage, setCoverage] = useState<{ cached: number; total: number; ratio: number } | null>(
    null,
  );
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<PrefetchProgress | null>(null);
  const [regions, setRegions] = useState<MapRegionMeta[]>([]);
  const [cachedTileCount, setCachedTileCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refreshRegions = useCallback(async () => {
    const [rows, count] = await Promise.all([listRegionMeta(), countCachedTiles()]);
    setRegions(rows);
    setCachedTileCount(count);
  }, []);

  const refresh = useCallback(async (loc: LatLng) => {
    setChecking(true);
    try {
      const stats = await tileCoverageRatio(loc, DEFAULT_RADIUS_KM);
      setCoverage(stats);
      const ok = stats.ratio >= 0.92;
      setReady(ok);
      return ok;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!center) {
      setChecking(false);
      setReady(false);
      setCoverage(null);
      return;
    }
    void refresh(center);
  }, [center?.lat, center?.lng, refresh, center]);

  useEffect(() => {
    void refreshRegions();
  }, [refreshRegions]);

  const download = useCallback(
    async (loc: LatLng) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setDownloading(true);
      setProgress({ done: 0, total: 0, failed: 0 });
      try {
        const result = await prefetchMapTiles({
          center: loc,
          signal: ac.signal,
          onProgress: setProgress,
        });
        await refresh(loc);
        await refreshRegions();
        return result;
      } finally {
        setDownloading(false);
        abortRef.current = null;
      }
    },
    [refresh],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setDownloading(false);
  }, []);

  return {
    ready,
    checking,
    coverage,
    downloading,
    progress,
    download,
    cancel,
    refresh,
    hasOfflineTilesReady,
    regions,
    cachedTileCount,
    refreshRegions,
  };
}
