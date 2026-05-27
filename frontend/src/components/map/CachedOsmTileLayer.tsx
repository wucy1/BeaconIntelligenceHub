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

async function loadTileInto(
  img: HTMLImageElement,
  z: number,
  x: number,
  y: number,
  allowNetwork: boolean,
): Promise<boolean> {
  const cached = await getTileBlob(z, x, y);
  if (cached) {
    img.src = URL.createObjectURL(cached);
    return true;
  }
  if (!allowNetwork) return false;

  try {
    const res = await fetch(osmTileUrl(z, x, y), { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;
    await putTileBlob(z, x, y, blob);
    img.src = URL.createObjectURL(blob);
    return true;
  } catch {
    return false;
  }
}

const CachedLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('img') as HTMLImageElement;
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    L.DomEvent.on(tile, 'load', () => done(undefined, tile));
    L.DomEvent.on(tile, 'error', () => done(undefined, tile));

    const { x, y } = coords;
    const z = coords.z;
    const allowNetwork = typeof navigator !== 'undefined' ? navigator.onLine : true;

    void loadTileInto(tile, z, x, y, allowNetwork).then((ok) => {
      if (!ok && !tile.src) {
        tile.style.background = '#e8e8e8';
        done(undefined, tile);
      }
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

  useEffect(() => {
    const layer = new (CachedLayer as unknown as typeof L.TileLayer)('', {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
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
