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
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useI18n } from '../i18n/I18nContext';
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

export function MapPage() {
  const { t, locale } = useI18n();
  const {
    window: activeWindow,
    error: windowError,
    loading: windowLoading,
    reload: reloadWindow,
    fromCache: crisisFromCache,
    needsFirstOnline,
  } = useActiveWindow();
  const online = useOnlineStatus();
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
  const [locatePending, setLocatePending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** 每次開啟「新增」表單遞增，強制 ReportSheet 重掛載以免殘留編輯資料 */
  const [formSession, setFormSession] = useState(0);
  const [duplicateBanner, setDuplicateBanner] = useState(false);
  /** 首次取得 GPS 後自動飛一次（同意定位或 ◎），避免一直停在台北示範預設中心 */
  const autoFlewToUserRef = useRef(false);

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

  const offlineReportMode = !online || crisisFromCache;

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
      />

      {offlineReportMode && (
        <p className="map-offline-report-banner" role="status">
          {t('map.offline.reportMode')}
        </p>
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
