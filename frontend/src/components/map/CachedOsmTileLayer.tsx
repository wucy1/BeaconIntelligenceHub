import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';

import { getTileBlob, putTileBlob } from '../../offline/tileCache';
import { osmTileUrl } from '../../offline/tileMath';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 22;

const TILE_OPTS = {
  attribution: ATTRIBUTION,
  maxZoom: 19,
  keepBuffer: 6,
  crossOrigin: true,
  fadeAnimation: false,
  updateWhenIdle: false,
} as L.TileLayerOptions;

function MapTileResizeSync() {
  const map = useMap();

  useEffect(() => {
    const sync = () => {
      map.invalidateSize({ animate: false });
    };

    sync();
    map.whenReady(sync);

    window.addEventListener('resize', sync);
    const container = map.getContainer();
    const observer = new ResizeObserver(sync);
    observer.observe(container);

    return () => {
      window.removeEventListener('resize', sync);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

export type OfflineZoomLimits = {
  minZoom: number;
  maxZoom: number;
};

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine,
  );
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

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

type Props = {
  /**
   * 離線已選區域：只限制縮放級距（與下載的 z 範圍一致），不用 maxBounds 以免無法放大。
   */
  offlineZoomLimits?: OfflineZoomLimits | null;
};

export function CachedOsmTileLayer({ offlineZoomLimits }: Props) {
  const map = useMap();
  const online = useOnlineStatus();
  const layerRef = useRef<L.TileLayer | null>(null);
  const modeKeyRef = useRef('');
  const useStandardTiles = online && !offlineZoomLimits;

  useEffect(() => {
    const modeKey = useStandardTiles ? 'standard' : 'offline';
    if (layerRef.current && modeKeyRef.current === modeKey) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    layerRef.current = useStandardTiles
      ? L.tileLayer(OSM_URL, TILE_OPTS)
      : new (CachedLayer as unknown as typeof L.TileLayer)('', {
          ...TILE_OPTS,
          keepBuffer: 4,
        });
    layerRef.current.addTo(map);
    layerRef.current.redraw();
    modeKeyRef.current = modeKey;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        modeKeyRef.current = '';
      }
    };
  }, [map, useStandardTiles]);

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

  return <MapTileResizeSync />;
}
