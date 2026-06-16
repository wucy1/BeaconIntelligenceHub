import { useCallback, useEffect, useRef, useState } from 'react';

import { prefetchRegionFootprints } from '../offline/footprintPrefetch';
import {
  countCachedTiles,
  hasOfflineTilesReady,
  listRegionMeta,
  loadRegionMeta,
  type MapRegionMeta,
  saveRegionMeta,
  tileCoverageRatio,
} from '../offline/tileCache';
import { prefetchMapTiles, type PrefetchProgress } from '../offline/tilePrefetch';
import { DEFAULT_RADIUS_KM, regionIdForCenter, type LatLng } from '../offline/tileMath';

export type FootprintPrefetchNote = {
  featureCount: number;
  skipped: boolean;
  reason?: string;
};

export type OfflineDownloadOptions = {
  includeFootprints?: boolean;
  crisisIds?: string[];
};

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
  const [footprintNote, setFootprintNote] = useState<FootprintPrefetchNote | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadingRef = useRef(false);

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
    downloadingRef.current = downloading;
  }, [downloading]);

  useEffect(() => {
    if (!center) {
      setChecking(false);
      setReady(false);
      setCoverage(null);
      return;
    }
    if (downloadingRef.current) return;
    void refresh(center);
  }, [center?.lat, center?.lng, refresh, center]);

  useEffect(() => {
    void refreshRegions();
  }, [refreshRegions]);

  const download = useCallback(
    async (loc: LatLng, opts?: OfflineDownloadOptions) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setDownloading(true);
      setFootprintNote(null);
      setProgress({ done: 0, total: 0, failed: 0 });
      try {
        const result = await prefetchMapTiles({
          center: loc,
          signal: ac.signal,
          onProgress: setProgress,
        });

        if (
          !ac.signal.aborted &&
          opts?.includeFootprints &&
          opts.crisisIds?.length &&
          result.failed < result.total
        ) {
          const regionId = regionIdForCenter(loc, DEFAULT_RADIUS_KM);
          try {
            const fp = await prefetchRegionFootprints({
              center: loc,
              radiusKm: DEFAULT_RADIUS_KM,
              crisisIds: opts.crisisIds,
              regionId,
              signal: ac.signal,
            });
            setFootprintNote(fp);
            const meta = await loadRegionMeta(regionId);
            if (meta) {
              await saveRegionMeta({
                ...meta,
                footprintsIncluded: !fp.skipped,
                footprintCount: fp.featureCount,
              });
            }
          } catch (e) {
            if (ac.signal.aborted) {
              return result;
            }
            setFootprintNote({ featureCount: 0, skipped: true, reason: 'fetch_failed' });
          }
        }

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
    footprintNote,
  };
}
