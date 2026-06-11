import L from 'leaflet';
import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

import { getTileBlob, putTileBlob } from '../../offline/tileCache';
import { osmTileUrl, PREFETCH_ZOOM_MAX } from '../../offline/tileMath';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 22;

export type OfflineZoomLimits = {
  minZoom: number;
  maxZoom: number;
};

/** 與 OpsMapPage 相同：標準 OSM 瓦片，不額外設定 crossOrigin / invalidateSize。 */
export function OsmTileLayer() {
  return <TileLayer url={OSM_TILE_URL} attribution={ATTRIBUTION} />;
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

export function OfflineOsmTileLayer() {
  const map = useMap();

  useEffect(() => {
    const layer = new (CachedLayer as unknown as typeof L.TileLayer)('', {
      attribution: ATTRIBUTION,
      maxZoom: PREFETCH_ZOOM_MAX,
      keepBuffer: 4,
      crossOrigin: true,
    });
    layer.addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

export function MapZoomLimits({
  offlineZoomLimits,
}: {
  offlineZoomLimits: OfflineZoomLimits;
}) {
  const map = useMap();

  useEffect(() => {
    const { minZoom, maxZoom } = offlineZoomLimits;
    map.setMinZoom(minZoom);
    map.setMaxZoom(maxZoom);
    map.setMaxBounds(undefined);

    const z = map.getZoom();
    if (z > maxZoom) map.setZoom(maxZoom);
    else if (z < minZoom) map.setZoom(minZoom);

    return () => {
      map.setMinZoom(DEFAULT_MIN_ZOOM);
      map.setMaxZoom(DEFAULT_MAX_ZOOM);
      map.setMaxBounds(undefined);
    };
  }, [map, offlineZoomLimits]);

  return null;
}
