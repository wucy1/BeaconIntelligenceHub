import { useEffect, useState } from 'react';

import {
  isEffectivelyOnline,
  subscribeEffectiveOnline,
} from '../offline/connectivity';

/**
 * Effective online status: navigator.onLine plus same-origin reachability probes.
 * Weak/dead networks where navigator.onLine stays true are treated as offline
 * after consecutive probe failures.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => isEffectivelyOnline());

  useEffect(() => subscribeEffectiveOnline(setOnline), []);

  return online;
}
