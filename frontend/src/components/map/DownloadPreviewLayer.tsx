import { Rectangle } from 'react-leaflet';

import { bboxForBox, type LatLng } from '../../offline/tileMath';

type Props = {
  center: LatLng;
  /** 方形邊長（km），例如 3 表示 3×3 km */
  sideKm: number;
  variant?: 'target' | 'preview';
};

export function DownloadPreviewLayer({ center, sideKm, variant = 'preview' }: Props) {
  const box = bboxForBox(center, sideKm);
  const bounds: [[number, number], [number, number]] = [
    [box.south, box.west],
    [box.north, box.east],
  ];

  const isTarget = variant === 'target';

  return (
    <Rectangle
      bounds={bounds}
      pathOptions={
        isTarget
          ? {
              color: '#dc2626',
              weight: 2,
              dashArray: '10 6',
              fillColor: '#ef4444',
              fillOpacity: 0.08,
            }
          : {
              color: '#ea580c',
              weight: 2,
              dashArray: '10 6',
              fillColor: '#f97316',
              fillOpacity: 0.15,
            }
      }
    />
  );
}
