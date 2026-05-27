import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 22;

type Props = {
  /** 離線填報模式：鎖定目前視野，避免平移／縮放載入未快取瓦片而灰屏 */
  enabled: boolean;
  /** 定位飛行等結束後遞增，以便在新視野重新上鎖 */
  resetKey?: string;
};

/**
 * 離線時 OSM 瓦片無法下載；瀏覽器僅保留曾瀏覽過的瓦片。
 * 鎖定 bounds + zoom，讓使用者仍可在已快取畫面上拖動圖釘，而不會拖到灰區。
 */
export function OfflineMapViewLock({ enabled, resetKey }: Props) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) {
      map.setMaxBounds(undefined);
      map.setMinZoom(DEFAULT_MIN_ZOOM);
      map.setMaxZoom(DEFAULT_MAX_ZOOM);
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      return;
    }

    let cancelled = false;

    const applyLock = () => {
      if (cancelled) return;
      const zoom = map.getZoom();
      const bounds = map.getBounds().pad(0.03);
      map.setMaxBounds(bounds);
      map.setMinZoom(zoom);
      map.setMaxZoom(zoom);
    };

    const onMoveEnd = () => {
      if (cancelled) return;
      window.setTimeout(applyLock, 350);
    };

    map.on('moveend', onMoveEnd);
    onMoveEnd();

    return () => {
      cancelled = true;
      map.off('moveend', onMoveEnd);
    };
  }, [enabled, resetKey, map]);

  return null;
}
