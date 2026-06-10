import type { LatLng } from './polygonUtils';

/** 點到線段上的最近投影點；回傳邊索引（插入於 index+1）與距離（度）。 */
export function nearestEdgeInsert(
  vertices: LatLng[],
  point: LatLng,
  closed: boolean,
): { edgeIndex: number; insertAt: number; projected: LatLng; distDeg: number } | null {
  if (vertices.length < 2) return null;
  const edgeCount = closed ? vertices.length : vertices.length - 1;
  let best: { edgeIndex: number; insertAt: number; projected: LatLng; distDeg: number } | null = null;

  for (let i = 0; i < edgeCount; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const projected = projectOnSegment(a, b, point);
    const distDeg = Math.hypot(projected.lat - point.lat, projected.lng - point.lng);
    if (!best || distDeg < best.distDeg) {
      best = { edgeIndex: i, insertAt: i + 1, projected, distDeg };
    }
  }
  return best;
}

function projectOnSegment(a: LatLng, b: LatLng, p: LatLng): LatLng {
  const abLat = b.lat - a.lat;
  const abLng = b.lng - a.lng;
  const len2 = abLat * abLat + abLng * abLng;
  if (len2 === 0) return { ...a };
  let t = ((p.lat - a.lat) * abLat + (p.lng - a.lng) * abLng) / len2;
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + t * abLat, lng: a.lng + t * abLng };
}

export function edgeMidpoints(vertices: LatLng[], closed: boolean): Array<{ index: number; lat: number; lng: number }> {
  if (vertices.length < 2) return [];
  const out: Array<{ index: number; lat: number; lng: number }> = [];
  const edgeCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    out.push({ index: i + 1, lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  }
  return out;
}
