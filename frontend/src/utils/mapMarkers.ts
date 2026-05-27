import type { MapMarker } from '../components/map/ContributorMap';

const DAMAGE_RANK: Record<string, number> = {
  minimal: 1,
  partial: 2,
  complete: 3,
};

export type SiteStatus = 'affected' | 'repaired' | 'demolished';
export type MapPinDisplay = 'damage' | 'repaired' | 'demolished';

/** One map pin per building or ~25 m cell. */
export type DisplayMapMarker = MapMarker & {
  reportCount: number;
  /** How the pin should render (damage color vs resolved). */
  pinDisplay: MapPinDisplay;
  /** Effective damage when pinDisplay === 'damage'. */
  displayDamageLevel: string;
};

function markerGroupKey(m: MapMarker): string {
  if (m.building_id) return `b:${m.building_id}`;
  const [lng, lat] = m.geom.coordinates;
  return `p:${lng.toFixed(5)},${lat.toFixed(5)}`;
}

function worstDamageLevel(levels: string[]): string {
  let best = 'minimal';
  let rank = 0;
  for (const d of levels) {
    const r = DAMAGE_RANK[d] ?? 0;
    if (r > rank) {
      rank = r;
      best = d;
    }
  }
  return best;
}

function normalizeSiteStatus(raw: string | undefined): SiteStatus {
  if (raw === 'repaired' || raw === 'demolished') return raw;
  return 'affected';
}

/** Latest observation wins for repaired/demolished; else worst active damage. */
export function resolveGroupDisplay(list: MapMarker[]): {
  pinDisplay: MapPinDisplay;
  displayDamageLevel: string;
} {
  const sorted = [...list].sort(
    (a, b) =>
      new Date(b.captured_at_client).getTime() - new Date(a.captured_at_client).getTime(),
  );
  const latestStatus = normalizeSiteStatus(sorted[0]?.site_status);
  if (latestStatus === 'repaired') {
    return { pinDisplay: 'repaired', displayDamageLevel: sorted[0].damage_level };
  }
  if (latestStatus === 'demolished') {
    return { pinDisplay: 'demolished', displayDamageLevel: sorted[0].damage_level };
  }
  const active = list.filter((m) => normalizeSiteStatus(m.site_status) === 'affected');
  const pool = active.length > 0 ? active : list;
  return {
    pinDisplay: 'damage',
    displayDamageLevel: worstDamageLevel(pool.map((x) => x.damage_level)),
  };
}

export const PIN_FILL: Record<MapPinDisplay, string> = {
  damage: '', // filled per damage level
  repaired: '#0ea5e9',
  demolished: '#64748b',
};

export const DAMAGE_FILL: Record<string, string> = {
  minimal: '#22c55e',
  partial: '#f59e0b',
  complete: '#ef4444',
};

export function pinFillColor(m: DisplayMapMarker): string {
  if (m.pinDisplay === 'repaired') return PIN_FILL.repaired;
  if (m.pinDisplay === 'demolished') return PIN_FILL.demolished;
  return DAMAGE_FILL[m.displayDamageLevel] ?? '#64748b';
}

export function aggregateMarkersForDisplay(markers: MapMarker[]): DisplayMapMarker[] {
  const groups = new Map<string, MapMarker[]>();
  for (const m of markers) {
    const key = markerGroupKey(m);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const out: DisplayMapMarker[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) =>
        new Date(b.captured_at_client).getTime() - new Date(a.captured_at_client).getTime(),
    );
    const latest = sorted[0];
    const { pinDisplay, displayDamageLevel } = resolveGroupDisplay(list);
    out.push({
      ...latest,
      damage_level: displayDamageLevel,
      pinDisplay,
      displayDamageLevel,
      reportCount: list.length,
    });
  }
  return out;
}
