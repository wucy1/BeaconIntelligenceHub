import { Rectangle } from 'react-leaflet';

import { bboxForDisk, type LatLng } from '../../offline/tileMath';

type Props = {
  center: LatLng;
  radiusKm: number;
};

export function DownloadPreviewLayer({ center, radiusKm }: Props) {
  const box = bboxForDisk(center, radiusKm);
  const bounds: [[number, number], [number, number]] = [
    [box.south, box.west],
    [box.north, box.east],
  ];

  return (
    <Rectangle
      bounds={bounds}
      pathOptions={{
        color: '#ea580c',
        weight: 2,
        dashArray: '10 6',
        fillColor: '#f97316',
        fillOpacity: 0.15,
      }}
    />
  );
}
