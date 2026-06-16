import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, useMap } from 'react-leaflet';

import 'leaflet/dist/leaflet.css';

import { OsmTileLayer } from '../map/CachedOsmTileLayer';
import { DAMAGE_FILL } from '../../utils/mapMarkers';

type ReportPoint = {
  id: string;
  damage_level: string;
  geom: GeoJSON.Point | null;
};

type Props = {
  items: ReportPoint[];
};

function FitReportBounds({ items }: { items: ReportPoint[] }) {
  const map = useMap();
  const latlngs = useMemo(
    () =>
      items
        .map((r) => r.geom?.coordinates)
        .filter((c): c is [number, number] => Boolean(c))
        .map(([lng, lat]) => L.latLng(lat, lng)),
    [items],
  );

  useEffect(() => {
    if (latlngs.length === 0) return;
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 16, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24], maxZoom: 16, animate: false });
  }, [map, latlngs]);

  return null;
}

export function DashboardMap({ items }: Props) {
  const withGeom = items.filter((r) => r.geom?.coordinates);
  const defaultCenter: [number, number] = withGeom.length
    ? [withGeom[0].geom!.coordinates[1], withGeom[0].geom!.coordinates[0]]
    : [40.7128, -74.006];

  return (
    <div className="dashboard-map-wrap">
      <MapContainer
        className="dashboard-map"
        center={defaultCenter}
        zoom={14}
        scrollWheelZoom={false}
        zoomControl
      >
        <OsmTileLayer />
        <FitReportBounds items={withGeom} />
        {withGeom.map((r) => {
          const [lng, lat] = r.geom!.coordinates;
          const color = DAMAGE_FILL[r.damage_level] ?? '#64748b';
          return (
            <CircleMarker
              key={r.id}
              center={[lat, lng]}
              radius={7}
              pathOptions={{
                color: '#0f172a',
                weight: 1,
                fillColor: color,
                fillOpacity: 0.88,
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
