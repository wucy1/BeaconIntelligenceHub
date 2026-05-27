import type { ActiveWindow } from '../hooks/useActiveWindow';

const DB_NAME = 'bih-offline';
const STORE = 'crisis_snapshot';
const DB_VERSION = 2;
const CACHE_KEY = 'active';

export type CachedActiveWindow = {
  savedAt: string;
  data: ActiveWindow;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion;
      if (oldVersion < 1 && !db.objectStoreNames.contains('pending_reports')) {
        db.createObjectStore('pending_reports', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export async function saveActiveWindowSnapshot(data: ActiveWindow): Promise<void> {
  const db = await openDb();
  const entry: CachedActiveWindow = { savedAt: new Date().toISOString(), data };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry, CACHE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadActiveWindowSnapshot(): Promise<CachedActiveWindow | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(CACHE_KEY);
    req.onsuccess = () => resolve((req.result as CachedActiveWindow | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}
