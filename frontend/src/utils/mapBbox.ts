import type { MapMarker } from '../components/map/ContributorMap';

export function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Client-side guard: marker point inside map viewport (matches server envelope). */
export function markerInBbox(m: MapMarker, bbox: string): boolean {
  const box = parseBbox(bbox);
  if (!box) return true;
  const [minLng, minLat, maxLng, maxLat] = box;
  const [lng, lat] = m.geom.coordinates;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

export function filterMarkersInBbox(markers: MapMarker[], bbox: string): MapMarker[] {
  return markers.filter((m) => markerInBbox(m, bbox));
}
