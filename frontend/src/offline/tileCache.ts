import { openOfflineDb } from './openDb';
import {
  DEFAULT_RADIUS_KM,
  PREFETCH_ZOOM_MAX,
  PREFETCH_ZOOM_MIN,
  type LatLng,
  regionIdForCenter,
  tileKey,
  tilesForDisk,
  type TileCoord,
} from './tileMath';

const TILE_STORE = 'map_tiles';
const REGION_STORE = 'map_regions';

export type MapRegionMeta = {
  id: string;
  center: LatLng;
  radiusKm: number;
  zMin: number;
  zMax: number;
  tileCount: number;
  downloadedAt: string;
};

export async function getTileBlob(z: number, x: number, y: number): Promise<Blob | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, 'readonly');
    const req = tx.objectStore(TILE_STORE).get(tileKey(z, x, y));
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putTileBlob(z: number, x: number, y: number, blob: Blob): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, 'readwrite');
    tx.objectStore(TILE_STORE).put(blob, tileKey(z, x, y));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveRegionMeta(meta: MapRegionMeta): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGION_STORE, 'readwrite');
    tx.objectStore(REGION_STORE).put(meta, meta.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadRegionMeta(regionId: string): Promise<MapRegionMeta | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGION_STORE, 'readonly');
    const req = tx.objectStore(REGION_STORE).get(regionId);
    req.onsuccess = () => resolve((req.result as MapRegionMeta | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export function listTilesForRegion(
  center: LatLng,
  radiusKm = DEFAULT_RADIUS_KM,
  zMin = PREFETCH_ZOOM_MIN,
  zMax = PREFETCH_ZOOM_MAX,
): TileCoord[] {
  return tilesForDisk(center, radiusKm, zMin, zMax);
}

/** 已快取瓦片佔所需瓦片的比例（0–1） */
export async function tileCoverageRatio(
  center: LatLng,
  radiusKm = DEFAULT_RADIUS_KM,
  zMin = PREFETCH_ZOOM_MIN,
  zMax = PREFETCH_ZOOM_MAX,
): Promise<{ ratio: number; total: number; cached: number }> {
  const needed = listTilesForRegion(center, radiusKm, zMin, zMax);
  if (needed.length === 0) return { ratio: 0, total: 0, cached: 0 };

  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, 'readonly');
    const store = tx.objectStore(TILE_STORE);
    let cached = 0;
    let pending = needed.length;

    for (const t of needed) {
      const req = store.get(tileKey(t.z, t.x, t.y));
      req.onsuccess = () => {
        if (req.result) cached += 1;
        pending -= 1;
        if (pending === 0) {
          resolve({ ratio: cached / needed.length, total: needed.length, cached });
        }
      };
      req.onerror = () => reject(req.error);
    }
  });
}

/** 至少 92% 瓦片已快取視為可離線使用 */
export const COVERAGE_READY_THRESHOLD = 0.92;

export async function hasOfflineTilesReady(
  center: LatLng,
  radiusKm = DEFAULT_RADIUS_KM,
): Promise<boolean> {
  const { ratio } = await tileCoverageRatio(center, radiusKm);
  return ratio >= COVERAGE_READY_THRESHOLD;
}

export async function nearestReadyRegion(center: LatLng): Promise<MapRegionMeta | null> {
  const id = regionIdForCenter(center, DEFAULT_RADIUS_KM);
  const meta = await loadRegionMeta(id);
  if (!meta) return null;
  const ready = await hasOfflineTilesReady(center, meta.radiusKm);
  return ready ? meta : null;
}
