/** 簡易 bbox 判斷（危機 bounds 為 Polygon / MultiPolygon） */
export function pointInGeoBounds(
  lat: number,
  lng: number,
  bounds: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): boolean {
  if (!bounds) return true;
  const rings: number[][][] = [];
  if (bounds.type === 'Polygon') {
    rings.push(bounds.coordinates[0] as number[][]);
  } else {
    for (const poly of bounds.coordinates) {
      rings.push(poly[0] as number[][]);
    }
  }
  for (const ring of rings) {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const c of ring) {
      const [x, y] = c;
      minLng = Math.min(minLng, x);
      maxLng = Math.max(maxLng, x);
      minLat = Math.min(minLat, y);
      maxLat = Math.max(maxLat, y);
    }
    if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
      return true;
    }
  }
  return false;
}
