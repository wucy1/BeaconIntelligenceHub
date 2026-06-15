import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';

import type { MapPinDisplay } from '../../utils/mapMarkers';
import { buildingFootprintStyle } from '../../utils/mapMarkers';

const BASE_STYLE: L.PathOptions = {
  color: '#1155cc',
  weight: 2,
  fillColor: '#3388ff',
  fillOpacity: 0.28,
};

type DamageDisplay = {
  pinDisplay: MapPinDisplay;
  displayDamageLevel: string;
};

type Props = {
  buildings: GeoJSON.FeatureCollection;
  selectedBuildingId: string | null;
  buildingDamageMap: Map<string, DamageDisplay>;
  onEachFeature: (feature: GeoJSON.Feature, layer: L.Layer) => void;
};

function styleForFeature(
  feature: GeoJSON.Feature,
  selectedBuildingId: string | null,
  buildingDamageMap: Map<string, DamageDisplay>,
): L.PathOptions {
  const id = feature.properties?.building_id as string | undefined;
  const selected = Boolean(id && id === selectedBuildingId);
  const damage = id ? buildingDamageMap.get(id) : undefined;
  const { fillColor, fillOpacity } = buildingFootprintStyle(damage, selected);
  return { ...BASE_STYLE, fillColor, fillOpacity };
}

export function BuildingsFootprintLayer({
  buildings,
  selectedBuildingId,
  buildingDamageMap,
  onEachFeature,
}: Props) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const onEachFeatureRef = useRef(onEachFeature);
  onEachFeatureRef.current = onEachFeature;

  const dataKey = useMemo(() => {
    const ids = buildings.features
      .map((f) => (f.properties?.building_id as string) ?? '')
      .filter(Boolean);
    if (ids.length === 0) return '0';
    return `${ids.length}:${ids[0]}:${ids[ids.length - 1]}`;
  }, [buildings]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (buildings.features.length === 0) return;

    const layer = L.geoJSON(buildings, {
      style: (feature) =>
        styleForFeature(feature as GeoJSON.Feature, selectedBuildingId, buildingDamageMap),
      onEachFeature: (feature, layer) => {
        onEachFeatureRef.current(feature as GeoJSON.Feature, layer);
      },
    });
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, dataKey]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      const feature = (l as L.Layer & { feature?: GeoJSON.Feature }).feature;
      if (!feature) return;
      (l as L.Path).setStyle(styleForFeature(feature, selectedBuildingId, buildingDamageMap));
    });
  }, [selectedBuildingId, buildingDamageMap]);

  return null;
}
