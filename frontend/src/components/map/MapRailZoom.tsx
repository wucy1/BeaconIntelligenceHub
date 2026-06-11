import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';

type Props = {
  /** Portal host selector; defaults to `.map-page` */
  hostSelector?: string;
};

export function MapRailZoom({ hostSelector = '.map-page' }: Props) {
  const map = useMap();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>(hostSelector));
  }, [hostSelector]);

  if (!host) return null;

  return createPortal(
    <div className="map-rail-zoom" aria-label="Zoom">
      <button
        type="button"
        className="map-rail-zoom-in"
        aria-label="Zoom in"
        onClick={() => map.zoomIn()}
      >
        +
      </button>
      <button
        type="button"
        className="map-rail-zoom-out"
        aria-label="Zoom out"
        onClick={() => map.zoomOut()}
      >
        −
      </button>
    </div>,
    host,
  );
}
