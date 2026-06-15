import type { MapMarker } from '../components/map/ContributorMap';
import { centroidOfFeature } from './buildingAtPoint';

export function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

function pointInBbox(lng: number, lat: number, bbox: string): boolean {
  const box = parseBbox(bbox);
  if (!box) return true;
  const [minLng, minLat, maxLng, maxLat] = box;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/** Client-side guard: marker point inside map viewport (matches server envelope). */
export function markerInBbox(m: MapMarker, bbox: string): boolean {
  const [lng, lat] = m.geom.coordinates;
  return pointInBbox(lng, lat, bbox);
}

export function filterMarkersInBbox(markers: MapMarker[], bbox: string): MapMarker[] {
  return markers.filter((m) => markerInBbox(m, bbox));
}

export function featureInBbox(feature: GeoJSON.Feature, bbox: string): boolean {
  const cen = centroidOfFeature(feature);
  if (!cen) return true;
  return pointInBbox(cen.lng, cen.lat, bbox);
}

export function filterBuildingsInBbox(
  collection: GeoJSON.FeatureCollection,
  bbox: string,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((f) => featureInBbox(f, bbox)),
  };
}
