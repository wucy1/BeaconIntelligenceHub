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
    setDenied(false);
    setPending(true);

    const onSuccess = (pos: GeolocationPosition) => {
      setPosition({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
      setDenied(false);
      setPending(false);
    };

    const fallbackLowAccuracy = () => {
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        (err2) => {
          setDenied(err2.code === err2.PERMISSION_DENIED);
          setPending(false);
        },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 },
      );
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setDenied(true);
          setPending(false);
          return;
        }
        // High-accuracy may timeout on mobile; retry once with lower accuracy.
        fallbackLowAccuracy();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, []);

  return { position, denied, pending, request, setPosition };
}
