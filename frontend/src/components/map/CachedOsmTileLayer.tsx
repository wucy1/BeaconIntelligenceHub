import L from 'leaflet';
import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

import { getTileBlob, putTileBlob } from '../../offline/tileCache';
import { osmTileUrl } from '../../offline/tileMath';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 22;

export type OfflineZoomLimits = {
  minZoom: number;
  maxZoom: number;
};

function cacheTileFromUrl(z: number, x: number, y: number, url: string): void {
  void fetch(url, { mode: 'cors', credentials: 'omit' })
    .then(async (res) => {
      if (!res.ok) return;
      const blob = await res.blob();
      if (blob.size) await putTileBlob(z, x, y, blob);
    })
    .catch(() => {
      /* ignore background cache failures */
    });
}

const CachedLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('img') as HTMLImageElement;
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    tile.crossOrigin = 'anonymous';

    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      done(err, tile);
    };

    L.DomEvent.on(tile, 'load', () => {
      finish();
      const src = tile.src;
      if (src.startsWith('http')) {
        const { x, y } = coords;
        cacheTileFromUrl(coords.z, x, y, src);
      }
    });
    L.DomEvent.on(tile, 'error', () => finish());

    const { x, y } = coords;
    const z = coords.z;
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (online) {
      tile.src = osmTileUrl(z, x, y);
      return tile;
    }

    void getTileBlob(z, x, y).then((cached) => {
      if (cached) {
        tile.src = URL.createObjectURL(cached);
        return;
      }
      tile.style.background = '#d4d4d8';
      finish();
    });

    return tile;
  },
});

/** 桌面寬螢幕初次排版時 Leaflet 尺寸常偏小，延遲校正一次即可。 */
export function MapViewportSync() {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
    };

    const scheduleSync = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sync, 80);
    };

    map.whenReady(sync);
    requestAnimationFrame(() => requestAnimationFrame(sync));
    const bootTimer = window.setTimeout(sync, 200);

    window.addEventListener('resize', scheduleSync);

    return () => {
      cancelled = true;
      window.clearTimeout(bootTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [map]);

  return null;
}

export function MapZoomLimits({
  offlineZoomLimits,
}: {
  offlineZoomLimits?: OfflineZoomLimits | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (offlineZoomLimits) {
      map.setMinZoom(offlineZoomLimits.minZoom);
      map.setMaxZoom(offlineZoomLimits.maxZoom);
    } else {
      map.setMinZoom(DEFAULT_MIN_ZOOM);
      map.setMaxZoom(DEFAULT_MAX_ZOOM);
    }
    map.setMaxBounds(undefined);

    return () => {
      map.setMinZoom(DEFAULT_MIN_ZOOM);
      map.setMaxZoom(DEFAULT_MAX_ZOOM);
      map.setMaxBounds(undefined);
    };
  }, [map, offlineZoomLimits]);

  return null;
}

export function StandardOsmTileLayer() {
  return (
    <TileLayer
      url={OSM_TILE_URL}
      attribution={ATTRIBUTION}
      maxZoom={19}
      keepBuffer={6}
      crossOrigin
      {...({ fadeAnimation: false, updateWhenIdle: false } as object)}
    />
  );
}

export function OfflineOsmTileLayer() {
  const map = useMap();

  useEffect(() => {
    const layer = new (CachedLayer as unknown as typeof L.TileLayer)('', {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      keepBuffer: 4,
      crossOrigin: true,
    });

    let active = true;
    const attach = () => {
      if (!active) return;
      layer.addTo(map);
    };

    if ((map as L.Map & { _loaded?: boolean })._loaded) attach();
    else map.whenReady(attach);

    return () => {
      active = false;
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

type Props = {
  online: boolean;
  offlineZoomLimits?: OfflineZoomLimits | null;
};

/** @deprecated Prefer MapZoomLimits + StandardOsmTileLayer/OfflineOsmTileLayer as MapContainer direct children */
export function CachedOsmTileLayer({ online, offlineZoomLimits }: Props) {
  const useStandardTiles = online && !offlineZoomLimits;
  return (
    <>
      <MapZoomLimits offlineZoomLimits={offlineZoomLimits} />
      {useStandardTiles ? <StandardOsmTileLayer /> : <OfflineOsmTileLayer />}
    </>
  );
}
