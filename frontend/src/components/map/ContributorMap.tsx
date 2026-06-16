import L from 'leaflet';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';

import 'leaflet/dist/leaflet.css';

import { useI18n } from '../../i18n/I18nContext';
import { centroidOfFeature } from '../../utils/buildingAtPoint';
import { normalizeBboxString } from '../../utils/mapBbox';
import { buildingDisplayById, buildingFootprintStyle, resolveGroupDisplay } from '../../utils/mapMarkers';
import {
  MapZoomLimits,
  OfflineOsmTileLayer,
  OsmTileLayer,
  type OfflineZoomLimits,
} from './CachedOsmTileLayer';
import { CrisisZonesLayer } from './CrisisZonesLayer';
import { ClusteredReportMarkers } from './ClusteredReportMarkers';
import { MapRailZoom } from './MapRailZoom';
import { DownloadPreviewLayer } from './DownloadPreviewLayer';
import { MapLayerPanes } from './MapLayerPanes';
import { OfflineRegionLayers } from './OfflineRegionLayers';
import type { MapRegionMeta } from '../../offline/tileCache';
import { PREFETCH_ZOOM_MAX, PREFETCH_ZOOM_MIN } from '../../offline/tileMath';

export type MapMarker = {
  id: string;
  damage_level: string;
  site_status?: string;
  captured_at_client: string;
  building_id: string | null;
  geom: GeoJSON.Point;
  is_mine: boolean;
  thumb_url: string | null;
};

type Props = {
  buildings: GeoJSON.FeatureCollection;
  markers: MapMarker[];
  /** All reports in view — used for building footprint colors and building popups. */
  buildingMarkers?: MapMarker[];
  selectedBuildingId: string | null;
  userPosition: { lat: number; lng: number } | null;
  showOthers: boolean;
  onBuildingSelect: (buildingId: string | null) => void;
  onBuildingViewDetails: (buildingId: string) => void;
  onMarkerViewDetails: (marker: MapMarker) => void;
  markerPopupLabels: {
    damageLabel: (level: string) => string;
    mineLabel: string;
    reportCount: (count: number) => string;
    viewDetails: string;
    siteRepaired: string;
    siteDemolished: string;
  };
  onBboxChange: (bbox: string) => void;
  onViewChange?: (view: { lat: number; lng: number; zoom: number }) => void;
  flyTo?: MapFlyTarget | null;
  onFlyComplete?: () => void;
  initialCenter: [number, number];
  initialZoom: number;
  crisisBounds?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  crisisZones?: Array<{ id: string; name: string; geom: GeoJSON.Polygon }>;
  fitBoundsTick?: number;
  zoneFitBounds?: L.LatLngBounds | null;
  zoneFitTick?: number;
  mapMode?: 'all' | 'mine' | 'new';
  reportPin?: { lat: number; lng: number } | null;
  onMapPlace?: (lat: number, lng: number) => void;
  onReportPinMove?: (lat: number, lng: number) => void;
  onPopupStateChange?: (open: boolean) => void;
  online?: boolean;
  offlineZoomLimits?: OfflineZoomLimits | null;
  savedRegions?: MapRegionMeta[];
  activeSavedRegionId?: string | null;
  onSavedRegionSelect?: (regionId: string) => void;
  regionFitBounds?: L.LatLngBounds | null;
  regionFitTick?: number;
  /** 連線時、下載前：橘色虛線方框預覽將下載的範圍 */
  downloadPreview?: {
    center?: { lat: number; lng: number };
    sideKm: number;
    variant?: 'target' | 'preview';
    anchorToMapCenter?: boolean;
  } | null;
};

