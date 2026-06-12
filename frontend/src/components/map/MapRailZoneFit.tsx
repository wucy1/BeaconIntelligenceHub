import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  visible: boolean;
  title: string;
  onFit: () => void;
  hostSelector?: string;
};

export function MapRailZoneFit({
  visible,
  title,
  onFit,
  hostSelector = '.map-page',
}: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>(hostSelector));
  }, [hostSelector]);

  if (!visible || !host) return null;

  return createPortal(
    <button
      type="button"
      className="map-rail-zone-fit"
      title={title}
      aria-label={title}
      onClick={onFit}
    >
      ⊞
    </button>,
    host,
  );
}
