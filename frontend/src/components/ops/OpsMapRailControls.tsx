import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';

type Props = {
  zoneFitVisible: boolean;
  zoneFitTitle: string;
  onZoneFit: () => void;
};

export function OpsMapRailControls({ zoneFitVisible, zoneFitTitle, onZoneFit }: Props) {
  const map = useMap();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.ops-map-rail-stack-host'));
  }, []);

  if (!host) return null;

  return createPortal(
    <div className="ops-map-rail-stack" aria-label="Map controls">
      <div className="map-rail-zoom">
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
      </div>
      {zoneFitVisible && (
        <button
          type="button"
          className="map-rail-zone-fit"
          title={zoneFitTitle}
          aria-label={zoneFitTitle}
          onClick={onZoneFit}
        >
          ⊞
        </button>
      )}
    </div>,
    host,
  );
}
