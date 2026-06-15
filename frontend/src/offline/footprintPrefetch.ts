import { apiGet, BUILDINGS_FETCH_TIMEOUT_MS } from '../api';
import { normalizeBboxString } from '../utils/mapBbox';
import {
  footprintBboxForRegion,
  MAX_OFFLINE_FOOTPRINT_FEATURES,
  mergeCrisisFootprints,
  saveRegionFootprints,
  type OfflineFootprintBundle,
} from './buildingFootprintCache';
import { regionIdForCenter, type LatLng } from './tileMath';

export type FootprintPrefetchResult = {
  featureCount: number;
  skipped: boolean;
  reason?: string;
};

export async function prefetchRegionFootprints(opts: {
  center: LatLng;
  radiusKm: number;
  crisisIds: string[];
  regionId?: string;
  signal?: AbortSignal;
}): Promise<FootprintPrefetchResult> {
  if (opts.crisisIds.length === 0) {
    return { featureCount: 0, skipped: true, reason: 'no_crisis' };
  }
  const box = footprintBboxForRegion(opts.center, opts.radiusKm);
  const q = `${box.west},${box.south},${box.east},${box.north}`;
  const collections = await Promise.all(
    opts.crisisIds.map((id) => {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return apiGet<GeoJSON.FeatureCollection>(
        `/v1/crises/${id}/buildings?bbox=${encodeURIComponent(q)}`,
        { timeoutMs: BUILDINGS_FETCH_TIMEOUT_MS, maxAttempts: 2 },
      );
    }),
  );
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const merged = mergeCrisisFootprints(collections, opts.crisisIds);
  if (merged.features.length > MAX_OFFLINE_FOOTPRINT_FEATURES) {
    return {
      featureCount: merged.features.length,
      skipped: true,
      reason: 'too_large',
    };
  }
  const regionId = opts.regionId ?? regionIdForCenter(opts.center, opts.radiusKm);
  const bundle: OfflineFootprintBundle = {
    regionId,
    center: opts.center,
    radiusKm: opts.radiusKm,
    bbox: box,
    downloadedAt: new Date().toISOString(),
    featureCount: merged.features.length,
    collection: merged,
  };
  await saveRegionFootprints(bundle);
  return { featureCount: merged.features.length, skipped: false };
}

/** Fetch building footprints for the current map viewport (manual download). */
export async function fetchViewportFootprints(
  bbox: string,
  crisisIds: string[],
): Promise<{ collection: GeoJSON.FeatureCollection; failures: number }> {
  if (crisisIds.length === 0) {
    return {
      collection: { type: 'FeatureCollection', features: [] },
      failures: 0,
    };
  }
  const q = encodeURIComponent(normalizeBboxString(bbox));
  const results = await Promise.allSettled(
    crisisIds.map((id) =>
      apiGet<GeoJSON.FeatureCollection>(`/v1/crises/${id}/buildings?bbox=${q}`, {
        timeoutMs: BUILDINGS_FETCH_TIMEOUT_MS,
        maxAttempts: 3,
      }),
    ),
  );
  const collections: GeoJSON.FeatureCollection[] = [];
  let failures = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      failures += 1;
      collections.push({ type: 'FeatureCollection', features: [] });
    } else {
      collections.push(result.value);
    }
  }
  return { collection: mergeCrisisFootprints(collections, crisisIds), failures };
}
