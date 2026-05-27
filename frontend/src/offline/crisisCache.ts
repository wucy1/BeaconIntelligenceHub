import type { ActiveWindow } from '../hooks/useActiveWindow';
import { openOfflineDb } from './openDb';

const STORE = 'crisis_snapshot';
const CACHE_KEY = 'active';

export type CachedActiveWindow = {
  savedAt: string;
  data: ActiveWindow;
};

export async function saveActiveWindowSnapshot(data: ActiveWindow): Promise<void> {
  const db = await openOfflineDb();
  const entry: CachedActiveWindow = { savedAt: new Date().toISOString(), data };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry, CACHE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadActiveWindowSnapshot(): Promise<CachedActiveWindow | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(CACHE_KEY);
    req.onsuccess = () => resolve((req.result as CachedActiveWindow | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}
