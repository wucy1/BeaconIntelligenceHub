import L from 'leaflet';
import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

import { isEffectivelyOnline } from '../../offline/connectivity';
import { getTileBlob, putTileBlob } from '../../offline/tileCache';
import { osmTileUrl, PREFETCH_ZOOM_MAX } from '../../offline/tileMath';

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 22;
const NETWORK_TILE_TIMEOUT_MS = 8000;

export type OfflineZoomLimits = {
  minZoom: number;
  maxZoom: number;
};

/** Ops map: standard OSM tiles (online ops console). */
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

function loadNetworkTile(
  tile: HTMLImageElement,
  z: number,
  x: number,
  y: number,
  finish: (err?: Error) => void,
): void {
  const url = osmTileUrl(z, x, y);
  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    tile.removeAttribute('src');
    tile.style.background = '#d4d4d8';
    finish();
  }, NETWORK_TILE_TIMEOUT_MS);

  const onLoad = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    finish();
    cacheTileFromUrl(z, x, y, url);
  };
  const onError = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    tile.style.background = '#d4d4d8';
    finish();
  };

  L.DomEvent.on(tile, 'load', onLoad);
  L.DomEvent.on(tile, 'error', onError);
  tile.src = url;
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

    const { x, y } = coords;
    const z = coords.z;

    void getTileBlob(z, x, y).then((cached) => {
      if (cached) {
        L.DomEvent.on(tile, 'load', () => finish());
        L.DomEvent.on(tile, 'error', () => {
          tile.style.background = '#d4d4d8';
          finish();
        });
        tile.src = URL.createObjectURL(cached);
        return;
      }

      if (isEffectivelyOnline()) {
        loadNetworkTile(tile, z, x, y, finish);
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
