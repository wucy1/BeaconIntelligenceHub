import {
  putTileBlob,
  saveRegionMeta,
  type MapRegionMeta,
} from './tileCache';
import {
  DEFAULT_RADIUS_KM,
  osmTileUrl,
  PREFETCH_ZOOM_MAX,
  PREFETCH_ZOOM_MIN,
  regionIdForCenter,
  type LatLng,
  tilesForDisk,
  type TileCoord,
} from './tileMath';

export type PrefetchProgress = {
  done: number;
  total: number;
  failed: number;
};

export type PrefetchOptions = {
  center: LatLng;
  radiusKm?: number;
  zMin?: number;
  zMax?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: PrefetchProgress) => void;
};

const DEFAULT_CONCURRENCY = 6;
const PER_TILE_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTileOnce(coord: TileCoord, signal?: AbortSignal): Promise<Blob | null> {
  const url = osmTileUrl(coord.z, coord.x, coord.y);
  const localController = new AbortController();
  const timer = setTimeout(() => localController.abort(), PER_TILE_TIMEOUT_MS);
  const mergedSignal = signal
    ? AbortSignal.any([signal, localController.signal])
    : localController.signal;
  try {
    const res = await fetch(url, { signal: mergedSignal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return blob;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTile(coord: TileCoord, signal?: AbortSignal): Promise<Blob | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) return null;
    const blob = await fetchTileOnce(coord, signal);
    if (blob) return blob;
    if (attempt < MAX_RETRIES) {
      await sleep(160 * (attempt + 1));
    }
  }
  return null;
}

export async function prefetchMapTiles(opts: PrefetchOptions): Promise<PrefetchProgress> {
  const radiusKm = opts.radiusKm ?? DEFAULT_RADIUS_KM;
  const zMin = opts.zMin ?? PREFETCH_ZOOM_MIN;
  const zMax = opts.zMax ?? PREFETCH_ZOOM_MAX;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const tiles = tilesForDisk(opts.center, radiusKm, zMin, zMax);
  const total = tiles.length;
  let done = 0;
  let failed = 0;
  let index = 0;

  const report = () => opts.onProgress?.({ done, total, failed });

  const worker = async () => {
    while (index < tiles.length) {
      if (opts.signal?.aborted) return;
      const i = index;
      index += 1;
      const coord = tiles[i];
      const blob = await fetchTile(coord, opts.signal);
      if (opts.signal?.aborted) return;
      if (blob) {
        await putTileBlob(coord.z, coord.x, coord.y, blob);
      } else {
        failed += 1;
      }
      done += 1;
      report();
    }
  };

  report();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tiles.length) }, () => worker()),
  );

  if (!opts.signal?.aborted && failed < total) {
    const meta: MapRegionMeta = {
      id: regionIdForCenter(opts.center, radiusKm),
      center: opts.center,
      radiusKm,
      zMin,
      zMax,
      tileCount: total - failed,
      downloadedAt: new Date().toISOString(),
    };
    await saveRegionMeta(meta);
  }

  return { done, total, failed };
}