const reportPinIcon = new L.Icon({
  iconUrl: iconUrl,
  iconRetinaUrl: iconRetina,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export type MapFlyTarget = { lat: number; lng: number; zoom?: number };

function FlyTo({
  target,
  onComplete,
}: {
  target: MapFlyTarget | null | undefined;
  onComplete?: () => void;
}) {
  const map = useMap();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!target) return;
    const z = target.zoom ?? map.getZoom();
    const dest = L.latLng(target.lat, target.lng);
    const current = map.getCenter();
    const samePlace =
      Math.abs(current.lat - dest.lat) < 1e-6 &&
      Math.abs(current.lng - dest.lng) < 1e-6 &&
      map.getZoom() === z;
    if (samePlace) {
      onCompleteRef.current?.();
      return;
    }

    const finish = () => {
      map.off('moveend', finish);
      onCompleteRef.current?.();
    };
    map.once('moveend', finish);
    map.flyTo(dest, z, { duration: 0.6 });
    return () => {
      map.off('moveend', finish);
    };
  }, [target?.lat, target?.lng, target?.zoom, target, map]);
  return null;
}

function BboxWatcher({ onBboxChange }: { onBboxChange: (bbox: string) => void }) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef<string | null>(null);

  const emit = () => {
    const b = map.getBounds();
    const s = normalizeBboxString(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
    if (lastEmittedRef.current === s) return;
    lastEmittedRef.current = s;
    onBboxChange(s);
  };

  useMapEvents({
    moveend: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(emit, 300);
    },
    zoomend: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(emit, 300);
    },
  });

  useEffect(() => {
    emit();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [map]);

  return null;
}

