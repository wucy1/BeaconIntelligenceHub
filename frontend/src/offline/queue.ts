import { apiGet, apiPost, apiPutRaw, ensureApiReady, sha256Hex, SUBMIT_TIMEOUT_MS } from '../api';
import {
  clearApiUploadPreference,
  rememberApiUploadPreferred,
  shouldSoftWakeApi,
  shouldTryApiUploadFirst,
} from '../utils/browserUpload';
import { UNSPECIFIED_CRISIS_ID } from '../constants/crisis';
import { openOfflineDb } from './openDb';

const STORE = 'pending_reports';

export type PendingReport = {
  id: string;
  crisisId: string;
  payload: Record<string, unknown>;
  fileBlob: Blob;
  mimeType: string;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  lastError?: string;
};

export type PendingReportSummary = {
  id: string;
  createdAt: string;
  status: PendingReport['status'];
  lastError?: string;
};

export async function enqueueReport(
  crisisId: string,
  payload: Record<string, unknown>,
  file: File,
): Promise<string> {
  const db = await openOfflineDb();
  const id = (payload.client_generated_uuid as string) || crypto.randomUUID();
  const item: PendingReport = {
    id,
    crisisId: presignCrisisId(crisisId),
    payload: { ...payload, client_generated_uuid: id, crisis_id: UNSPECIFIED_CRISIS_ID },
    fileBlob: file,
    mimeType: file.type || 'image/jpeg',
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function countPending(): Promise<number> {
  const all = await listPending();
  return all.filter((r) => r.status === 'pending' || r.status === 'failed' || r.status === 'syncing').length;
}

/** 上次同步中斷時，syncing 項目不會再被處理；重設為 pending。 */
async function resetStuckSyncing(): Promise<void> {
  const items = await listPending();
  for (const item of items.filter((r) => r.status === 'syncing')) {
    await updateStatus(item.id, 'pending');
  }
}

async function listPending(): Promise<PendingReport[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingReport[]);
    req.onerror = () => reject(req.error);
  });
}

