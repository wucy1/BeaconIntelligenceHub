import type { OpsReport } from './opsApi';

/** Map pin position for an ops report (GeoJSON Point [lng, lat]). */
export function reportMapLatLng(report: OpsReport): [number, number] | null {
  const coords = report.geom?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

/** Public-map style pin groups (same building or ~1 m GPS cell). */
export function countDisplayPinGroups(reports: OpsReport[]): number {
  const keys = new Set<string>();
  for (const r of reports) {
    const coords = r.geom?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = r.building_id
      ? `b:${r.building_id}`
      : `p:${lng.toFixed(5)},${lat.toFixed(5)}`;
    keys.add(key);
  }
  return keys.size;
}
