import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import type { MapRegionMeta } from '../../offline/tileCache';
import { bboxForBox } from '../../offline/tileMath';

type Props = {
  regions: MapRegionMeta[];
  activeRegionId: string | null;
  onSelect?: (regionId: string) => void;
};

function boundsForRegion(r: MapRegionMeta): L.LatLngBounds {
  const box = bboxForBox(r.center, r.radiusKm * 2);
  return L.latLngBounds([box.south, box.west], [box.north, box.east]);
}

export function OfflineRegionLayers({ regions, activeRegionId, onSelect }: Props) {
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
        stroke: false,
        fillColor: active ? '#2563eb' : '#3b82f6',
        fillOpacity: active ? 0.28 : 0.18,
      });
      rect.on('click', () => onSelectRef.current?.(r.id));
      group.addLayer(rect);
    }
  }, [regions, activeRegionId]);

  return null;
}
