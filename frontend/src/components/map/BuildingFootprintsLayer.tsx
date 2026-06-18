import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';

import { centroidOfFeature } from '../../utils/buildingAtPoint';
import {
  buildingFootprintStyle,
  resolveGroupDisplay,
  type MapPinDisplay,
} from '../../utils/mapMarkers';
import type { MapMarker } from './ContributorMap';

const BASE_STYLE: L.PathOptions = {
  pane: 'buildings',
  color: '#1155cc',
  weight: 2,
  fillColor: '#3388ff',
  fillOpacity: 0.28,
};

type DamageDisplay = { pinDisplay: MapPinDisplay; displayDamageLevel: string };

export type BuildingPopupLabels = {
  noReports: string;
  worstDamage: string;
  latestReport: string;
  buildingReportCount: (count: number) => string;
  viewDetails: string;
  damageLabel: (level: string) => string;
  siteRepaired: string;
  siteDemolished: string;
};

type Props = {
  buildings: GeoJSON.FeatureCollection;
  buildingDamageMap: Map<string, DamageDisplay>;
  selectedBuildingId: string | null;
  mapMode: 'all' | 'mine' | 'new';
  markersForBuildings: MapMarker[];
  labels: BuildingPopupLabels;
  onBuildingSelect: (buildingId: string) => void;
  onBuildingViewDetails: (buildingId: string) => void;
};

type TaggedLayer = L.Layer & { _bihBuildingId?: string; feature?: GeoJSON.Feature };

function buildingPopupHtml(
  buildingId: string,
  buildingName: string | null,
  markers: MapMarker[],
  mapMode: 'all' | 'mine' | 'new',
  labels: BuildingPopupLabels,
): string {
  const atBuilding = markers.filter((m) => m.building_id === buildingId);
  const sorted = [...atBuilding].sort(
    (a, b) =>
      new Date(b.captured_at_client).getTime() - new Date(a.captured_at_client).getTime(),
  );
  const latest = sorted[0];
  const { pinDisplay, displayDamageLevel } = resolveGroupDisplay(atBuilding);
  const statusLabel =
    pinDisplay === 'repaired'
      ? labels.siteRepaired
      : pinDisplay === 'demolished'
        ? labels.siteDemolished
        : labels.damageLabel(displayDamageLevel);
  const showActions = mapMode === 'all' || mapMode === 'mine';
  const name = buildingName ?? `${buildingId.slice(0, 8)}…`;
  const reportsBlock =
    atBuilding.length === 0
      ? `<p class="muted">${labels.noReports}</p>`
      : `<p><span class="muted">${labels.worstDamage}: </span><strong>${statusLabel}</strong></p>`;
  const latestBlock = latest
    ? `<time>${labels.latestReport}: ${new Date(latest.captured_at_client).toLocaleString()}</time>`
    : '';
  const countBlock =
    atBuilding.length > 1
      ? `<p class="marker-popup-count muted">${labels.buildingReportCount(atBuilding.length)}</p>`
      : '';
  const actionsBlock = showActions
    ? `<div class="marker-popup-actions"><button type="button" class="primary small building-popup-btn" data-building-id="${buildingId}">${labels.viewDetails}</button></div>`
    : '';
  return `<div class="marker-popup building-popup"><p class="building-popup-name"><strong>${name}</strong></p>${reportsBlock}${latestBlock}${countBlock}${actionsBlock}</div>`;
}

export function BuildingFootprintsLayer({
  buildings,
  buildingDamageMap,
  selectedBuildingId,
  mapMode,
  markersForBuildings,
  labels,
  onBuildingSelect,
  onBuildingViewDetails,
}: Props) {
  const map = useMap();
  const mapRef = useRef(map);
  mapRef.current = map;
  const layerRef = useRef<L.GeoJSON | null>(null);
  const buildingsKey = useMemo(
    () =>
      buildings.features
        .map((f) => `${String(f.properties?.building_id ?? '')}:${f.geometry?.type ?? ''}`)
        .join('|'),
    [buildings],
  );
  const damageKey = useMemo(() => {
    const parts: string[] = [];
    for (const [id, d] of buildingDamageMap) {
      parts.push(`${id}:${d.pinDisplay}:${d.displayDamageLevel}`);
    }
    parts.sort();
    return `${selectedBuildingId ?? ''}|${parts.join(',')}`;
  }, [buildingDamageMap, selectedBuildingId]);

  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const onBuildingSelectRef = useRef(onBuildingSelect);
  onBuildingSelectRef.current = onBuildingSelect;
  const onBuildingViewDetailsRef = useRef(onBuildingViewDetails);
  onBuildingViewDetailsRef.current = onBuildingViewDetails;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const markersRef = useRef(markersForBuildings);
  markersRef.current = markersForBuildings;

  const openBuildingPopup = (feature: GeoJSON.Feature, buildingId: string) => {
    const mapInst = mapRef.current;
    const cen = centroidOfFeature(feature);
    if (!cen) return;
    const buildingName = (feature.properties?.name as string | undefined) ?? null;
    const html = buildingPopupHtml(
      buildingId,
      buildingName,
      markersRef.current,
      mapModeRef.current,
      labelsRef.current,
    );
    const popup = L.popup({ maxWidth: 280, autoPan: false, closeOnClick: false })
      .setLatLng([cen.lat, cen.lng])
      .setContent(html);
    popup.openOn(mapInst);
    window.setTimeout(() => {
      const btn = document.querySelector(
        `.building-popup-btn[data-building-id="${buildingId}"]`,
      ) as HTMLButtonElement | null;
      if (!btn) return;
      btn.onclick = () => {
        mapInst.closePopup();
        onBuildingViewDetailsRef.current(buildingId);
      };
    }, 0);
  };

  useEffect(() => {
    if (!layerRef.current) {
      layerRef.current = L.geoJSON(undefined, {
        pane: 'buildings',
        style: () => ({ ...BASE_STYLE }),
        onEachFeature: (feature, layer) => {
          const id = (feature.properties?.building_id as string) ?? null;
          const tagged = layer as TaggedLayer;
          if (id) tagged._bihBuildingId = id;
          tagged.feature = feature;
          layer.on({
            click: (e) => {
              if (!id) return;
              L.DomEvent.stopPropagation(e);
              if (mapModeRef.current === 'new') {
                onBuildingSelectRef.current(id);
                return;
              }
              openBuildingPopup(feature, id);
            },
          });
        },
      });
      layerRef.current.addTo(map);
    }

    const layer = layerRef.current;
    layer.clearLayers();
    if (buildings.features.length > 0) {
      layer.addData(buildings);
    }
  }, [map, buildingsKey, buildings]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      const tagged = l as TaggedLayer;
      const id = tagged._bihBuildingId;
      if (!id) return;
      const selected = Boolean(id === selectedBuildingId);
      const damage = buildingDamageMap.get(id);
      const { fillColor, fillOpacity } = buildingFootprintStyle(damage, selected);
      const path = l as L.Path;
      path.setStyle({ ...BASE_STYLE, fillColor, fillOpacity });
    });
  }, [damageKey, buildingDamageMap, selectedBuildingId]);

  return null;
}
