export const OFFLINE_DB_NAME = 'bih-offline';
export const OFFLINE_DB_VERSION = 3;

const STORES = ['pending_reports', 'crisis_snapshot', 'map_tiles', 'map_regions'] as const;

/** 共用 IndexedDB（佇列、危機快照、地圖瓦片） */
export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending_reports')) {
        db.createObjectStore('pending_reports', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('crisis_snapshot')) {
        db.createObjectStore('crisis_snapshot');
      }
      if (!db.objectStoreNames.contains('map_tiles')) {
        db.createObjectStore('map_tiles');
      }
      if (!db.objectStoreNames.contains('map_regions')) {
        db.createObjectStore('map_regions');
      }
    };
  });
}

export function assertOfflineStores(db: IDBDatabase): void {
  for (const name of STORES) {
    if (!db.objectStoreNames.contains(name)) {
      throw new Error(`Missing IndexedDB store: ${name}`);
    }
  }
}
