import { Rectangle } from 'react-leaflet';

import type { MapRegionMeta } from '../../offline/tileCache';
import { bboxForDisk } from '../../offline/tileMath';

type Props = {
  regions: MapRegionMeta[];
  activeRegionId: string | null;
  onSelect?: (regionId: string) => void;
};

function boundsForRegion(r: MapRegionMeta): [[number, number], [number, number]] {
  const box = bboxForDisk(r.center, r.radiusKm);
  return [
    [box.south, box.west],
    [box.north, box.east],
  ];
}

export function OfflineRegionLayers({ regions, activeRegionId, onSelect }: Props) {
  return (
    <>
      {regions.map((r) => {
        const active = r.id === activeRegionId;
        return (
          <Rectangle
            key={r.id}
            bounds={boundsForRegion(r)}
            pathOptions={{
              stroke: false,
              fillColor: active ? '#2563eb' : '#3b82f6',
              fillOpacity: active ? 0.28 : 0.18,
            }}
            eventHandlers={{
              click: () => onSelect?.(r.id),
            }}
          />
        );
      })}
    </>
  );
}
