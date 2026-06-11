import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiGet } from '../api';

export type PublicCrisis = {
  id: string;
  slug: string;
  name: Record<string, string>;
  archive_status: string;
};

export type PublicZone = {
  id: string;
  name: string;
  geom: GeoJSON.Polygon;
  crisis_id?: string;
  crisis_slug?: string;
  crisis_name?: Record<string, string>;
  color?: string;
};

export type MapScope = 'all' | 'unspecified' | string;

const SELECT_KEY = 'bih-map-scope';
const CRISES_CACHE_KEY = 'bih-public-crises';
const ZONES_CACHE_KEY = 'bih-public-zones';

function readZonesCache(): Record<string, PublicZone[]> {
  try {
    const raw = sessionStorage.getItem(ZONES_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PublicZone[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeZonesCache(cache: Record<string, PublicZone[]>): void {
  try {
    sessionStorage.setItem(ZONES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function readCachedCrises(): PublicCrisis[] {
  try {
    const raw = localStorage.getItem(CRISES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PublicCrisis[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedCrises(items: PublicCrisis[]): void {
  try {
    localStorage.setItem(CRISES_CACHE_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function zonesCacheKey(scope: MapScope): string {
  return scope;
}

function pickScope(items: PublicCrisis[], preferred?: MapScope): MapScope {
  if (preferred === 'all' || preferred === 'unspecified') return preferred;
  if (preferred && items.some((c) => c.id === preferred)) return preferred;
  try {
    const saved = sessionStorage.getItem(SELECT_KEY);
    if (saved === 'all' || saved === 'unspecified') return saved;
    if (saved && items.some((c) => c.id === saved)) return saved;
  } catch {
    /* ignore */
  }
  return 'all';
}

function zonesUrl(scope: MapScope): string {
  if (scope === 'all') return '/v1/public/zones?scope=all';
  if (scope === 'unspecified') return '/v1/public/zones?scope=unspecified';
  return `/v1/public/zones?scope=crisis&crisis_id=${encodeURIComponent(scope)}`;
}

export function usePublicCrises() {
  const [crises, setCrises] = useState<PublicCrisis[]>(() => readCachedCrises());
  const [scope, setScope] = useState<MapScope>(() => pickScope(readCachedCrises()));
  const [zones, setZones] = useState<PublicZone[]>(() => {
    const s = pickScope(readCachedCrises());
    return readZonesCache()[zonesCacheKey(s)] ?? [];
  });
  const [zonesLoading, setZonesLoading] = useState(false);
  const [loading, setLoading] = useState(() => readCachedCrises().length === 0);
  const [error, setError] = useState<string | null>(null);
  const [needsFirstOnline, setNeedsFirstOnline] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const zonesCacheRef = useRef<Record<string, PublicZone[]>>(readZonesCache());

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const selectScope = useCallback((next: MapScope) => {
    setScope(next);
    try {
      sessionStorage.setItem(SELECT_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const unspecifiedCrisis = useMemo(
    () => crises.find((c) => c.slug === 'unspecified') ?? null,
    [crises],
  );

  const activeCrises = useMemo(
    () => crises.filter((c) => c.slug !== 'unspecified' && c.archive_status === 'active'),
    [crises],
  );

  const scopeCrisisId = scope !== 'all' && scope !== 'unspecified' ? scope : null;

  useEffect(() => {
    let cancelled = false;

    const loadCrises = async () => {
      const cached = readCachedCrises();
      if (cached.length === 0) setLoading(true);
      setError(null);
      setNeedsFirstOnline(false);

      if (!navigator.onLine) {
        if (cancelled) return;
        if (cached.length > 0) {
          setCrises(cached);
          setScope((prev) => pickScope(cached, prev));
        } else {
          setCrises([]);
          setScope('all');
          setNeedsFirstOnline(true);
        }
        setLoading(false);
        return;
      }

      try {
        const d = await apiGet<{ items: PublicCrisis[] }>('/v1/public/crises');
        if (cancelled) return;
        setCrises(d.items);
        writeCachedCrises(d.items);
        setScope((prev) => pickScope(d.items, prev));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const fallback = readCachedCrises();
        if (fallback.length > 0) {
          setCrises(fallback);
          setScope((prev) => pickScope(fallback, prev));
        } else {
          setCrises([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadCrises();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    const key = zonesCacheKey(scope);
    const cachedZones = zonesCacheRef.current[key];
    if (cachedZones) {
      setZones(cachedZones);
      setZonesLoading(false);
    } else {
      setZonesLoading(true);
    }

    const loadZones = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setZonesLoading(false);
        return;
      }
      try {
        const d = await apiGet<{ items: PublicZone[] }>(zonesUrl(scope));
        if (cancelled) return;
        zonesCacheRef.current[key] = d.items;
        writeZonesCache(zonesCacheRef.current);
        setZones(d.items);
      } catch {
        if (!cancelled) setZones([]);
      } finally {
        if (!cancelled) setZonesLoading(false);
      }
    };

    void loadZones();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(() => {
    const onOnline = () => reload();
    globalThis.window.addEventListener('online', onOnline);
    return () => globalThis.window.removeEventListener('online', onOnline);
  }, [reload]);

  const selectedCrisis = scopeCrisisId ? crises.find((c) => c.id === scopeCrisisId) ?? null : null;

  return {
    crises,
    scope,
    scopeCrisisId,
    selectScope,
    unspecifiedCrisis,
    activeCrises,
    selectedCrisis,
    zones,
    zonesLoading,
    loading,
    error,
    reload,
    needsFirstOnline,
    /** @deprecated use scope / scopeCrisisId */
    selectedId: scopeCrisisId ?? unspecifiedCrisis?.id ?? '',
    /** @deprecated use selectScope */
    selectCrisis: selectScope,
  };
}
