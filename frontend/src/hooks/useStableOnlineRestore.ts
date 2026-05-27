import { useEffect, useRef, useState } from 'react';

import { useOnlineStatus } from './useOnlineStatus';

const STABLE_MS = 2500;

/** 離線後連線穩定恢復時觸發一次提示 */
export function useStableOnlineRestore() {
  const online = useOnlineStatus();
  const wasOfflineRef = useRef(false);
  const [restoredStable, setRestoredStable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      setRestoredStable(false);
      return;
    }
    if (!wasOfflineRef.current || dismissed) return;

    const timer = window.setTimeout(() => {
      if (navigator.onLine) setRestoredStable(true);
    }, STABLE_MS);

    return () => window.clearTimeout(timer);
  }, [online, dismissed]);

  const dismiss = () => {
    setDismissed(true);
    setRestoredStable(false);
  };

  const showRestoredBanner = online && restoredStable && !dismissed;

  return { online, showRestoredBanner, dismissRestoredBanner: dismiss };
}