export async function listPendingSummaries(): Promise<PendingReportSummary[]> {
  const rows = await listPending();
  return rows
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      status: r.status,
      lastError: r.lastError,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function removeReport(id: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removePendingReport(id: string): Promise<void> {
  await removeReport(id);
}

export async function clearFailedReports(): Promise<number> {
  const rows = await listPending();
  const failed = rows.filter((r) => r.status === 'failed');
  for (const item of failed) {
    await removeReport(item.id);
  }
  return failed.length;
}

async function syncOne(item: PendingReport): Promise<void> {
  await updateStatus(item.id, 'syncing');
  const crisisId = presignCrisisId(item.crisisId);
  const payload = { ...item.payload, crisis_id: UNSPECIFIED_CRISIS_ID };
  const file = new File([item.fileBlob], 'photo.jpg', { type: item.mimeType });
  await submitReportOnline(crisisId, payload, file, { skipWake: true });
  await removeReport(item.id);
}

export async function retryPendingReport(id: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  const items = await listPending();
  const item = items.find((r) => r.id === id);
  if (!item) return false;
  try {
    await syncOne(item);
    return true;
  } catch (e) {
    await updateStatus(item.id, 'failed', e instanceof Error ? e.message : String(e));
    return false;
  }
}

async function updateStatus(id: string, status: PendingReport['status'], lastError?: string) {
  const db = await openOfflineDb();
  const all = await listPending();
  const item = all.find((r) => r.id === id);
  if (!item) return;
  item.status = status;
  item.lastError = lastError;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type SubmitReportResult = {
  possible_duplicate: boolean;
};

function presignCrisisId(storedId: string): string {
  return storedId && storedId.length > 10 ? storedId : UNSPECIFIED_CRISIS_ID;
}

async function presignUpload(
  uploadCrisisId: string,
  file: File,
  checksum: string,
  viaApi: boolean,
): Promise<{ putUrl: string; objectKey: string }> {
  const via = viaApi ? '&viaApi=1' : '';
  return apiGet<{ putUrl: string; objectKey: string }>(
    `/v1/uploads/presign?crisisId=${encodeURIComponent(uploadCrisisId)}&mimeType=${encodeURIComponent(file.type || 'image/jpeg')}&checksumSha256=${checksum}&bytes=${file.size}${via}`,
  );
}

function isDirectR2PutFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes('R2 CORS')) return true;
  if (err.message.includes('Unable to reach upload endpoint')) return true;
  return false;
}

async function putViaPresign(
  uploadCrisisId: string,
  file: File,
  checksum: string,
  viaApi: boolean,
): Promise<{ putUrl: string; objectKey: string }> {
  const presign = await presignUpload(uploadCrisisId, file, checksum, viaApi);
  const mime = file.type || 'image/jpeg';
  await apiPutRaw(presign.putUrl, file, mime, { timeoutMs: SUBMIT_TIMEOUT_MS });
  return presign;
}

async function putUploadFile(
  uploadCrisisId: string,
  file: File,
  checksum: string,
): Promise<{ putUrl: string; objectKey: string }> {
  const tryApiFirst = await shouldTryApiUploadFirst();

  if (tryApiFirst) {
    try {
      const result = await putViaPresign(uploadCrisisId, file, checksum, true);
      return result;
    } catch (apiErr) {
      try {
        const result = await putViaPresign(uploadCrisisId, file, checksum, false);
        clearApiUploadPreference();
        return result;
      } catch {
        throw apiErr;
      }
    }
  }

  try {
    const result = await putViaPresign(uploadCrisisId, file, checksum, false);
    clearApiUploadPreference();
    return result;
  } catch (e) {
    if (!isDirectR2PutFailure(e)) throw e;
    rememberApiUploadPreferred();
    return putViaPresign(uploadCrisisId, file, checksum, true);
  }
}

export async function submitReportOnline(
  crisisId: string,
  payload: Record<string, unknown>,
  file: File,
  opts?: { skipWake?: boolean },
): Promise<SubmitReportResult> {
  if (!opts?.skipWake) {
    const soft = await shouldSoftWakeApi();
    await ensureApiReady(soft ? 30_000 : 90_000, { soft });
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser environment cannot calculate file hashes. Use HTTPS or switch browsers.');
  }
  const checksum = await sha256Hex(file);
  const uploadCrisisId = presignCrisisId(crisisId);
  let presign: { putUrl: string; objectKey: string };
  try {
    presign = await putUploadFile(uploadCrisisId, file, checksum);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Image upload failed') || msg.includes('R2 CORS') || msg.includes('Unable to reach upload endpoint')) {
      throw new Error(
        `${msg} The system already attempted API proxy upload. If it still fails, check network, retry later, or disable strict browser privacy blocking (Brave Shields, Safari cross-site tracking prevention, etc.).`,
      );
    }
    throw new Error(`Image upload failed: ${msg}`);
  }
  const dims = await readImageDims(file);
  try {
    const created = await apiPost<{ possible_duplicate?: boolean }>(
      '/v1/reports',
      {
        ...payload,
        crisis_id: UNSPECIFIED_CRISIS_ID,
        image: {
          objectKey: presign.objectKey,
          mimeType: file.type || 'image/jpeg',
          width: dims?.w,
          height: dims?.h,
          checksumSha256: checksum,
        },
      },
      { timeoutMs: SUBMIT_TIMEOUT_MS },
    );
    return { possible_duplicate: Boolean(created.possible_duplicate) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to create report: ${msg}`);
  }
}

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  await resetStuckSyncing();
  const soft = await shouldSoftWakeApi();
  await ensureApiReady(soft ? 30_000 : 90_000, { soft });
  const items = await listPending();
  let synced = 0;
  let failed = 0;
  for (const item of items.filter((r) => r.status === 'pending' || r.status === 'failed')) {
    try {
      await syncOne(item);
      synced += 1;
    } catch (e) {
      failed += 1;
      await updateStatus(item.id, 'failed', e instanceof Error ? e.message : String(e));
    }
  }
  return { synced, failed };
}

function readImageDims(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
