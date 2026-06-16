import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import type { MapRegionMeta } from '../../offline/tileCache';
import { bboxForBox } from '../../offline/tileMath';

type Props = {
  regions: MapRegionMeta[];
  activeRegionId: string | null;
  onSelect?: (regionId: string) => void;
  /** 新增回報放釘時停用，避免點擊觸發區域置中 */
  interactive?: boolean;
  /** 連線時僅顯示已下載範圍，不攔截建物 footprint 點擊 */
  online?: boolean;
};

function boundsForRegion(r: MapRegionMeta): L.LatLngBounds {
  const box = bboxForBox(r.center, r.radiusKm * 2);
  return L.latLngBounds([box.south, box.west], [box.north, box.east]);
}

export function OfflineRegionLayers({
  regions,
  activeRegionId,
  onSelect,
  interactive = true,
  online = true,
}: Props) {
  const regionInteractive = interactive && !online;
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const group = L.layerGroup();
    group.addTo(map);
    groupRef.current = group;
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    group.clearLayers();
    for (const r of regions) {
      const active = r.id === activeRegionId;
      const rect = L.rectangle(boundsForRegion(r), {
        pane: 'offline-regions',
        stroke: false,
        fillColor: active ? '#2563eb' : '#3b82f6',
        fillOpacity: active ? 0.28 : 0.18,
        interactive: regionInteractive,
      });
      if (regionInteractive) {
        rect.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          onSelectRef.current?.(r.id);
        });
      }
      group.addLayer(rect);
    }
  }, [regions, activeRegionId, regionInteractive]);

  return null;
}
