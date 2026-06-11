import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';

const ZONE_STYLE: L.PathOptions = {
  color: '#475569',
  weight: 1.5,
  dashArray: '5 4',
  fillColor: '#94a3b8',
  fillOpacity: 0.08,
  interactive: false,
};

type Zone = { id: string; name: string; geom: GeoJSON.Polygon; color?: string };

type Props = {
  zones: Zone[];
};

export function CrisisZonesLayer({ zones }: Props) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const zonesKey = useMemo(
    () => zones.map((z) => `${z.id}:${JSON.stringify(z.geom.coordinates)}`).join('|'),
    [zones],
  );

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (zones.length === 0) return;

    const collection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        properties: { name: z.name, zoneId: z.id, color: z.color },
        geometry: z.geom,
      })),
    };

    const layer = L.geoJSON(collection, {
      style: (feature) => {
        const color = (feature?.properties?.color as string | undefined) ?? ZONE_STYLE.color;
        return {
          ...ZONE_STYLE,
          color,
          fillColor: color,
        };
      },
      interactive: false,
    });
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, zonesKey, zones]);

  return null;
}
