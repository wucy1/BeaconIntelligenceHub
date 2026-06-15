import { openOfflineDb } from './openDb';
import { bboxForBox, type LatLng } from './tileMath';

const STORE = 'map_buildings';
export const MAX_OFFLINE_FOOTPRINT_FEATURES = 5_000;

export type OfflineFootprintBundle = {
  regionId: string;
  center: LatLng;
  radiusKm: number;
  bbox: { west: number; south: number; east: number; north: number };
  downloadedAt: string;
  featureCount: number;
  collection: GeoJSON.FeatureCollection;
};

function parseBbox(bbox: string): { west: number; south: number; east: number; north: number } | null {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [west, south, east, north] = parts;
  return { west, south, east, north };
}

function bboxesOverlap(
  a: { west: number; south: number; east: number; north: number },
  b: { west: number; south: number; east: number; north: number },
): boolean {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

export async function saveRegionFootprints(bundle: OfflineFootprintBundle): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bundle, bundle.regionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listOfflineFootprintBundles(): Promise<OfflineFootprintBundle[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflineFootprintBundle[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function loadFootprintsForBbox(bbox: string): Promise<GeoJSON.FeatureCollection> {
  const box = parseBbox(bbox);
  if (!box) return { type: 'FeatureCollection', features: [] };
  const bundles = await listOfflineFootprintBundles();
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (const bundle of bundles) {
    if (!bboxesOverlap(box, bundle.bbox)) continue;
    for (const f of bundle.collection.features) {
      const bid = (f.properties?.building_id as string) ?? '';
      const key = bid || JSON.stringify(f.geometry);
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(f);
    }
  }
  return { type: 'FeatureCollection', features };
}

export function footprintBboxForRegion(center: LatLng, radiusKm: number) {
  return bboxForBox(center, radiusKm * 2);
}

export function mergeCrisisFootprints(
  collections: GeoJSON.FeatureCollection[],
  crisisIds: string[],
): GeoJSON.FeatureCollection {
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < collections.length; i++) {
    const cid = crisisIds[i];
    for (const f of collections[i].features) {
      const bid = (f.properties?.building_id as string) ?? '';
      if (bid && seen.has(bid)) continue;
      if (bid) seen.add(bid);
      features.push({
        ...f,
        properties: { ...f.properties, crisis_id: cid },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Merge by building_id so panning does not drop footprints already fetched. */
export function mergeBuildingFootprints(
  base: GeoJSON.FeatureCollection,
  incoming: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const byId = new Map<string, GeoJSON.Feature>();
  for (const f of base.features) {
    const bid = (f.properties?.building_id as string) ?? '';
    byId.set(bid || `geom:${JSON.stringify(f.geometry)}`, f);
  }
  for (const f of incoming.features) {
    const bid = (f.properties?.building_id as string) ?? '';
    byId.set(bid || `geom:${JSON.stringify(f.geometry)}`, f);
  }
  return { type: 'FeatureCollection', features: [...byId.values()] };
}
