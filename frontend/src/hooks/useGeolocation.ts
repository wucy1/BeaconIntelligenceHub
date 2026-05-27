import { useCallback, useState } from 'react';

export type GeoPosition = { lat: number; lng: number; accuracy?: number };

export function useGeolocation() {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setDenied(true);
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setDenied(false);
        setPending(false);
      },
      () => {
        setDenied(true);
        setPending(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, []);

  return { position, denied, pending, request, setPosition };
}
