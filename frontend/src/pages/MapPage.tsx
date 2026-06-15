import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiGet, BUILDINGS_FETCH_TIMEOUT_MS, wakeApiBackend } from '../api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ContributorMap, type MapMarker } from '../components/map/ContributorMap';
import {
  LocationPanel,
  type LocationPanelContext,
} from '../components/map/LocationPanel';
import { LocationPrompt } from '../components/map/LocationPrompt';
import { MapLegend } from '../components/map/MapLegend';
import { MapModeToggle, type MapMode } from '../components/map/MapModeToggle';
import { ContributionStrip } from '../components/map/ContributionStrip';
import { PlacementBar } from '../components/map/PlacementBar';
import { ReportSheet } from '../components/map/ReportSheet';
import { OfflineBanner } from '../components/OfflineBanner';
import { UNSPECIFIED_CRISIS_ID } from '../constants/crisis';
import { NYC_DEMO_MAP_VIEW } from '../constants/nycDemoFootprints';
import { usePublicCrises } from '../hooks/usePublicCrises';
import { useGeolocation } from '../hooks/useGeolocation';
import { useOfflineMapTiles } from '../hooks/useOfflineMapTiles';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  clearFailedReports,
  listPendingSummaries,
  removePendingReport,
  retryPendingReport,
  syncQueue,
  type PendingReportSummary,
} from '../offline/queue';
import type { MapRegionMeta } from '../offline/tileCache';
import { loadFootprintsForBbox, MAX_OFFLINE_FOOTPRINT_FEATURES } from '../offline/buildingFootprintCache';
import { useI18n } from '../i18n/I18nContext';
import { getOpsToken } from '../ops/opsAuth';
import {
  DEFAULT_BOX_SIDE_KM,
  DEFAULT_RADIUS_KM,
  PREFETCH_ZOOM_MAX,
  PREFETCH_ZOOM_MIN,
} from '../offline/tileMath';
import {
  buildingFeatureById,
  centroidOfFeature,
  findBuildingAtPoint,
  markersNearPoint,
} from '../utils/buildingAtPoint';
import { filterMarkersInBbox } from '../utils/mapBbox';

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 14;
/** 定位鈕：飛到使用者並放大至街道層級 */
const LOCATE_ZOOM = 17;
const MAP_CENTER_STORAGE_KEY_PREFIX = 'bih-map-center';

type Placement = {
  buildingId: string | null;
  buildingName: string | null;
  pin: { lat: number; lng: number } | null;
};

type TopPanelKey = 'contribution' | 'offline' | 'legend' | null;

const OFFLINE_INCLUDE_FOOTPRINTS_KEY = 'bih-offline-include-footprints';

function emptyPlacement(): Placement {
  return { buildingId: null, buildingName: null, pin: null };
}

