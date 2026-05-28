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
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';

import 'leaflet/dist/leaflet.css';

import { useI18n } from '../../i18n/I18nContext';
import { centroidOfFeature } from '../../utils/buildingAtPoint';
import { resolveGroupDisplay } from '../../utils/mapMarkers';
import { CachedOsmTileLayer, type OfflineZoomLimits } from './CachedOsmTileLayer';
import { ClusteredReportMarkers } from './ClusteredReportMarkers';
import { DownloadPreviewLayer } from './DownloadPreviewLayer';
import { OfflineRegionLayers } from './OfflineRegionLayers';
import type { MapRegionMeta } from '../../offline/tileCache';

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
  flyTo?: MapFlyTarget | null;
  initialCenter: [number, number];
  initialZoom: number;
  crisisBounds?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  fitBoundsTick?: number;
  mapMode?: 'all' | 'mine' | 'new';
  reportPin?: { lat: number; lng: number } | null;
  onMapPlace?: (lat: number, lng: number) => void;
  onReportPinMove?: (lat: number, lng: number) => void;
  offlineZoomLimits?: OfflineZoomLimits | null;
  savedRegions?: MapRegionMeta[];
  activeSavedRegionId?: string | null;
  onSavedRegionSelect?: (regionId: string) => void;
  regionFitBounds?: L.LatLngBounds | null;
  regionFitTick?: number;
  /** 連線時、下載前：橘色虛線方框預覽將下載的範圍 */
  downloadPreview?: {
    center: { lat: number; lng: number };
    sideKm: number;
    variant?: 'target' | 'preview';
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

function FlyTo({ target }: { target: MapFlyTarget | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const z = target.zoom ?? Math.max(map.getZoom(), 16);
    map.flyTo([target.lat, target.lng], z, { duration: 0.6 });
  }, [target?.lat, target?.lng, target?.zoom, target, map]);
  return null;
}

function BboxWatcher({ onBboxChange }: { onBboxChange: (bbox: string) => void }) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = () => {
    const b = map.getBounds();
    const s = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
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
}: {
  bounds: L.LatLngBounds | null | undefined;
  tick: number;
  maxZoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!bounds || tick < 1 || !bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom });
  }, [bounds, tick, maxZoom, map]);
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
      <p>
        <span className="muted">{t('map.popup.worstDamage')}: </span>
        <strong>{label}</strong>
      </p>
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
  selectedBuildingId,
  userPosition,
  showOthers,
  onBuildingSelect,
  onBuildingViewDetails,
  onMarkerViewDetails,
  markerPopupLabels,
  onBboxChange,
  flyTo,
  initialCenter,
  initialZoom,
  crisisBounds,
  fitBoundsTick = 0,
  mapMode = 'all',
  reportPin = null,
  onMapPlace,
  onReportPinMove,
  offlineZoomLimits,
  savedRegions = [],
  activeSavedRegionId = null,
  onSavedRegionSelect,
  regionFitBounds,
  regionFitTick = 0,
  downloadPreview = null,
}: Props) {
  const [buildingPopup, setBuildingPopup] = useState<{
    buildingId: string;
    buildingName: string | null;
    lat: number;
    lng: number;
  } | null>(null);

  const buildingStyle = useMemo(
    () => ({
      color: '#1155cc',
      weight: 2,
      fillColor: '#3388ff',
      fillOpacity: 0.28,
    }),
    [],
  );

  const onEachBuilding = (feature: GeoJSON.Feature, layer: L.Layer) => {
    layer.on({
      click: (e) => {
        const id = (feature.properties?.building_id as string) ?? null;
        if (!id) return;
        if (mapMode === 'new') {
          onBuildingSelect(id);
          return;
        }
        L.DomEvent.stopPropagation(e);
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

  const buildingKey = useMemo(
    () => `${buildings.features.length}-${selectedBuildingId ?? ''}`,
    [buildings.features.length, selectedBuildingId],
  );

  return (
    <MapContainer
      className="contributor-map"
      center={initialCenter}
      zoom={initialZoom}
      scrollWheelZoom
      zoomControl={false}
    >
      <ZoomControl position="bottomright" />
      <CachedOsmTileLayer offlineZoomLimits={offlineZoomLimits} />
      {downloadPreview && (
        <DownloadPreviewLayer
          center={downloadPreview.center}
          sideKm={downloadPreview.sideKm}
          variant={downloadPreview.variant}
        />
      )}
      {savedRegions.length > 0 && (
        <OfflineRegionLayers
          regions={savedRegions}
          activeRegionId={activeSavedRegionId}
          onSelect={onSavedRegionSelect}
        />
      )}
      <BboxWatcher onBboxChange={onBboxChange} />
      <FlyTo target={flyTo} />
      <MapPlaceClick enabled={mapMode === 'new'} onPlace={onMapPlace} />
      {crisisBounds && fitBoundsTick > 0 && (
        <FitBoundsOnce bounds={crisisBounds} tick={fitBoundsTick} />
      )}
      {regionFitBounds && regionFitTick > 0 && (
        <FitLatLngBoundsOnce bounds={regionFitBounds} tick={regionFitTick} maxZoom={16} />
      )}

      {buildings.features.length > 0 && (
        <GeoJSON
          key={buildingKey}
          data={buildings}
          style={(feature) => {
            const id = feature?.properties?.building_id as string | undefined;
            const selected = id && id === selectedBuildingId;
            return {
              ...buildingStyle,
              fillColor: selected ? '#ff5533' : '#3388ff',
              fillOpacity: selected ? 0.45 : 0.28,
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
        <Marker
          position={[reportPin.lat, reportPin.lng]}
          icon={reportPinIcon}
          draggable
          zIndexOffset={1000}
          eventHandlers={{
            dragend: (e) => {
              const ll = e.target.getLatLng();
              onReportPinMove?.(ll.lat, ll.lng);
            },
          }}
        />
      )}

      {buildingPopup && (mapMode === 'all' || mapMode === 'mine') && (
        <Popup
          position={[buildingPopup.lat, buildingPopup.lng]}
          eventHandlers={{ remove: () => setBuildingPopup(null) }}
        >
          <BuildingPopupContent
            buildingId={buildingPopup.buildingId}
            buildingName={buildingPopup.buildingName}
            markers={markers}
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
