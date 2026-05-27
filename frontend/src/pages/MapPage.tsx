import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiGet } from '../api';
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
import { NewReportBanner } from '../components/map/NewReportBanner';
import { PlacementBar } from '../components/map/PlacementBar';
import { ReportSheet } from '../components/map/ReportSheet';
import { OfflineBanner } from '../components/OfflineBanner';
import { useActiveWindow } from '../hooks/useActiveWindow';
import { useGeolocation } from '../hooks/useGeolocation';
import { useOfflineMapTiles } from '../hooks/useOfflineMapTiles';
import { useStableOnlineRestore } from '../hooks/useStableOnlineRestore';
import type { MapRegionMeta } from '../offline/tileCache';
import { useI18n } from '../i18n/I18nContext';
import {
  DEFAULT_RADIUS_KM,
  PREFETCH_ZOOM_MAX,
  PREFETCH_ZOOM_MIN,
  bboxForDisk,
} from '../offline/tileMath';
import {
  buildingFeatureById,
  centroidOfFeature,
  findBuildingAtPoint,
  markersNearPoint,
} from '../utils/buildingAtPoint';
import { filterMarkersInBbox } from '../utils/mapBbox';

const DEFAULT_CENTER: [number, number] = [25.0305, 121.5608];
const DEFAULT_ZOOM = 14;

