import { useEffect } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

type Props = {
  enabled: boolean;
  onClear: () => void;
};

/** 點擊地圖空白或按 Esc 清除分區選取 */
export function OpsMapClearSelection({ enabled, onClear }: Props) {
  const map = useMap();

  useMapEvents({
    click: () => {
      if (enabled) onClear();
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onClear, map]);

  return null;
}
