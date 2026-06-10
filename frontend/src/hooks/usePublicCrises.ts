import { useCallback, useEffect, useState } from 'react';

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
};

const SELECT_KEY = 'bih-selected-crisis-id';
const CRISES_CACHE_KEY = 'bih-public-crises';

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

function pickCrisisId(items: PublicCrisis[], preferred?: string): string {
  if (preferred && items.some((c) => c.id === preferred)) return preferred;
  try {
    const saved = sessionStorage.getItem(SELECT_KEY);
    if (saved && items.some((c) => c.id === saved)) return saved;
  } catch {
    /* ignore */
  }
  return items[0]?.id ?? '';
}

export function usePublicCrises() {
  const [crises, setCrises] = useState<PublicCrisis[]>(() => readCachedCrises());
  const [selectedId, setSelectedId] = useState(() => pickCrisisId(readCachedCrises()));
  const [zones, setZones] = useState<PublicZone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [loading, setLoading] = useState(() => readCachedCrises().length === 0);
  const [error, setError] = useState<string | null>(null);
  const [needsFirstOnline, setNeedsFirstOnline] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const selectCrisis = useCallback((id: string) => {
    setSelectedId(id);
    try {
      sessionStorage.setItem(SELECT_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

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
          setSelectedId((prev) => pickCrisisId(cached, prev));
        } else {
          setCrises([]);
          setSelectedId('');
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
        setSelectedId((prev) => pickCrisisId(d.items, prev));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const cached = readCachedCrises();
        if (cached.length > 0) {
          setCrises(cached);
          setSelectedId((prev) => pickCrisisId(cached, prev));
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
    if (!selectedId) {
      setZones([]);
      setZonesLoading(false);
      return;
    }
    let cancelled = false;
    setZonesLoading(true);

    const loadZones = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setZonesLoading(false);
        return;
      }
      try {
        const d = await apiGet<{ items: PublicZone[] }>(`/v1/public/zones?crisis_id=${selectedId}`);
        if (!cancelled) setZones(d.items);
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
  }, [selectedId]);

  useEffect(() => {
    const onOnline = () => reload();
    globalThis.window.addEventListener('online', onOnline);
    return () => globalThis.window.removeEventListener('online', onOnline);
  }, [reload]);

  const selected = crises.find((c) => c.id === selectedId) ?? null;

  return {
    crises,
    selected,
    selectedId,
    selectCrisis,
    zones,
    zonesLoading,
    loading,
    error,
    reload,
    needsFirstOnline,
  };
}
