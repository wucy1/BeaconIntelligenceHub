import { useEffect, useState } from 'react';

/** True on narrow viewports — map chrome (legend, contribution) starts collapsed. */
export function usePreferCollapsedChrome(): boolean {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 640px)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setCollapsed(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return collapsed;
}
