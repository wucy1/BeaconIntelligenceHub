import type { OpsCrisis, OpsZone } from './opsApi';

const CRISES_KEY = 'bih-ops-crises-v1';
const ZONES_KEY = 'bih-ops-zones-v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function readOpsCrisesCache(): OpsCrisis[] | null {
  const items = readJson<OpsCrisis[]>(CRISES_KEY);
  return items?.length ? items : null;
}

export function writeOpsCrisesCache(items: OpsCrisis[]): void {
  writeJson(CRISES_KEY, items);
}

export function readOpsZonesCache(): OpsZone[] | null {
  const items = readJson<OpsZone[]>(ZONES_KEY);
  return items?.length ? items : null;
}

export function writeOpsZonesCache(items: OpsZone[]): void {
  writeJson(ZONES_KEY, items);
}
