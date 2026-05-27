import { Circle } from 'react-leaflet';

import type { MapRegionMeta } from '../../offline/tileCache';

type Props = {
  regions: MapRegionMeta[];
  activeRegionId: string | null;
  onSelect?: (regionId: string) => void;
};

export function OfflineRegionLayers({ regions, activeRegionId, onSelect }: Props) {
  return (
    <>
      {regions.map((r) => {
        const active = r.id === activeRegionId;
        return (
          <Circle
            key={r.id}
            center={[r.center.lat, r.center.lng]}
            radius={r.radiusKm * 1000}
            pathOptions={{
              color: active ? '#2563eb' : '#64748b',
              weight: active ? 3 : 2,
              dashArray: active ? undefined : '6 4',
              fillColor: active ? '#3b82f6' : '#94a3b8',
              fillOpacity: active ? 0.18 : 0.08,
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
