import { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

type View = { lat: number; lng: number; zoom: number };

export function MapViewWatcher({ onViewChange }: { onViewChange?: (view: View) => void }) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = () => {
    if (!onViewChange) return;
    const c = map.getCenter();
    onViewChange({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  };

  const scheduleEmit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(emit, 200);
  };

  useMapEvents({
    moveend: scheduleEmit,
    zoomend: scheduleEmit,
  });

  useEffect(() => {
    emit();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [map]);

  return null;
}