function centerFromBbox(bbox: string | null): { lat: number; lng: number } | null {
  if (!bbox) return null;
  const parts = bbox.split(',').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [west, south, east, north] = parts;
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

function fmtCoord(v: number): string {
  return v.toFixed(5);
}

export function MapPage() {
  const { t, locale } = useI18n();
  const [reportWindowMonths, setReportWindowMonths] = useState<number | null>(null);
  const {
    crises: publicCrises,
    scope: mapScope,
    scopeCrisisId,
    selectScope,
    unspecifiedCrisis,
    activeCrises,
    zones: publicZones,
    error: crisesError,
    loading: crisesLoading,
    reload: reloadCrises,
    needsFirstOnline,
  } = usePublicCrises();
  const [searchParams] = useSearchParams();
  const urlBootstrappedRef = useRef(false);
  const online = useOnlineStatus();
  const wasOfflineRef = useRef(false);
  const geo = useGeolocation();
  const bboxRef = useRef<string | null>(null);

  const [mapMode, setMapMode] = useState<MapMode>('all');
  const [bbox, setBbox] = useState<string | null>(null);
  const [viewCenter, setViewCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [viewZoom, setViewZoom] = useState<number | null>(null);
  const [buildings, setBuildings] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [allMarkers, setAllMarkers] = useState<MapMarker[]>([]);
  const [placement, setPlacement] = useState<Placement>(emptyPlacement);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectContext, setInspectContext] = useState<LocationPanelContext>('all');
  const [focusedMarker, setFocusedMarker] = useState<MapMarker | null>(null);
  const [inspectMarkers, setInspectMarkers] = useState<MapMarker[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('create');
  const [editReportId, setEditReportId] = useState<string | undefined>();
  const [locationPromptOpen, setLocationPromptOpen] = useState(() => {
    try {
      return !sessionStorage.getItem('bih-location-prompted');
    } catch {
      return true;
    }
  });
  const [flyTarget, setFlyTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const [locatePending, setLocatePending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** 每次開啟「新增」表單遞增，強制 ReportSheet 重掛載以免殘留編輯資料 */
  const [formSession, setFormSession] = useState(0);
  const [duplicateBanner, setDuplicateBanner] = useState(false);
  /** 首次取得 GPS 後自動飛一次（同意定位或 ◎），避免一直停在台北示範預設中心 */
  const autoFlewToUserRef = useRef(false);
  const offlineRegionBootstrappedRef = useRef(false);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [activeTopPanel, setActiveTopPanel] = useState<TopPanelKey>(null);
  const [pendingReports, setPendingReports] = useState<PendingReportSummary[]>([]);
  const [queueSyncing, setQueueSyncing] = useState(false);
  const [queueCleaning, setQueueCleaning] = useState(false);
  const [queueLastSync, setQueueLastSync] = useState<{
    synced: number;
    failed: number;
    at: string;
  } | null>(null);
  const [queueFlash, setQueueFlash] = useState(false);
  const queueCardRef = useRef<HTMLDivElement | null>(null);
  const [offlineIncludeFootprints, setOfflineIncludeFootprints] = useState(() => {
    try {
      return localStorage.getItem(OFFLINE_INCLUDE_FOOTPRINTS_KEY) === '1';
    } catch {
      return false;
    }
  });

  bboxRef.current = bbox;

  const reportCrisisId = unspecifiedCrisis?.id ?? UNSPECIFIED_CRISIS_ID;
  const scopeRef = useRef(mapScope);
  scopeRef.current = mapScope;
  const buildingsCacheRef = useRef<Record<string, GeoJSON.FeatureCollection>>({});
  const markersCacheRef = useRef<Record<string, MapMarker[]>>({});
  /** 全站共用視角；切換危機時不跳地圖位置 */
  const mapCenterStorageKey = `${MAP_CENTER_STORAGE_KEY_PREFIX}:view`;

  const [zoneFitTick, setZoneFitTick] = useState(0);
  const zoneFitBounds = useMemo(() => {
    if (publicZones.length === 0) return null;
    const bounds = L.latLngBounds([]);
    for (const z of publicZones) {
      z.geom.coordinates[0].forEach(([lng, lat]) => bounds.extend([lat, lng]));
    }
    return bounds.isValid() ? bounds : null;
  }, [publicZones]);

  const savedView = useMemo((): { lat: number; lng: number; zoom: number } | null => {
    try {
      const raw = localStorage.getItem(mapCenterStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { lat?: number; lng?: number; zoom?: number };
      if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        zoom: typeof parsed.zoom === 'number' ? parsed.zoom : DEFAULT_ZOOM,
      };
    } catch {
      return null;
    }
  }, [mapCenterStorageKey]);
  const mapCenter = useMemo((): [number, number] => {
    if (savedView) return [savedView.lat, savedView.lng];
    if (geo.position) return [geo.position.lat, geo.position.lng];
    return DEFAULT_CENTER;
  }, [geo.position, savedView]);
  const mapZoom = savedView?.zoom ?? DEFAULT_ZOOM;
  /** 下載／離線覆蓋範圍：用 bbox 中心（moveend 才更新），不跟 ViewWatcher 每幀漂移 */
  const tileCenter = useMemo(() => {
    const fromBbox = centerFromBbox(bbox);
    if (fromBbox) return fromBbox;
    if (geo.position) return { lat: geo.position.lat, lng: geo.position.lng };
    return { lat: mapCenter[0], lng: mapCenter[1] };
  }, [bbox, geo.position, mapCenter]);
  const offlineTiles = useOfflineMapTiles(tileCenter);

  /** 離線時鎖在已下載的縮放級，避免放大到無瓦片的灰屏 */
  const offlineZoomLimits = useMemo(() => {
    if (online) return null;
    const active = activeRegionId
      ? offlineTiles.regions.find((r) => r.id === activeRegionId)
      : offlineTiles.regions[0];
    return {
      minZoom: active?.zMin ?? PREFETCH_ZOOM_MIN,
      maxZoom: Math.min(active?.zMax ?? PREFETCH_ZOOM_MAX, PREFETCH_ZOOM_MAX),
    };
  }, [online, activeRegionId, offlineTiles.regions]);

  /** 中心紅框：永遠顯示，由圖層直接跟隨 map.getCenter()，不經 React state */
  const downloadPreview = useMemo(
    () => ({
      sideKm: DEFAULT_BOX_SIDE_KM,
      variant: 'target' as const,
      anchorToMapCenter: true,
    }),
    [],
  );

  const goToRegion = useCallback(
    (r: MapRegionMeta, opts?: { adjustZoom?: boolean }) => {
      setActiveRegionId(r.id);
      const adjustZoom = opts?.adjustZoom ?? !online;
      setFlyTarget({
        lat: r.center.lat,
        lng: r.center.lng,
        zoom: adjustZoom ? PREFETCH_ZOOM_MAX : undefined,
      });
    },
    [online],
  );

  const onFlyComplete = useCallback(() => {
    setFlyTarget(null);
  }, []);

  useEffect(() => {
    if (!online) return;
    void wakeApiBackend();
  }, [online]);

  useEffect(() => {
    apiGet<{ default_report_months?: number }>('/v1/public/active-window')
      .then((w) => setReportWindowMonths(w.default_report_months ?? null))
      .catch(() => setReportWindowMonths(null));
  }, []);

  /** 恢復連線時自動切回連線地圖（不重複顯示橫幅） */
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    setActiveRegionId(null);
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      reloadCrises();
      setRefreshKey((k) => k + 1);
    }
  }, [online, reloadCrises]);

  useEffect(() => {
    if (online) {
      offlineRegionBootstrappedRef.current = false;
      return;
    }
    if (offlineTiles.regions.length === 0 || activeRegionId) return;
    if (mapMode === 'new' || placement.pin) return;
    if (offlineRegionBootstrappedRef.current) return;
    offlineRegionBootstrappedRef.current = true;
    const point = tileCenter ?? { lat: mapCenter[0], lng: mapCenter[1] };
    let pick = offlineTiles.regions[0];
    let bestD = Infinity;
    for (const r of offlineTiles.regions) {
      const d =
        (r.center.lat - point.lat) ** 2 + (r.center.lng - point.lng) ** 2;
      if (d < bestD) {
        bestD = d;
        pick = r;
      }
    }
    goToRegion(pick, { adjustZoom: true });
  }, [
    online,
    offlineTiles.regions,
    activeRegionId,
    mapMode,
    placement.pin,
    tileCenter,
    mapCenter,
    goToRegion,
  ]);

  const setPinWithDetect = useCallback(
    (lat: number, lng: number, buildingsFc: GeoJSON.FeatureCollection) => {
      const hit = findBuildingAtPoint(lat, lng, buildingsFc);
      setPlacement({
        pin: { lat, lng },
        buildingId: hit?.id ?? null,
        buildingName: hit?.name ?? null,
      });
    },
    [],
  );

  const setBuildingPlacement = useCallback(
    (buildingId: string, buildingsFc: GeoJSON.FeatureCollection) => {
      const feat = buildingFeatureById(buildingsFc, buildingId);
      const name = (feat?.properties?.name as string | undefined) ?? null;
      const cen = feat ? centroidOfFeature(feat) : null;
      if (cen) {
        setPlacement({ buildingId, buildingName: name, pin: cen });
      } else {
        setPlacement({ buildingId, buildingName: name, pin: null });
      }
    },
    [],
  );

  const clearPlacement = useCallback(() => {
    setPlacement(emptyPlacement());
    setInspectOpen(false);
    setFocusedMarker(null);
  }, []);

  /** Leave "new" mode: back to All, clear pin and any open form. */
  const cancelNewReport = useCallback(() => {
    setMapMode('all');
    setSheetOpen(false);
    setSheetMode('create');
    setEditReportId(undefined);
    clearPlacement();
  }, [clearPlacement]);

  const dismissLocationPrompt = useCallback(
    (allow: boolean) => {
      try {
        sessionStorage.setItem('bih-location-prompted', '1');
      } catch {
        /* ignore */
      }
      setLocationPromptOpen(false);
      if (allow) geo.request();
    },
    [geo],
  );

  const buildingsCacheKey = useMemo(() => {
    if (mapScope === 'all') return `all:${activeCrises.map((c) => c.id).join(',')}`;
    if (mapScope === 'unspecified') return 'unspecified';
    return mapScope;
  }, [mapScope, activeCrises]);

  const crisisIdsForFootprints = useMemo(() => {
    if (mapScope === 'unspecified') return [] as string[];
    if (mapScope === 'all') return activeCrises.map((c) => c.id);
    return [mapScope];
  }, [mapScope, activeCrises]);

  const flyToDemoFootprints = useCallback(() => {
    setFlyTarget({ ...NYC_DEMO_MAP_VIEW });
    setActiveTopPanel('legend');
  }, []);

  useEffect(() => {
    if (urlBootstrappedRef.current || crisesLoading) return;
    const crisisParam = searchParams.get('crisis') ?? searchParams.get('crisis_id');
    if (crisisParam && publicCrises.some((c) => c.id === crisisParam)) {
      selectScope(crisisParam);
    }
    if (searchParams.get('fly') === 'demo') {
      flyToDemoFootprints();
    }
    urlBootstrappedRef.current = true;
  }, [crisesLoading, publicCrises, searchParams, selectScope, flyToDemoFootprints]);

  useEffect(() => {
    if (!online || !bbox || publicCrises.length === 0 || crisesLoading) return;
    const requestedScope = mapScope;
    const requestedBbox = bbox;
    const timer = setTimeout(() => {
      const q = encodeURIComponent(requestedBbox);
      setBuildingsError(null);
      setBuildingsLoading(true);
      const loadBuildings = async (): Promise<GeoJSON.FeatureCollection | null> => {
        if (requestedScope === 'unspecified') {
          return { type: 'FeatureCollection', features: [] };
        }
        const crisisIds =
          requestedScope === 'all'
            ? activeCrises.map((c) => c.id)
            : [requestedScope];
        if (crisisIds.length === 0) {
          return null;
        }
        const results = await Promise.allSettled(
          crisisIds.map((id) =>
            apiGet<GeoJSON.FeatureCollection>(`/v1/crises/${id}/buildings?bbox=${q}`, {
              timeoutMs: BUILDINGS_FETCH_TIMEOUT_MS,
              maxAttempts: 2,
            }),
          ),
        );
        const seen = new Set<string>();
        const features: GeoJSON.Feature[] = [];
        let failures = 0;
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status !== 'fulfilled') {
            failures += 1;
            continue;
          }
          const cid = crisisIds[i];
          const list = result.value.features ?? [];
          for (const f of list) {
            const bid = (f.properties?.building_id as string) ?? '';
            if (bid && seen.has(bid)) continue;
            if (bid) seen.add(bid);
            features.push({
              ...f,
              properties: { ...f.properties, crisis_id: cid },
            });
          }
        }
        if (failures > 0 && features.length === 0) {
          throw new Error(`Failed to load footprints (${failures}/${crisisIds.length} crises)`);
        }
        if (failures > 0) {
          setBuildingsError(
            t('map.err.buildingsPartial', { failed: failures, total: crisisIds.length }),
          );
        }
        return { type: 'FeatureCollection', features };
      };
      void loadBuildings()
        .then((fc) => {
          if (fc === null) return;
          if (bboxRef.current !== requestedBbox || scopeRef.current !== requestedScope) return;
          buildingsCacheRef.current[buildingsCacheKey] = fc;
          setBuildings(fc);
        })
        .catch((e: Error) => {
          if (bboxRef.current !== requestedBbox || scopeRef.current !== requestedScope) return;
          setBuildingsError(e.message);
        })
        .finally(() => {
          if (bboxRef.current === requestedBbox && scopeRef.current === requestedScope) {
            setBuildingsLoading(false);
          }
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      setBuildingsLoading(false);
    };
  }, [online, mapScope, bbox, refreshKey, publicCrises.length, activeCrises, buildingsCacheKey, crisesLoading, t]);

  useEffect(() => {
    if (online || !bbox) return;
    const requestedBbox = bbox;
    void loadFootprintsForBbox(requestedBbox).then((fc) => {
      if (bboxRef.current !== requestedBbox) return;
      if (fc.features.length === 0) return;
      buildingsCacheRef.current[buildingsCacheKey] = fc;
      setBuildings(fc);
      setBuildingsError(null);
    });
  }, [online, bbox, buildingsCacheKey]);

  useEffect(() => {
    if (!online || !bbox || mapMode === 'new' || inspectOpen) {
      if (mapMode === 'new') {
        setMarkers([]);
        setAllMarkers([]);
      }
      return;
    }
    const requestedBbox = bbox;
    const requestedScope = mapScope;
    const timer = setTimeout(() => {
      const scopeParam =
        requestedScope === 'all' || requestedScope === 'unspecified'
          ? `scope=${requestedScope}`
          : `scope=crisis&crisis_id=${encodeURIComponent(requestedScope)}`;
      const bboxQ = encodeURIComponent(requestedBbox);
      const fetchMarkers = (mode: MapMode) =>
        apiGet<{ items: MapMarker[] }>(
          `/v1/public/markers?bbox=${bboxQ}&mode=${mode}&${scopeParam}`,
        );

      const applyResults = (pinItems: MapMarker[], aggregateItems: MapMarker[]) => {
        if (bboxRef.current !== requestedBbox || scopeRef.current !== requestedScope) return;
        const pinFiltered = filterMarkersInBbox(pinItems, requestedBbox);
        const allFiltered = filterMarkersInBbox(aggregateItems, requestedBbox);
        setMarkers(pinFiltered);
        setAllMarkers(allFiltered);
        markersCacheRef.current[`${requestedScope}:${mapMode}`] = pinFiltered;
        markersCacheRef.current[`${requestedScope}:all`] = allFiltered;
      };

      if (mapMode === 'mine') {
        void Promise.all([fetchMarkers('mine'), fetchMarkers('all')])
          .then(([mineRes, allRes]) => applyResults(mineRes.items, allRes.items))
          .catch(() => {
            if (bboxRef.current !== requestedBbox || scopeRef.current !== requestedScope) return;
            setMarkers([]);
            setAllMarkers([]);
          });
      } else {
        void fetchMarkers(mapMode)
          .then((r) => applyResults(r.items, r.items))
          .catch(() => {
            if (bboxRef.current !== requestedBbox || scopeRef.current !== requestedScope) return;
            setMarkers([]);
            setAllMarkers([]);
          });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [online, bbox, mapMode, mapScope, refreshKey, inspectOpen]);

  const showOthers = mapMode === 'all';

  const openInspectAt = useCallback(
    (
      buildingId: string | null,
      buildingName: string | null,
      pin: { lat: number; lng: number },
      marker: MapMarker | null,
      context: LocationPanelContext,
    ) => {
      setPlacement({ buildingId, buildingName, pin });
      setFocusedMarker(marker);
      setInspectContext(context);
      const near = markersNearPoint(markers, pin.lat, pin.lng, buildingId);
      setInspectMarkers(
        near.length > 0 ? near : markers.filter((m) => m.building_id === buildingId),
      );
      setInspectOpen(true);
      setSheetOpen(false);
    },
    [markers],
  );

  const openBuildingInspect = useCallback(
    (id: string, context: LocationPanelContext) => {
      const feat = buildingFeatureById(buildings, id);
      const name = (feat?.properties?.name as string | undefined) ?? null;
      const cen = feat ? centroidOfFeature(feat) : null;
      if (!cen) return;
      const marker =
        markers.find((m) => m.building_id === id && m.is_mine) ??
        markers.find((m) => m.building_id === id) ??
        null;
      openInspectAt(id, name, cen, marker, context);
    },
    [buildings, markers, openInspectAt],
  );

  const onBuildingSelect = useCallback(
    (id: string | null) => {
      if (!id) return;
      if (mapMode === 'new') {
        setSheetOpen(false);
        setBuildingPlacement(id, buildings);
      }
    },
    [mapMode, buildings, setBuildingPlacement],
  );

  const onBuildingViewDetails = useCallback(
    (id: string) => {
      openBuildingInspect(id, mapMode === 'mine' ? 'mine' : 'all');
    },
    [mapMode, openBuildingInspect],
  );

  const onMapPlace = useCallback(
    (lat: number, lng: number) => {
      if (mapMode !== 'new') return;
      // 使用者已手動放置圖釘，避免晚到的 GPS 首次自動飛行把視圖拉走。
      autoFlewToUserRef.current = true;
      setSheetOpen(false);
      setPinWithDetect(lat, lng, buildings);
    },
    [mapMode, buildings, setPinWithDetect],
  );

  const onMarkerViewDetails = useCallback(
    (m: MapMarker) => {
      const [lng, lat] = m.geom.coordinates;
      const feat = m.building_id ? buildingFeatureById(buildings, m.building_id) : undefined;
      const name = (feat?.properties?.name as string | undefined) ?? null;
      const context: LocationPanelContext =
        mapMode === 'mine' && m.is_mine ? 'mine' : 'all';
      openInspectAt(m.building_id, name, { lat, lng }, m, context);
    },
    [mapMode, buildings, openInspectAt],
  );

  const onEditReport = useCallback(
    (reportId: string) => {
      const m =
        markers.find((x) => x.id === reportId) ??
        focusedMarker ??
        inspectMarkers.find((x) => x.id === reportId);
      if (m) {
        const [lng, lat] = m.geom.coordinates;
        const feat = m.building_id ? buildingFeatureById(buildings, m.building_id) : undefined;
        setPlacement({
          buildingId: m.building_id,
          buildingName: (feat?.properties?.name as string | undefined) ?? null,
          pin: { lat, lng },
        });
      }
      setSheetMode('edit');
      setEditReportId(reportId);
      setInspectOpen(false);
      setSheetOpen(true);
    },
    [markers, focusedMarker, inspectMarkers, buildings],
  );

  const openCreateSheet = useCallback(() => {
    setSheetMode('create');
    setEditReportId(undefined);
    setFormSession((n) => n + 1);
    setSheetOpen(true);
  }, []);

  /** 在既有標記／地點追加回報：保留座標，直接開啟新建表單 */
  const onAddReportHere = useCallback(() => {
    setMapMode('new');
    setInspectOpen(false);
    setFocusedMarker(null);
    openCreateSheet();
  }, [openCreateSheet]);

  const onSaved = useCallback((meta?: { possibleDuplicate?: boolean }) => {
    setRefreshKey((k) => k + 1);
    clearPlacement();
    setSheetOpen(false);
    setMapMode('mine');
    if (meta?.possibleDuplicate) setDuplicateBanner(true);
  }, [clearPlacement]);

  const markerPopupLabels = useMemo(
    () => ({
      damageLabel: (level: string) =>
        t(`report.damage.${level as 'minimal' | 'partial' | 'complete'}`),
      mineLabel: t('map.mode.mine'),
      reportCount: (count: number) => t('map.popup.reportCount', { count }),
      viewDetails: t('map.popup.viewDetails'),
      siteRepaired: t('report.siteStatus.repaired'),
      siteDemolished: t('report.siteStatus.demolished'),
    }),
    [t],
  );

  const onLocateMe = useCallback(() => {
    setMapMode('new');
    setSheetOpen(false);
    setInspectOpen(false);
    setLocatePending(true);
    if (geo.position) {
      setFlyTarget({ lat: geo.position.lat, lng: geo.position.lng, zoom: LOCATE_ZOOM });
      setPinWithDetect(geo.position.lat, geo.position.lng, buildings);
      setLocatePending(false);
    }
    geo.request();
  }, [geo, buildings, setPinWithDetect]);

  const onDownloadOfflineArea = useCallback(() => {
    if (!tileCenter) {
      geo.request();
      return;
    }
    void offlineTiles.download(tileCenter, {
      includeFootprints: offlineIncludeFootprints,
      crisisIds: crisisIdsForFootprints,
    });
  }, [tileCenter, geo, offlineTiles, offlineIncludeFootprints, crisisIdsForFootprints]);

  const onToggleOfflineFootprints = useCallback((checked: boolean) => {
    setOfflineIncludeFootprints(checked);
    try {
      localStorage.setItem(OFFLINE_INCLUDE_FOOTPRINTS_KEY, checked ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!locatePending || !geo.position) return;
    setFlyTarget({ lat: geo.position.lat, lng: geo.position.lng, zoom: LOCATE_ZOOM });
    setPinWithDetect(geo.position.lat, geo.position.lng, buildings);
    setLocatePending(false);
  }, [locatePending, geo.position, buildings, setPinWithDetect]);

  useEffect(() => {
    if (!locatePending || geo.pending) return;
    if (geo.denied) setLocatePending(false);
  }, [locatePending, geo.denied, geo.pending]);

  useEffect(() => {
    if (!geo.position || autoFlewToUserRef.current) return;
    // 新增回報流程中，禁止自動置中/放大，避免圖釘看起來「漂移」。
    if (mapMode === 'new') return;
    autoFlewToUserRef.current = true;
    if (savedView) return;
    setFlyTarget({ lat: geo.position.lat, lng: geo.position.lng });
  }, [geo.position, mapMode, savedView]);

  const onViewChange = useCallback((view: { lat: number; lng: number; zoom: number }) => {
    setViewCenter({ lat: view.lat, lng: view.lng });
    setViewZoom(view.zoom);
  }, []);

  useEffect(() => {
    if (!viewCenter || viewZoom == null) return;
    try {
      localStorage.setItem(
        mapCenterStorageKey,
        JSON.stringify({ lat: viewCenter.lat, lng: viewCenter.lng, zoom: viewZoom }),
      );
    } catch {
      // ignore storage failures
    }
  }, [viewCenter, viewZoom, mapCenterStorageKey]);

  const refreshPendingReports = useCallback(() => {
    void listPendingSummaries()
      .then(setPendingReports)
      .catch(() => setPendingReports([]));
  }, []);

  useEffect(() => {
    refreshPendingReports();
  }, [refreshPendingReports]);

  useEffect(() => {
    const id = window.setInterval(refreshPendingReports, 6000);
    return () => window.clearInterval(id);
  }, [refreshPendingReports]);

  const onSyncQueueNow = useCallback(() => {
    setQueueSyncing(true);
    void syncQueue()
      .then((r) => {
        setQueueLastSync({ ...r, at: new Date().toISOString() });
        setQueueFlash(true);
        queueCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
      .finally(() => {
        setQueueSyncing(false);
        refreshPendingReports();
      });
  }, [refreshPendingReports]);

  const onClearFailedQueue = useCallback(() => {
    setQueueCleaning(true);
    void clearFailedReports()
      .finally(() => {
        setQueueCleaning(false);
        refreshPendingReports();
      });
  }, [refreshPendingReports]);

  const onRemoveQueuedItem = useCallback(
    (id: string) => {
      void removePendingReport(id).then(refreshPendingReports);
    },
    [refreshPendingReports],
  );

  const onRetryQueuedItem = useCallback(
    (id: string) => {
      void retryPendingReport(id)
        .then((ok) => {
          if (ok) {
            setQueueLastSync({ synced: 1, failed: 0, at: new Date().toISOString() });
            setQueueFlash(true);
            queueCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        })
        .finally(refreshPendingReports);
    },
    [refreshPendingReports],
  );

  useEffect(() => {
    if (!queueFlash) return;
    const id = window.setTimeout(() => setQueueFlash(false), 2200);
    return () => window.clearTimeout(id);
  }, [queueFlash]);

  const reportGeom = useMemo((): GeoJSON.Point | null => {
    if (!placement.pin) return null;
    return {
      type: 'Point',
      coordinates: [placement.pin.lng, placement.pin.lat],
    };
  }, [placement.pin]);

  const onReportPinMove = useCallback(
    (lat: number, lng: number) => {
      autoFlewToUserRef.current = true;
      setPinWithDetect(lat, lng, buildings);
    },
    [buildings, setPinWithDetect],
  );

  /** Blue +: enter new-report mode only — pin via map tap or locate (◎), not silent GPS. */
  const onStartNewReport = useCallback(() => {
    setMapMode('new');
    setSheetOpen(false);
    setInspectOpen(false);
    clearPlacement();
  }, [clearPlacement]);

  const onModeChange = useCallback(
    (mode: MapMode) => {
      setMapMode(mode);
      setSheetOpen(false);
      setInspectOpen(false);
      setFocusedMarker(null);
      clearPlacement();
    },
    [clearPlacement],
  );

  const onOpenForm = useCallback(() => {
    openCreateSheet();
  }, [openCreateSheet]);

  const reportSheetKey =
    !sheetOpen
      ? 'closed'
      : sheetMode === 'edit' && editReportId
        ? `edit-${editReportId}`
        : `create-${formSession}`;

  const hasPlacement = Boolean(placement.pin || placement.buildingId);
  const showPlacementBar = mapMode === 'new' && hasPlacement && !sheetOpen;
  const showNewFlowCancel = mapMode === 'new' && !hasPlacement && !sheetOpen;

  const onSelectScope = useCallback(
    (next: string) => {
      setZoneFitTick(0);
      const scopeKey =
        next === 'all' ? `all:${activeCrises.map((c) => c.id).join(',')}` : next;
      const cachedBuildings = buildingsCacheRef.current[scopeKey];
      if (cachedBuildings) setBuildings(cachedBuildings);
      const cachedMarkers = markersCacheRef.current[`${next}:${mapMode}`];
      if (cachedMarkers && bboxRef.current) {
        setMarkers(filterMarkersInBbox(cachedMarkers, bboxRef.current));
      }
      const cachedAllMarkers = markersCacheRef.current[`${next}:all`];
      if (cachedAllMarkers && bboxRef.current) {
        setAllMarkers(filterMarkersInBbox(cachedAllMarkers, bboxRef.current));
      }
      selectScope(next);
    },
    [selectScope, mapMode, activeCrises],
  );

  const crisisLabel = useCallback(
    (c: { name: Record<string, string>; slug: string }) => {
      const n = c.name;
      return (
        (n[locale] as string) ||
        (n['zh-Hant'] as string) ||
        (n.zh as string) ||
        (n.en as string) ||
        c.slug
      );
    },
    [locale],
  );

  if (publicCrises.length === 0) {
    if (crisesLoading) {
      return <p className="map-status">{t('common.loading')}</p>;
    }
    if (needsFirstOnline) {
    return (
      <section className="map-status card">
        <p className="error">{t('map.offline.needFirstVisit')}</p>
        <p className="muted">{t('map.offline.needFirstVisitHint')}</p>
        <button type="button" onClick={reloadCrises}>
          {t('map.retry')}
        </button>
      </section>
    );
    }
    if (crisesError || publicCrises.length === 0) {
      return (
        <section className="map-status card">
          <p className="error">{crisesError ?? t('map.err.noWindow')}</p>
          <p className="muted">{t('map.err.backendSteps')}</p>
          <pre className="map-cmd-hint">cd backend; uvicorn app.main:app --reload --port 8000</pre>
          <button type="button" onClick={reloadCrises}>
            {t('map.retry')}
          </button>
        </section>
      );
    }
    return (
      <section className="map-status card">
        <p className="muted">{t('map.err.noWindow')}</p>
        <button type="button" onClick={reloadCrises}>
          {t('map.retry')}
        </button>
      </section>
    );
  }
  const contributionPanelOpen = activeTopPanel === 'contribution' && publicCrises.length > 0;
  const contributionFetchable = online && mapMode !== 'new' && publicCrises.length > 0;
  const connectionLampClass = online
    ? 'map-connection-lamp online'
    : 'map-connection-lamp offline';
  const queueStatusLabel = (status: PendingReportSummary['status']) =>
    t(`map.offline.queueStatus.${status}` as const);

  const toggleTopPanel = (panel: Exclude<TopPanelKey, null>) => {
    if (panel === 'contribution' && publicCrises.length === 0) return;
    setActiveTopPanel((prev) => (prev === panel ? null : panel));
  };

  const mapRailFabCount = publicZones.length > 0 ? 3 : 2;

  return (
    <div className="map-page" data-map-rail-fabs={mapRailFabCount}>
      <OfflineBanner mapPage />
      <ContributorMap
        key="contributor-map"
        buildings={buildings}
        markers={markers}
        buildingMarkers={allMarkers}
        selectedBuildingId={placement.buildingId}
        userPosition={geo.position}
        showOthers={showOthers}
        onBuildingSelect={onBuildingSelect}
        onBuildingViewDetails={onBuildingViewDetails}
        onMarkerViewDetails={onMarkerViewDetails}
        markerPopupLabels={markerPopupLabels}
        onBboxChange={setBbox}
        onViewChange={onViewChange}
        flyTo={flyTarget}
        onFlyComplete={onFlyComplete}
        initialCenter={mapCenter}
        initialZoom={mapZoom}
        crisisZones={publicZones}
        zoneFitBounds={zoneFitBounds}
        zoneFitTick={zoneFitTick}
        mapMode={mapMode}
        reportPin={mapMode === 'new' ? placement.pin : null}
        onMapPlace={onMapPlace}
        onReportPinMove={onReportPinMove}
        online={online}
        offlineZoomLimits={offlineZoomLimits}
        savedRegions={offlineTiles.regions}
        activeSavedRegionId={activeRegionId}
        onSavedRegionSelect={(id) => {
          const r = offlineTiles.regions.find((x) => x.id === id);
          if (!r) return;
          if (mapMode === 'new') {
            setActiveRegionId(r.id);
            return;
          }
          goToRegion(r, { adjustZoom: false });
        }}
        downloadPreview={downloadPreview}
      />

      {activeTopPanel && (
        <section className="map-overlay-panel-host">
          <button
            type="button"
            className="map-overlay-panel-close"
            onClick={() => setActiveTopPanel(null)}
            aria-label={t('common.cancel')}
          >
            ×
          </button>
          {activeTopPanel === 'contribution' && (
            <>
              <ContributionStrip
                scope={mapScope}
                crisisId={scopeCrisisId}
                visible={contributionPanelOpen}
                fetchable={contributionFetchable}
                refreshKey={refreshKey}
                embedded
              />
              <div
                ref={queueCardRef}
                className={queueFlash ? 'map-offline-queue-card flash' : 'map-offline-queue-card'}
              >
                <p className="map-offline-download-title">{t('map.offline.queueTitle')}</p>
                <p className="map-offline-download-meta">
                  {t('map.offline.queuePending', { count: pendingReports.length })}
                </p>
                {queueLastSync && (
                  <p className="map-offline-download-meta">
                    {t('map.offline.queueLastSync', {
                      synced: queueLastSync.synced,
                      failed: queueLastSync.failed,
                      at: new Date(queueLastSync.at).toLocaleTimeString(locale),
                    })}
                  </p>
                )}
                {online && pendingReports.length > 0 && (
                  <div className="map-offline-download-actions">
                    <button
                      type="button"
                      className="small"
                      onClick={onSyncQueueNow}
                      disabled={queueSyncing}
                    >
                      {queueSyncing ? t('offline.syncing') : t('offline.sync')}
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      onClick={onClearFailedQueue}
                      disabled={queueCleaning}
                    >
                      {queueCleaning
                        ? t('map.offline.queueClearing')
                        : t('map.offline.queueClearFailed')}
                    </button>
                  </div>
                )}
                {pendingReports.length > 0 && (
                  <ul className="map-offline-queue-list">
                    {pendingReports.slice(0, 5).map((r) => (
                      <li key={r.id}>
                        <div className="map-offline-queue-row">
                          <span className={`queue-state ${r.status}`}>{queueStatusLabel(r.status)}</span>
                          <time dateTime={r.createdAt}>
                            {new Date(r.createdAt).toLocaleString(locale)}
                          </time>
                        </div>
                        {r.lastError && <p className="map-offline-queue-error">{r.lastError}</p>}
                        <div className="map-offline-queue-actions">
                          {online && r.status === 'failed' && (
                            <button
                              type="button"
                              className="map-offline-queue-retry"
                              onClick={() => onRetryQueuedItem(r.id)}
                            >
                              {t('map.offline.queueRetry')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="map-offline-queue-remove"
                            onClick={() => onRemoveQueuedItem(r.id)}
                          >
                            {t('map.offline.queueRemove')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {activeTopPanel === 'offline' && (
            <div className="map-offline-download-panel">
              <p className="map-offline-download-title">
                {t('map.offline.downloadTitle', {
                  km: DEFAULT_RADIUS_KM,
                  side: DEFAULT_BOX_SIDE_KM,
                })}
              </p>
              {!online && (
                <p className="map-offline-download-meta">
                  {t('map.offline.reportMode')}
                </p>
              )}
              {tileCenter && (
                <p className="map-offline-download-meta">
                  {t('map.offline.downloadCenter', {
                    lat: fmtCoord(tileCenter.lat),
                    lng: fmtCoord(tileCenter.lng),
                  })}
                </p>
              )}
              <p className="map-offline-download-meta map-offline-legend-hint">
                {t('map.offline.previewBoxHint')}
              </p>
              <p className="map-offline-download-meta map-offline-legend-hint">
                {t('map.offline.zoomRangeHint')}
              </p>
              <p className="map-offline-download-meta">
                {offlineTiles.coverage
                  ? t('map.offline.downloadCoverage', {
                      pct: Math.round(offlineTiles.coverage.ratio * 100),
                      cached: offlineTiles.coverage.cached,
                      total: offlineTiles.coverage.total,
                    })
                  : t('map.offline.downloadCoverageUnknown')}
              </p>
              {online && crisisIdsForFootprints.length > 0 && (
                <label className="map-offline-footprint-opt">
                  <input
                    type="checkbox"
                    checked={offlineIncludeFootprints}
                    onChange={(e) => onToggleOfflineFootprints(e.target.checked)}
                    disabled={offlineTiles.downloading}
                  />
                  <span>{t('map.offline.includeFootprints')}</span>
                </label>
              )}
              {online && crisisIdsForFootprints.length === 0 && (
                <p className="map-offline-download-meta map-offline-legend-hint">
                  {t('map.offline.footprintsNeedCrisis')}
                </p>
              )}
              {online && offlineIncludeFootprints && (
                <p className="map-offline-download-meta map-offline-legend-hint">
                  {t('map.offline.includeFootprintsHint')}
                </p>
              )}
              {offlineTiles.footprintNote && (
                <p
                  className={
                    offlineTiles.footprintNote.skipped
                      ? 'map-offline-download-meta error'
                      : 'map-offline-download-meta ops-form-ok'
                  }
                >
                  {offlineTiles.footprintNote.skipped
                    ? t(`map.offline.footprintsSkipped.${offlineTiles.footprintNote.reason ?? 'fetch_failed'}`, {
                        count: offlineTiles.footprintNote.featureCount,
                        max: MAX_OFFLINE_FOOTPRINT_FEATURES,
                      })
                    : t('map.offline.footprintsSaved', {
                        count: offlineTiles.footprintNote.featureCount,
                      })}
                </p>
              )}
              {online && (
                <div className="map-offline-download-actions">
                  <button
                    type="button"
                    className="small primary"
                    onClick={onDownloadOfflineArea}
                    disabled={offlineTiles.downloading || offlineTiles.checking}
                  >
                    {offlineTiles.downloading
                      ? t('map.offline.downloading')
                      : t('map.offline.downloadAction')}
                  </button>
                  {offlineTiles.downloading && (
                    <button type="button" className="small" onClick={offlineTiles.cancel}>
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              )}
              {offlineTiles.downloading && offlineTiles.progress && (
                <p className="map-offline-download-meta">
                  {t('map.offline.downloadProgress', {
                    done: offlineTiles.progress.done,
                    total: offlineTiles.progress.total,
                    failed: offlineTiles.progress.failed,
                  })}
                </p>
              )}
              <p className="map-offline-download-meta">
                {t('map.offline.storageSummary', { count: offlineTiles.cachedTileCount })}
              </p>
              {offlineTiles.regions.length > 0 && (
                <>
                  <p className="map-offline-download-meta">
                    {t('map.offline.savedRegions', { count: offlineTiles.regions.length })}
                  </p>
                  <ul className="map-offline-region-list">
                    {offlineTiles.regions.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className={
                            r.id === activeRegionId
                              ? 'map-offline-region-btn active'
                              : 'map-offline-region-btn'
                          }
                          onClick={() => goToRegion(r)}
                        >
                          {t('map.offline.goToRegion', {
                            lat: fmtCoord(r.center.lat),
                            lng: fmtCoord(r.center.lng),
                            side: Number((r.radiusKm * 2).toFixed(1)),
                          })}
                          {r.footprintsIncluded
                            ? ` · ${t('map.offline.regionFootprints', { count: r.footprintCount ?? 0 })}`
                            : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {activeTopPanel === 'legend' && (
            <MapLegend
              buildingCount={buildings.features.length}
              buildingsLoading={buildingsLoading}
              buildingsError={buildingsError}
              markerCount={markers.length}
              mode={mapMode}
              embedded
              reportWindowMonths={reportWindowMonths}
              onFlyToDemoFootprints={
                mapScope !== 'unspecified' && !buildingsLoading ? flyToDemoFootprints : undefined
              }
            />
          )}
        </section>
      )}

      <div className="map-overlay-top">
        <div className="map-title-wrap">
          <span
            className={connectionLampClass}
            aria-label={online ? t('status.online') : t('status.offline')}
          >
            <span className="map-connection-lamp-dot" />
            <span className="map-connection-lamp-text">
              {online ? t('status.online') : t('status.offline')}
            </span>
          </span>
        </div>
        <div className="map-overlay-right">
          <label className="lang-switcher map-crisis-switcher">
            <span className="muted">{t('map.scope.select')}</span>
            <select
              id="map-crisis-select"
              value={mapScope}
              onChange={(e) => onSelectScope(e.target.value)}
              aria-label={t('map.scope.select')}
            >
              <optgroup label={t('map.scope.groupMerged')}>
                <option value="all">{t('map.scope.all')}</option>
                <option value="unspecified">{t('map.scope.unspecified')}</option>
              </optgroup>
              {activeCrises.length > 0 && (
                <optgroup label={t('map.scope.groupActive')}>
                  {activeCrises.map((c) => (
                    <option key={c.id} value={c.id}>
                      {crisisLabel(c)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <LanguageSwitcher />
          <div className="map-overlay-controls">
            <button
              type="button"
              className={activeTopPanel === 'contribution' ? 'map-overlay-tab active' : 'map-overlay-tab'}
              onClick={() => toggleTopPanel('contribution')}
              disabled={publicCrises.length === 0}
            >
              {t('contribution.summaryCollapsed')}
            </button>
            <button
              type="button"
              className={activeTopPanel === 'offline' ? 'map-overlay-tab active' : 'map-overlay-tab'}
              onClick={() => toggleTopPanel('offline')}
            >
              {t('map.overlay.offlinePanel')}
            </button>
            <button
              type="button"
              className={activeTopPanel === 'legend' ? 'map-overlay-tab active' : 'map-overlay-tab'}
              onClick={() => toggleTopPanel('legend')}
            >
              {t('map.legend.title')}
            </button>
          </div>
          <nav className="map-dev-links">
            <a href="/dev">{t('nav.home')}</a>
            {getOpsToken() && <a href="/dashboard">{t('ops.nav.dashboard')}</a>}
            {!getOpsToken() && <a href="/ops/login">{t('ops.nav.login')}</a>}
          </nav>
        </div>
      </div>

      {duplicateBanner && (
        <div className="map-duplicate-banner" role="status">
          <p>{t('contribution.duplicateWarn')}</p>
          <button type="button" className="icon-btn" onClick={() => setDuplicateBanner(false)} aria-label={t('common.cancel')}>
            ×
          </button>
        </div>
      )}

      <div className="map-mode-stack">
        {showNewFlowCancel && (
          <>
            <p className="map-new-flow-text">{t('map.hint.newPlaceFirst')}</p>
            <button type="button" className="map-new-cancel-btn" onClick={cancelNewReport}>
              {t('map.newFlow.cancel')}
            </button>
          </>
        )}
        <MapModeToggle mode={mapMode} onChange={onModeChange} />
      </div>

      {mapMode === 'new' && geo.denied && !geo.pending && !hasPlacement && (
        <p className="map-hint map-hint-warn">{t('map.hint.gpsDenied')}</p>
      )}

      {buildingsError && activeTopPanel !== 'legend' && (
        <p className="map-hint map-hint-warn">{t('map.err.buildingsLoad', { msg: buildingsError })}</p>
      )}

      {online && mapMode === 'all' && markers.length === 0 && bbox && !buildingsError && (
        <p className="map-hint map-hint-empty">{t('map.hint.noMarkers')}</p>
      )}

      {online && mapMode === 'mine' && markers.length === 0 && bbox && (
        <p className="map-hint map-hint-empty">{t('map.hint.noMineInView')}</p>
      )}

      {showPlacementBar && (
        <PlacementBar
          buildingName={placement.buildingName}
          buildingId={placement.buildingId}
          pin={placement.pin}
          onOpenForm={onOpenForm}
          onClear={clearPlacement}
          onCancel={cancelNewReport}
        />
      )}

      <div className="map-fab-col">
        <button
          type="button"
          className="map-fab-report"
          title={t('map.startNewReport')}
          onClick={onStartNewReport}
        >
          +
        </button>
        {publicZones.length > 0 && (
          <button
            type="button"
            className="map-fab-zones"
            title={t('map.crisis.showZones')}
            aria-label={t('map.crisis.showZones')}
            onClick={() => setZoneFitTick((n) => n + 1)}
          >
            ⊞
          </button>
        )}
        <button
          type="button"
          className="map-fab-locate"
          title={t('map.locateMe')}
          onClick={onLocateMe}
        >
          ◎
        </button>
      </div>

      <LocationPrompt
        open={locationPromptOpen}
        onAllow={() => dismissLocationPrompt(true)}
        onSkip={() => dismissLocationPrompt(false)}
      />

      {inspectOpen && (mapMode === 'all' || mapMode === 'mine') && (
        <div className="location-panel-backdrop" onClick={() => setInspectOpen(false)} role="presentation">
          <div onClick={(e) => e.stopPropagation()}>
            <LocationPanel
              open
              context={inspectContext}
              focusedMarker={focusedMarker}
              buildingId={placement.buildingId}
              buildingName={placement.buildingName}
              pin={placement.pin}
              nearbyMarkers={inspectMarkers}
              onClose={() => setInspectOpen(false)}
              onAddReportHere={onAddReportHere}
              onEditReport={onEditReport}
            />
          </div>
        </div>
      )}

      <ReportSheet
        key={reportSheetKey}
        open={sheetOpen}
        crisisId={reportCrisisId}
        mode={sheetMode}
        reportId={editReportId}
        buildingId={placement.buildingId}
        buildingName={placement.buildingName}
        reportGeom={reportGeom}
        onClose={() => setSheetOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
