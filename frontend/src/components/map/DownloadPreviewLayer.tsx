import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import { bboxForBox, type LatLng } from '../../offline/tileMath';

type Props = {
  center?: LatLng;
  /** 方形邊長（km），例如 3 表示 3×3 km */
  sideKm: number;
  variant?: 'target' | 'preview';
  /** 鎖在視野中心（中心紅框）；拖曳時用 map.getCenter() 即時更新，不走 React state */
  anchorToMapCenter?: boolean;
};

const TARGET_STYLE: L.PathOptions = {
  color: '#dc2626',
  weight: 2,
  dashArray: '10 6',
  fillColor: '#ef4444',
  fillOpacity: 0.08,
  interactive: false,
};

const PREVIEW_STYLE: L.PathOptions = {
  color: '#ea580c',
  weight: 2,
  dashArray: '10 6',
  fillColor: '#f97316',
  fillOpacity: 0.15,
  interactive: false,
};

function boundsForCenter(center: LatLng, sideKm: number): L.LatLngBounds {
  const box = bboxForBox(center, sideKm);
  return L.latLngBounds([box.south, box.west], [box.north, box.east]);
}

export function DownloadPreviewLayer({
  center,
  sideKm,
  variant = 'preview',
  anchorToMapCenter = false,
}: Props) {
  const map = useMap();
  const layerRef = useRef<L.Rectangle | null>(null);

  useEffect(() => {
    const style = variant === 'target' ? TARGET_STYLE : PREVIEW_STYLE;

    const syncBounds = (c: LatLng) => {
      const bounds = boundsForCenter(c, sideKm);
      if (!layerRef.current) {
        layerRef.current = L.rectangle(bounds, style);
        layerRef.current.addTo(map);
      } else {
        layerRef.current.setBounds(bounds);
      }
    };

    if (anchorToMapCenter) {
      const updateFromMap = () => {
        const c = map.getCenter();
        syncBounds({ lat: c.lat, lng: c.lng });
      };
      updateFromMap();
      map.on('move', updateFromMap);
      map.on('zoom', updateFromMap);
      return () => {
        map.off('move', updateFromMap);
        map.off('zoom', updateFromMap);
        if (layerRef.current) {
          map.removeLayer(layerRef.current);
          layerRef.current = null;
        }
      };
    }

    if (!center) return;
    syncBounds(center);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, anchorToMapCenter, center?.lat, center?.lng, sideKm, variant]);

  return null;
}
