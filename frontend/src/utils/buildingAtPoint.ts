/** Point-in-polygon for building footprints (WGS84, GeoJSON). */

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(lng: number, lat: number, rings: number[][][]): boolean {
  if (!rings[0]?.length) return false;
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(lng, lat, rings[h])) return false;
  }
  return true;
}

function pointInPolygonGeometry(
  lng: number,
  lat: number,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): boolean {
  if (geom.type === 'Polygon') {
    return pointInPolygonCoords(lng, lat, geom.coordinates);
  }
  return geom.coordinates.some((poly) => pointInPolygonCoords(lng, lat, poly));
}

export type BuildingHit = {
  id: string;
  name: string | null;
};

export function findBuildingAtPoint(
  lat: number,
  lng: number,
  buildings: GeoJSON.FeatureCollection,
): BuildingHit | null {
  for (const f of buildings.features) {
    const id = f.properties?.building_id as string | undefined;
    if (!id || !f.geometry) continue;
    const g = f.geometry;
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    if (pointInPolygonGeometry(lng, lat, g)) {
      const name = (f.properties?.name as string | undefined) ?? null;
      return { id, name };
    }
  }
  return null;
}

export function buildingFeatureById(
  buildings: GeoJSON.FeatureCollection,
  buildingId: string,
): GeoJSON.Feature | undefined {
  return buildings.features.find((f) => f.properties?.building_id === buildingId);
}

export function centroidOfFeature(feature: GeoJSON.Feature): { lat: number; lng: number } | null {
  const g = feature.geometry;
  if (!g) return null;
  let ring: number[][] | undefined;
  if (g.type === 'Polygon') ring = g.coordinates[0];
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0]?.[0];
  if (!ring?.length) return null;
  const n = Math.max(1, ring.length - 1);
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return { lat: lat / n, lng: lng / n };
}

/** Group markers within ~25 m (approx.) for location history. */
export function markersNearPoint<T extends { id: string; building_id: string | null; geom: GeoJSON.Point }>(
  markers: T[],
  lat: number,
  lng: number,
  buildingId: string | null,
): T[] {
  if (buildingId) {
    return markers.filter((m) => m.building_id === buildingId);
  }
  const tol = 0.00025;
  return markers.filter((m) => {
    const [mlng, mlat] = m.geom.coordinates;
    return Math.abs(mlat - lat) < tol && Math.abs(mlng - lng) < tol;
  });
}
