import { getDeviceId } from './utils/deviceId';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const DEFAULT_TIMEOUT_MS = 12_000;

export function apiBase(): string {
  return API_BASE;
}

function deviceHeaders(extra?: HeadersInit): HeadersInit {
  return {
    'X-Device-Id': getDeviceId(),
    ...extra,
  };
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        'API 請求逾時：請確認後端已啟動（預設 http://127.0.0.1:8000），且 Vite dev server 正在運行。',
      );
    }
    if (e instanceof TypeError) {
      throw new Error('無法連線 API：請確認後端已啟動（uvicorn app.main:app --reload --port 8000）。');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function formatApiError(status: number, text: string): string {
  try {
    const j = JSON.parse(text) as { hint?: string; detail?: string; error?: string };
    if (j.hint) return `${status} — ${j.hint}`;
    if (j.detail && j.detail !== 'Internal Server Error') return `${status} — ${j.detail}`;
    if (j.error) return `${status} — ${j.error}`;
  } catch {
    /* not JSON */
  }
  if (text === 'Internal Server Error' || !text.trim()) {
    return `${status} — 後端錯誤（常為 DATABASE_URL 未設定或資料庫未連線）。請看終端機 uvicorn 日誌。`;
  }
  return `${status} ${text}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, text));
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchApi(path, { headers: deviceHeaders() });
  return parseJson<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchApi(path, {
    method: 'POST',
    headers: deviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchApi(path, {
    method: 'PATCH',
    headers: deviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<T>(res);
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetchApi(path, {
    method: 'DELETE',
    headers: deviceHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
}

function resolveUploadPutUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/v1/uploads/receive/')) {
      return `${API_BASE}${u.pathname}`;
    }
  } catch {
    if (url.startsWith('/v1/uploads/receive/')) {
      return `${API_BASE}${url}`;
    }
  }
  return url;
}

export async function apiPutRaw(url: string, body: Blob, contentType: string): Promise<void> {
  const target = resolveUploadPutUrl(url);
  let res: Response;
  try {
    res = await fetch(target, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    });
  } catch (e) {
    if (e instanceof TypeError) {
      if (url.includes('r2.cloudflarestorage.com')) {
        throw new Error(
          '圖片上傳失敗（R2 跨域）：請在 R2 bucket 設定 CORS，或將 UPLOAD_VIA_API=true 並用 localhost 作為 PUBLIC_BASE_URL。',
        );
      }
      throw new Error('圖片上傳失敗：無法連到上傳端點，請確認後端已啟動。');
    }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
