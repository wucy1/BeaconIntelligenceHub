import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

type Props = {
  geojson: GeoJSON.FeatureCollection;
  value: string | null;
  onChange: (buildingId: string | null) => void;
};

const STYLE = 'https://demotiles.maplibre.org/style.json';

export function MapPicker({ geojson, value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [121.5608, 25.0305],
      zoom: 15,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource('buildings', {
        type: 'geojson',
        data: geojson,
      });
      map.addLayer({
        id: 'buildings-fill',
        type: 'fill',
        source: 'buildings',
        paint: {
          'fill-color': '#3388ff',
          'fill-opacity': 0.25,
        },
      });
      map.addLayer({
        id: 'buildings-outline',
        type: 'line',
        source: 'buildings',
        paint: {
          'line-color': '#1155cc',
          'line-width': 2,
        },
      });
      const bounds = new maplibregl.LngLatBounds();
      geojson.features.forEach((f) => {
        if (!f.geometry) return;
        if (f.geometry.type === 'Polygon') {
          f.geometry.coordinates[0].forEach((c) => bounds.extend(c as [number, number]));
        }
        if (f.geometry.type === 'MultiPolygon') {
          f.geometry.coordinates.forEach((poly) =>
            poly[0].forEach((c) => bounds.extend(c as [number, number])),
          );
        }
      });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, maxZoom: 17 });
      }
      setReady(true);
    });

    map.on('click', (e) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: ['buildings-fill'] });
      if (!feats.length) {
        onChangeRef.current(null);
        return;
      }
      const id = feats[0].properties?.building_id as string | undefined;
      onChangeRef.current(id ?? null);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [geojson]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setPaintProperty(
      'buildings-fill',
      'fill-color',
      [
        'case',
        ['==', ['get', 'building_id'], value ?? ''],
        '#ff5533',
        '#3388ff',
      ],
    );
  }, [value, ready]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: 280, borderRadius: 8, overflow: 'hidden' }}
      role="application"
      aria-label="Map — click a building footprint"
    />
  );
}