function ViewWatcher({
  onViewChange,
}: {
  onViewChange?: (view: { lat: number; lng: number; zoom: number }) => void;
}) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = () => {
    if (!onViewChange) return;
    const c = map.getCenter();
    onViewChange({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  };

  const scheduleEmit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(emit, 200);
  };

  useMapEvents({
    moveend: scheduleEmit,
    zoomend: scheduleEmit,
  });

  useEffect(() => {
    emit();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [map]);

  return null;
}

function MapPlaceClick({
  enabled,
  onPlace,
}: {
  enabled: boolean;
  onPlace?: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (!enabled || !onPlace) return;
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function PopupStateWatcher({
  onChange,
}: {
  onChange?: (open: boolean) => void;
}) {
  useMapEvents({
    popupopen: () => onChange?.(true),
    popupclose: () => onChange?.(false),
  });
  return null;
}

/** 拖曳圖釘時關閉 Leaflet autoPan，避免手機上地圖莫名飄移。 */
function ReportPinMarker({
  pin,
  onMove,
}: {
  pin: { lat: number; lng: number };
  onMove?: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  return (
    <Marker
      position={[pin.lat, pin.lng]}
      icon={reportPinIcon}
      draggable
      zIndexOffset={1000}
      eventHandlers={{
        dragstart: () => {
          map.dragging.disable();
        },
        dragend: (e) => {
          map.dragging.enable();
          const ll = e.target.getLatLng();
          onMove?.(ll.lat, ll.lng);
        },
      }}
    />
  );
}

function FitBoundsOnce({
  bounds,
  tick,
}: {
  bounds: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined;
  tick: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!bounds || tick < 1) return;
    const layer = L.geoJSON(bounds as GeoJSON.GeoJsonObject);
    const b = layer.getBounds();
    if (b.isValid()) {
      map.fitBounds(b, { padding: [32, 32], maxZoom: 17 });
    }
  }, [bounds, tick, map]);
  return null;
}

function FitLatLngBoundsOnce({
  bounds,
  tick,
  maxZoom = 16,
  minZoom,
}: {
  bounds: L.LatLngBounds | null | undefined;
  tick: number;
  maxZoom?: number;
  minZoom?: number;
}) {
  const map = useMap();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  useEffect(() => {
    if (tick < 1) return;
    const b = boundsRef.current;
    if (!b || !b.isValid()) return;
    map.fitBounds(b, { padding: [32, 32], maxZoom });
    if (minZoom != null && map.getZoom() < minZoom) {
      map.setZoom(minZoom);
    }
  }, [tick, maxZoom, minZoom, map]);
  return null;
}

function BuildingPopupContent({
  buildingId,
  buildingName,
  markers,
  mapMode,
  onViewDetails,
}: {
  buildingId: string;
  buildingName: string | null;
  markers: MapMarker[];
  mapMode: 'all' | 'mine' | 'new';
  onViewDetails: (buildingId: string) => void;
}) {
  const { t } = useI18n();
  const map = useMap();
  const atBuilding = markers.filter((m) => m.building_id === buildingId);
  const sorted = [...atBuilding].sort(
    (a, b) =>
      new Date(b.captured_at_client).getTime() - new Date(a.captured_at_client).getTime(),
  );
  const latest = sorted[0];
  const { pinDisplay, displayDamageLevel } = resolveGroupDisplay(atBuilding);
  const label =
    pinDisplay === 'repaired'
      ? t('report.siteStatus.repaired')
      : pinDisplay === 'demolished'
        ? t('report.siteStatus.demolished')
        : t(`report.damage.${displayDamageLevel as 'minimal' | 'partial' | 'complete'}`);
  const showActions = mapMode === 'all' || mapMode === 'mine';

  return (
    <div className="marker-popup building-popup">
      <p className="building-popup-name">
        <strong>{buildingName ?? `${buildingId.slice(0, 8)}…`}</strong>
      </p>
      {atBuilding.length === 0 ? (
        <p className="muted">{t('map.popup.noReportsAtBuilding')}</p>
      ) : (
        <p>
          <span className="muted">{t('map.popup.worstDamage')}: </span>
          <strong>{label}</strong>
        </p>
      )}
      {latest && (
        <time dateTime={latest.captured_at_client}>
          {t('map.popup.latestReport')}: {new Date(latest.captured_at_client).toLocaleString()}
        </time>
      )}
      {atBuilding.length > 1 && (
        <p className="marker-popup-count muted">
          {t('map.popup.buildingReportCount', { count: atBuilding.length })}
        </p>
      )}
      {showActions && (
        <div className="marker-popup-actions">
          <button
            type="button"
            className="primary small"
            onClick={() => {
              map.closePopup();
              onViewDetails(buildingId);
            }}
          >
            {t('map.popup.viewDetails')}
          </button>
        </div>
      )}
    </div>
  );
}

export function ContributorMap({
  buildings,
  markers,
  buildingMarkers,
  selectedBuildingId,
  userPosition,
  showOthers,
  onBuildingSelect,
  onBuildingViewDetails,
  onMarkerViewDetails,
  markerPopupLabels,
  onBboxChange,
  onViewChange,
  flyTo,
  onFlyComplete,
  initialCenter,
  initialZoom,
  crisisBounds,
  crisisZones = [],
  fitBoundsTick = 0,
  zoneFitBounds = null,
  zoneFitTick = 0,
  mapMode = 'all',
  reportPin = null,
  onMapPlace,
  onReportPinMove,
  onPopupStateChange,
  online = true,
  offlineZoomLimits,
  savedRegions = [],
  activeSavedRegionId = null,
  onSavedRegionSelect,
  regionFitBounds,
  regionFitTick = 0,
  downloadPreview = null,
}: Props) {
  const markersForBuildings = buildingMarkers ?? markers;
  const buildingDamageMap = useMemo(
    () => buildingDisplayById(markersForBuildings),
    [markersForBuildings],
  );

  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const onBuildingSelectRef = useRef(onBuildingSelect);
  onBuildingSelectRef.current = onBuildingSelect;

  const [buildingPopup, setBuildingPopup] = useState<{
    buildingId: string;
    buildingName: string | null;
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    if (mapMode === 'new') setBuildingPopup(null);
  }, [mapMode]);

  const buildingStyle = useMemo(
    () => ({
      pane: 'buildings',
      color: '#1155cc',
      weight: 2,
      fillColor: '#3388ff',
      fillOpacity: 0.28,
    }),
    [],
  );

  const onEachBuilding = (feature: GeoJSON.Feature, layer: L.Layer) => {
    const id = (feature.properties?.building_id as string) ?? null;
    const path = layer as L.Path;
    path.options.pane = 'buildings';
    path.bringToFront();
    layer.off('click');
    layer.on({
      click: (e) => {
        if (!id) return;
        L.DomEvent.stopPropagation(e);
        if (mapModeRef.current === 'new') {
          onBuildingSelectRef.current(id);
          return;
        }
        const cen = centroidOfFeature(feature);
        if (!cen) return;
        setBuildingPopup({
          buildingId: id,
          buildingName: (feature.properties?.name as string) ?? null,
          lat: cen.lat,
          lng: cen.lng,
        });
      },
    });
  };

  return (
    <MapContainer
      className="contributor-map"
      center={initialCenter}
      zoom={initialZoom}
      scrollWheelZoom
      zoomControl={false}
      worldCopyJump={false}
    >
      {!online ? (
        <>
          <OfflineOsmTileLayer />
          <MapZoomLimits
            offlineZoomLimits={
              offlineZoomLimits ?? {
                minZoom: PREFETCH_ZOOM_MIN,
                maxZoom: PREFETCH_ZOOM_MAX,
              }
            }
          />
        </>
      ) : (
        <OsmTileLayer />
      )}
      <MapRailZoom />
      <MapLayerPanes />
      {downloadPreview && (
        <DownloadPreviewLayer
          center={downloadPreview.center}
          sideKm={downloadPreview.sideKm}
          variant={downloadPreview.variant}
          anchorToMapCenter={downloadPreview.anchorToMapCenter}
        />
      )}
      {savedRegions.length > 0 && (
        <OfflineRegionLayers
          regions={savedRegions}
          activeRegionId={activeSavedRegionId}
          onSelect={onSavedRegionSelect}
          interactive={mapMode !== 'new'}
          online={online}
        />
      )}
      <BboxWatcher onBboxChange={onBboxChange} />
      <ViewWatcher onViewChange={onViewChange} />
      <PopupStateWatcher onChange={onPopupStateChange} />
      <FlyTo target={flyTo} onComplete={onFlyComplete} />
      <MapPlaceClick enabled={mapMode === 'new'} onPlace={onMapPlace} />
      {crisisZones.length > 0 && <CrisisZonesLayer zones={crisisZones} />}
      {crisisBounds && fitBoundsTick > 0 && (
        <FitBoundsOnce bounds={crisisBounds} tick={fitBoundsTick} />
      )}
      {zoneFitBounds && zoneFitTick > 0 && (
        <FitLatLngBoundsOnce bounds={zoneFitBounds} tick={zoneFitTick} maxZoom={14} />
      )}
      {regionFitBounds && regionFitTick > 0 && (
        <FitLatLngBoundsOnce bounds={regionFitBounds} tick={regionFitTick} maxZoom={16} />
      )}

      {buildings.features.length > 0 && (
        <GeoJSON
          key="buildings-layer"
          data={buildings}
          style={(feature) => {
            const id = feature?.properties?.building_id as string | undefined;
            const selected = Boolean(id && id === selectedBuildingId);
            const damage = id ? buildingDamageMap.get(id) : undefined;
            const { fillColor, fillOpacity } = buildingFootprintStyle(damage, selected);
            return {
              ...buildingStyle,
              fillColor,
              fillOpacity,
            };
          }}
          onEachFeature={onEachBuilding}
        />
      )}

      {userPosition && mapMode !== 'new' && (
        <CircleMarker
          center={[userPosition.lat, userPosition.lng]}
          radius={8}
          pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2 }}
        />
      )}

      {reportPin && mapMode === 'new' && (
        <ReportPinMarker pin={reportPin} onMove={onReportPinMove} />
      )}

      {buildingPopup && (mapMode === 'all' || mapMode === 'mine') && (
        <Popup
          key={buildingPopup.buildingId}
          position={[buildingPopup.lat, buildingPopup.lng]}
          autoPan={false}
          closeOnClick={false}
          eventHandlers={{ remove: () => setBuildingPopup(null) }}
        >
          <BuildingPopupContent
            buildingId={buildingPopup.buildingId}
            buildingName={buildingPopup.buildingName}
            markers={markersForBuildings}
            mapMode={mapMode}
            onViewDetails={(id) => {
              setBuildingPopup(null);
              onBuildingViewDetails(id);
            }}
          />
        </Popup>
      )}

      {mapMode !== 'new' && markers.length > 0 && (
        <ClusteredReportMarkers
          markers={markers}
          showOthers={showOthers}
          mapMode={mapMode}
          labels={markerPopupLabels}
          onViewDetails={onMarkerViewDetails}
        />
      )}
    </MapContainer>
  );
}