type Placement = {
  buildingId: string | null;
  buildingName: string | null;
  pin: { lat: number; lng: number } | null;
};

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
  const {
    window: activeWindow,
    error: windowError,
    loading: windowLoading,
    reload: reloadWindow,
    fromCache: _crisisFromCache,
    needsFirstOnline,
  } = useActiveWindow();
  const { online, showRestoredBanner, dismissRestoredBanner } = useStableOnlineRestore();
  const geo = useGeolocation();
  const bboxRef = useRef<string | null>(null);

  const [mapMode, setMapMode] = useState<MapMode>('all');
  const [bbox, setBbox] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
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
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [fitBoundsTick, setFitBoundsTick] = useState(0);
  const [regionFitTick, setRegionFitTick] = useState(0);
  const [locatePending, setLocatePending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** 每次開啟「新增」表單遞增，強制 ReportSheet 重掛載以免殘留編輯資料 */
  const [formSession, setFormSession] = useState(0);
  const [duplicateBanner, setDuplicateBanner] = useState(false);
  /** 首次取得 GPS 後自動飛一次（同意定位或 ◎），避免一直停在台北示範預設中心 */
  const autoFlewToUserRef = useRef(false);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);

  bboxRef.current = bbox;

  const crisisId = activeWindow?.crisis_id ?? '';

  const crisisBounds = activeWindow?.bounds as
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon
    | null
    | undefined;

  const hasReferenceBounds = Boolean(crisisBounds);

  const mapCenter = useMemo((): [number, number] => {
    if (geo.position) return [geo.position.lat, geo.position.lng];
    return DEFAULT_CENTER;
  }, [geo.position]);
  const tileCenter = useMemo(() => {
    if (geo.position) return { lat: geo.position.lat, lng: geo.position.lng };
    return centerFromBbox(bbox);
  }, [geo.position, bbox]);
  const offlineTiles = useOfflineMapTiles(tileCenter);

  const activeRegion = useMemo(
    () => offlineTiles.regions.find((r) => r.id === activeRegionId) ?? null,
    [offlineTiles.regions, activeRegionId],
  );

  const regionToBounds = useCallback((r: MapRegionMeta) => {
    const box = bboxForDisk(r.center, r.radiusKm);
    return L.latLngBounds(
      L.latLng(box.south, box.west),
      L.latLng(box.north, box.east),
    );
  }, []);

  /** 僅在真正離線且已選區域時限制 z14–17；連線時不鎖縮放 */
  const offlineZoomLimits = useMemo(() => {
    if (online || !activeRegionId) return null;
    return { minZoom: PREFETCH_ZOOM_MIN, maxZoom: PREFETCH_ZOOM_MAX };
  }, [online, activeRegionId]);

  const downloadPreview = useMemo(() => {
    if (!online || !tileCenter) return null;
    return { center: tileCenter, radiusKm: DEFAULT_RADIUS_KM };
  }, [online, tileCenter]);

  const switchToOnlineMode = useCallback(() => {
    setActiveRegionId(null);
    setRegionFitTick(0);
    dismissRestoredBanner();
    reloadWindow();
    setRefreshKey((k) => k + 1);
  }, [dismissRestoredBanner, reloadWindow]);

  const goToRegion = useCallback(
    (r: MapRegionMeta) => {
      setActiveRegionId(r.id);
      setFlyTarget({ lat: r.center.lat, lng: r.center.lng });
      if (!online) setRegionFitTick((n) => n + 1);
    },
    [online],
  );

  useEffect(() => {
    if (online) setActiveRegionId(null);
  }, [online]);

  useEffect(() => {
    if (online || offlineTiles.regions.length === 0 || activeRegionId) return;
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
    goToRegion(pick);
  }, [online, offlineTiles.regions, activeRegionId, tileCenter, mapCenter, goToRegion]);

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

  useEffect(() => {
    if (!online || !crisisId || !bbox) return;
    const timer = setTimeout(() => {
      const q = encodeURIComponent(bbox);
      setBuildingsError(null);
      apiGet<GeoJSON.FeatureCollection>(`/v1/crises/${crisisId}/buildings?bbox=${q}`)
        .then((fc) => {
          if (bboxRef.current !== bbox) return;
          setBuildings(fc);
        })
        .catch((e: Error) => {
          if (bboxRef.current !== bbox) return;
          setBuildingsError(e.message);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [online, crisisId, bbox, refreshKey]);

  useEffect(() => {
    if (!online || !bbox || mapMode === 'new') {
      if (mapMode === 'new') setMarkers([]);
      return;
    }
    const requestedBbox = bbox;
    const timer = setTimeout(() => {
      apiGet<{ items: MapMarker[] }>(
        `/v1/public/markers?bbox=${encodeURIComponent(requestedBbox)}&mode=${mapMode}`,
      )
        .then((r) => {
          if (bboxRef.current !== requestedBbox) return;
          setMarkers(filterMarkersInBbox(r.items, requestedBbox));
        })
        .catch(() => {
          if (bboxRef.current !== requestedBbox) return;
          setMarkers([]);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [online, bbox, mapMode, refreshKey]);

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
    geo.request();
  }, [geo]);

  const onDownloadOfflineArea = useCallback(() => {
    if (!tileCenter) {
      geo.request();
      return;
    }
    void offlineTiles.download(tileCenter);
  }, [tileCenter, geo, offlineTiles]);

  useEffect(() => {
    if (!locatePending || !geo.position) return;
    setFlyTarget({ lat: geo.position.lat, lng: geo.position.lng });
    setPinWithDetect(geo.position.lat, geo.position.lng, buildings);
    setLocatePending(false);
  }, [locatePending, geo.position, buildings, setPinWithDetect]);

  useEffect(() => {
    if (!geo.position || autoFlewToUserRef.current) return;
    autoFlewToUserRef.current = true;
    setFlyTarget({ lat: geo.position.lat, lng: geo.position.lng });
  }, [geo.position]);

  const reportGeom = useMemo((): GeoJSON.Point | null => {
    if (!placement.pin) return null;
    return {
      type: 'Point',
      coordinates: [placement.pin.lng, placement.pin.lat],
    };
  }, [placement.pin]);

  const onReportPinMove = useCallback(
    (lat: number, lng: number) => {
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

  const windowTitle = useMemo(() => {
    if (!activeWindow?.name) return t('app.title');
    const n = activeWindow.name;
    return (
      (n[locale] as string) ||
      (n.en as string) ||
      (n['zh-Hant'] as string) ||
      (n['zh-Hans'] as string) ||
      (n.zh as string) ||
      activeWindow.slug
    );
  }, [activeWindow, locale, t]);

  if (windowLoading) {
    return <p className="map-status">{t('common.loading')}</p>;
  }
  if (needsFirstOnline) {
    return (
      <section className="map-status card">
        <p className="error">{t('map.offline.needFirstVisit')}</p>
        <p className="muted">{t('map.offline.needFirstVisitHint')}</p>
        <button type="button" onClick={reloadWindow}>
          {t('map.retry')}
        </button>
      </section>
    );
  }

  if (windowError || !activeWindow) {
    return (
      <section className="map-status card">
        <p className="error">{windowError ?? t('map.err.noWindow')}</p>
        <p className="muted">{t('map.err.backendSteps')}</p>
        <pre className="map-cmd-hint">cd backend; uvicorn app.main:app --reload --port 8000</pre>
        <button type="button" onClick={reloadWindow}>
          {t('map.retry')}
        </button>
      </section>
    );
  }

  const offlineReportMode = !online;
  const unspecifiedPhase = activeWindow.reporting_phase !== 'defined';

  return (
    <div className="map-page">
      <OfflineBanner />
      <ContributorMap
        buildings={buildings}
        markers={markers}
        selectedBuildingId={placement.buildingId}
        userPosition={geo.position}
        showOthers={showOthers}
        onBuildingSelect={onBuildingSelect}
        onBuildingViewDetails={onBuildingViewDetails}
        onMarkerViewDetails={onMarkerViewDetails}
        markerPopupLabels={markerPopupLabels}
        onBboxChange={setBbox}
        flyTo={flyTarget}
        initialCenter={mapCenter}
        initialZoom={DEFAULT_ZOOM}
        crisisBounds={crisisBounds}
        fitBoundsTick={fitBoundsTick}
        mapMode={mapMode}
        reportPin={mapMode === 'new' ? placement.pin : null}
        onMapPlace={onMapPlace}
        onReportPinMove={onReportPinMove}
        offlineZoomLimits={offlineZoomLimits}
        savedRegions={offlineTiles.regions}
        activeSavedRegionId={activeRegionId}
        onSavedRegionSelect={(id) => {
          const r = offlineTiles.regions.find((x) => x.id === id);
          if (r) goToRegion(r);
        }}
        regionFitBounds={!online && activeRegion ? regionToBounds(activeRegion) : null}
        regionFitTick={regionFitTick}
        downloadPreview={downloadPreview}
      />

      {unspecifiedPhase && (
        <p className="map-unspecified-banner" role="status">
          {t('map.unspecified.hint')}
        </p>
      )}

      {showRestoredBanner && (
        <div className="map-online-restored-banner" role="status">
          <p>{t('map.offline.onlineRestored')}</p>
          <button type="button" className="small primary" onClick={switchToOnlineMode}>
            {t('map.offline.switchToOnline')}
          </button>
          <button type="button" className="small" onClick={dismissRestoredBanner}>
            {t('map.offline.onlineRestoredDismiss')}
          </button>
        </div>
      )}

      {offlineReportMode && (
        <p className="map-offline-report-banner" role="status">
          {t('map.offline.reportMode')}
          {!online && offlineTiles.regions.length === 0 && (
            <>
              <br />
              <span className="map-offline-report-banner-sub">
                {t('map.offline.downloadHint')}
              </span>
            </>
          )}
          {!online && offlineTiles.regions.length > 0 && (
            <>
              <br />
              <span className="map-offline-report-banner-sub">
                {t('map.offline.useSavedHint')}
              </span>
            </>
          )}
        </p>
      )}

      {!online && offlineTiles.regions.length > 0 && (
        <div className="map-offline-download-panel map-offline-use-panel">
          <p className="map-offline-download-title">{t('map.offline.useSavedTitle')}</p>
          <p className="map-offline-download-meta">{t('map.offline.useSavedBody')}</p>
          <p className="map-offline-download-meta">{t('map.offline.zoomRangeHint')}</p>
          <p className="map-offline-download-meta map-offline-legend-hint">
            {t('map.offline.regionBoxHint')}
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
                    km: r.radiusKm,
                  })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {online && (
        <div className="map-offline-download-panel">
          <p className="map-offline-download-title">
            {t('map.offline.downloadTitle', { km: DEFAULT_RADIUS_KM })}
          </p>
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
          <p className="map-offline-download-meta">
            {offlineTiles.coverage
              ? t('map.offline.downloadCoverage', {
                  pct: Math.round(offlineTiles.coverage.ratio * 100),
                  cached: offlineTiles.coverage.cached,
                  total: offlineTiles.coverage.total,
                })
              : t('map.offline.downloadCoverageUnknown')}
          </p>
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
            <details className="map-offline-download-regions" open>
              <summary>{t('map.offline.savedRegions', { count: offlineTiles.regions.length })}</summary>
              <p className="map-offline-download-meta map-offline-legend-hint">
                {t('map.offline.regionBoxHint')}
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
                        km: r.radiusKm,
                      })}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="map-overlay-top">
        <span className="map-window-title">{windowTitle}</span>
        <div className="map-overlay-right">
          <LanguageSwitcher />
          <ContributionStrip
            crisisId={crisisId}
            visible={online && mapMode !== 'new' && Boolean(crisisId)}
            refreshKey={refreshKey}
          />
          <nav className="map-dev-links">
            <a href="/dev">{t('nav.home')}</a>
            <a href="/dashboard">{t('nav.dashboard')}</a>
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

      <MapLegend
        buildingCount={buildings.features.length}
        markerCount={markers.length}
        mode={mapMode}
      />

      <MapModeToggle mode={mapMode} onChange={onModeChange} />

      {mapMode === 'new' && <NewReportBanner onCancel={cancelNewReport} />}

      {mapMode === 'new' && !hasPlacement && !sheetOpen && (
        <p className="map-hint map-hint-new-flow">{t('map.hint.newPlaceFirst')}</p>
      )}

      {buildingsError && (
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

      {hasReferenceBounds && (
        <button
          type="button"
          className="map-fab-area"
          title={t('map.showReferenceArea')}
          onClick={() => setFitBoundsTick((n) => n + 1)}
        >
          ⊞
        </button>
      )}

      <button
        type="button"
        className="map-fab-report"
        title={t('map.startNewReport')}
        onClick={onStartNewReport}
      >
        +
      </button>

      <button
        type="button"
        className="map-fab-locate"
        title={t('map.locateMe')}
        onClick={onLocateMe}
      >
        ◎
      </button>

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
        crisisId={crisisId}
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
