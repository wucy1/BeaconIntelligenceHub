export type LatLng = { lat: number; lng: number };

export type TileCoord = { z: number; x: number; y: number };

export const DEFAULT_BOX_SIDE_KM = 3;
export const DEFAULT_RADIUS_KM = DEFAULT_BOX_SIDE_KM / 2;
export const PREFETCH_ZOOM_MIN = 14;
export const PREFETCH_ZOOM_MAX = 17;
export const TILE_CACHE_SCHEMA = 'v1';

const OSM_SUBDOMAINS = ['a', 'b', 'c'] as const;

export function tileKey(z: number, x: number, y: number): string {
  return `${TILE_CACHE_SCHEMA}/${z}/${x}/${y}`;
}

export function osmTileUrl(z: number, x: number, y: number): string {
  const s = OSM_SUBDOMAINS[(x + y) % OSM_SUBDOMAINS.length];
  return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/** 以中心為準的方形 AOI（邊長 sideKm，例如 3×3 km） */
export function bboxForBox(center: LatLng, sideKm: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const half = sideKm / 2;
  const latRad = (center.lat * Math.PI) / 180;
  const dLat = half / 111.32;
  const dLng = half / (111.32 * Math.cos(latRad));
  return {
    south: center.lat - dLat,
    west: center.lng - dLng,
    north: center.lat + dLat,
    east: center.lng + dLng,
  };
}

/** 圓形 AOI 對應的外接 bbox（度）；半徑 r 時外接方框邊長約 2r */
export function bboxForDisk(center: LatLng, radiusKm: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const latRad = (center.lat * Math.PI) / 180;
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos(latRad));
  return {
    south: center.lat - dLat,
    west: center.lng - dLng,
    north: center.lat + dLat,
    east: center.lng + dLng,
  };
}

function latLngToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** 外接 bbox 內所有瓦片（各縮放級） */
export function tilesForDisk(
  center: LatLng,
  radiusKm: number,
  zMin: number,
  zMax: number,
): TileCoord[] {
  const box = bboxForBox(center, radiusKm * 2);
  const seen = new Set<string>();
  const out: TileCoord[] = [];

  for (let z = zMin; z <= zMax; z += 1) {
    const nw = latLngToTile(box.north, box.west, z);
    const se = latLngToTile(box.south, box.east, z);
    const x0 = Math.min(nw.x, se.x);
    const x1 = Math.max(nw.x, se.x);
    const y0 = Math.min(nw.y, se.y);
    const y1 = Math.max(nw.y, se.y);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = tileKey(z, x, y);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ z, x, y });
      }
    }
  }
  return out;
}

export function regionIdForCenter(center: LatLng, radiusKm: number): string {
  const lat = Math.round(center.lat * 100) / 100;
  const lng = Math.round(center.lng * 100) / 100;
  return `${lat},${lng},${radiusKm}km`;
}
