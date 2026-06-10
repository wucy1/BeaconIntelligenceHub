import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

import { getTileBlob, putTileBlob } from '../../offline/tileCache';
import { osmTileUrl } from '../../offline/tileMath';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

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

    void (async () => {
      const cached = await getTileBlob(z, x, y);
      if (cached) {
        tile.src = URL.createObjectURL(cached);
        return;
      }
      if (!online) {
        tile.style.background = '#d4d4d8';
        finish();
        return;
      }
      tile.src = osmTileUrl(z, x, y);
    })();

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

  useEffect(() => {
    const layer = new (CachedLayer as unknown as typeof L.TileLayer)('', {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
      keepBuffer: 4,
    });
    layer.addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

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
