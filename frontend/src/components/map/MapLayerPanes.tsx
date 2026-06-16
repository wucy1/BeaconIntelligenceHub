import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/** Keeps offline region fills below building footprints for hit-testing. */
export function MapLayerPanes() {
  const map = useMap();

  useEffect(() => {
    const ensure = (name: string, zIndex: string) => {
      let pane = map.getPane(name);
      if (!pane) {
        map.createPane(name);
        pane = map.getPane(name)!;
      }
      pane.style.zIndex = zIndex;
    };
    ensure('offline-regions', '350');
    ensure('buildings', '450');
  }, [map]);

  return null;
}
