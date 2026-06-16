import { normalizeLng } from '../utils/mapBbox';

export type LatLng = { lat: number; lng: number };

/** Leaflet world-copy safe WGS84 polygon (lng in [-180, 180]). */
export function normalizePolygonLng(geom: GeoJSON.Polygon): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: geom.coordinates.map((ring) =>
      ring.map(([lng, lat]) => [normalizeLng(lng), lat] as [number, number]),
    ),
  };
}

export function polygonToVertices(geom: GeoJSON.Polygon): LatLng[] {
  const ring = normalizePolygonLng(geom).coordinates[0];
  const verts = ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
  return verts;
}

export function verticesToPolygon(vertices: LatLng[]): GeoJSON.Polygon | null {
  if (vertices.length < 3) return null;
  const ring = vertices.map((v) => [normalizeLng(v.lng), v.lat] as [number, number]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

export function polygonAreaKm2(vertices: LatLng[]): number | null {
  const poly = verticesToPolygon(vertices);
  if (!poly) return null;
  const ring = poly.coordinates[0];
  const lat0 = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let areaM2 = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    areaM2 += x1 * mPerDegLng * y2 * mPerDegLat - x2 * mPerDegLng * y1 * mPerDegLat;
  }
  return Math.abs(areaM2 / 2) / 1_000_000;
}

export function formatArea(km2: number): string {
  return km2 < 1 ? `約 ${(km2 * 100).toFixed(0)} ha` : `約 ${km2.toFixed(1)} km²`;
}

export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
