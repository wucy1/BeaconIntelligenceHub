import type { OpsReport } from './opsApi';

/** Map pin position for an ops report (GeoJSON Point [lng, lat]). */
export function reportMapLatLng(report: OpsReport): [number, number] | null {
  const coords = report.geom?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}
