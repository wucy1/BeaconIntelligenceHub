import { getDeviceId } from './utils/deviceId';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const API_FALLBACK_BASE = import.meta.env.VITE_API_FALLBACK ?? 'https://beaconintelligencehub.onrender.com';
const DEFAULT_TIMEOUT_MS = 45_000;
const SUBMIT_TIMEOUT_MS = 90_000;
/** GeoJSON footprint 單次請求可能較大（冷啟動 + 數百棟多邊形） */
export const BUILDINGS_FETCH_TIMEOUT_MS = 120_000;
const WAKE_PROBE_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const PROD_RETRY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2000;

export function apiBase(): string {
  return API_BASE;
}

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function shouldUseFallbackBase(): boolean {
  if (API_BASE) return false;
  if (typeof window === 'undefined') return false;
  return !isLocalDevHost();
}

export function resolveApiBase(path: string): string {
  if (path.startsWith('http')) return '';
  if (API_BASE) return API_BASE;
  if (shouldUseFallbackBase() && path.startsWith('/v1/')) return API_FALLBACK_BASE;
  return '';
}

export function apiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${resolveApiBase(path)}${path}`;
}

export function effectiveApiRoot(): string {
  return resolveApiBase('/v1/health') || '(本站 /v1，僅本機 dev proxy)';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deviceHeaders(extra?: HeadersInit): HeadersInit {
  return {
    'X-Device-Id': getDeviceId(),
    ...extra,
  };
}

function isTransientFetchError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  return false;
}

function connectionErrorMessage(): string {
  if (isLocalDevHost()) {
    return '無法連線本機 API，請確認 uvicorn 已啟動（port 8000）。';
  }
  return (
    '後端暫時無法連線（Render 冷啟動常需 30–60 秒）。' +
    ' 系統會自動重試；若仍失敗請稍後再按「重新連線」。'
  );
}

async function fetchOnce(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 帶自動重試的 fetch（Render 冷啟動／503 時重試） */
export async function apiFetch(
  path: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; maxAttempts?: number },
): Promise<Response> {
  const url = apiUrl(path);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = opts?.maxAttempts ?? (isLocalDevHost() ? 1 : PROD_RETRY_ATTEMPTS);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
    try {
      const res = await fetchOnce(url, init, timeoutMs);
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
        await res.text().catch(() => undefined);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1 && isTransientFetchError(e)) continue;
      break;
    }
  }

  if (lastError instanceof DOMException && lastError.name === 'AbortError') {
    throw new Error(`API 請求逾時（${timeoutMs / 1000}s）。${connectionErrorMessage()}`);
  }
  if (lastError instanceof TypeError || lastError instanceof DOMException) {
    throw new Error(`${connectionErrorMessage()}`);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 喚醒 Render 後端（進入營運台時可先呼叫） */
export async function wakeApiBackend(): Promise<boolean> {
  return probeApiReady();
}

function wakeProbeBase(): string {
  return (resolveApiBase('/health/ready') || API_FALLBACK_BASE).replace(/\/$/, '');
}

async function probeApiReady(): Promise<boolean> {
  const base = wakeProbeBase();
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAKE_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/health/ready`, {
      headers: deviceHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 提交回報／同步佇列前：等待 API + Neon 就緒（冷啟動可能需 1–2 分鐘） */
export async function ensureApiReady(
  timeoutMs = 90_000,
  opts?: { soft?: boolean },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 2000;
  while (Date.now() < deadline) {
    if (await probeApiReady()) return;
    await sleep(delay);
    delay = Math.min(delay + 1000, 8000);
  }
  if (opts?.soft) return;
  throw new Error(
    '後端尚在喚醒中（Render + Neon 常需 1–2 分鐘）。請稍後再按「立即同步」或「重新連線」。',
  );
}

export function formatApiError(status: number, text: string): string {
  if (status === 503 && !text.trim()) {
    return '後端暫時無法服務（可能正在喚醒或資料庫未連線），請稍後重試。';
  }
  try {
    const j = JSON.parse(text) as { hint?: string; detail?: string; error?: string };
    if (j.hint) return `${status} — ${j.hint}`;
    if (j.detail && j.detail !== 'Internal Server Error') return `${status} — ${j.detail}`;
    if (j.error) return `${status} — ${j.error}`;
  } catch {
    /* not JSON */
  }
  if (text === 'Internal Server Error' || !text.trim()) {
    return `${status} — 後端錯誤，請至 Render Logs 查看。`;
  }
  return `${status} ${text}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatApiError(res.status, text));
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json') && text.trimStart().startsWith('<')) {
    const base = API_BASE || API_FALLBACK_BASE || '(未設定 VITE_API_BASE)';
    throw new Error(
      `API 回傳 HTML 而非 JSON。請確認 VITE_API_BASE=${base}，並清除瀏覽器快取後重試。`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`無法解析 API 回應：${text.slice(0, 80)}…`);
  }
}

async function fetchApi(
  path: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; maxAttempts?: number },
): Promise<Response> {
  return apiFetch(path, init, opts);
}

export async function apiGet<T>(
  path: string,
  opts?: { timeoutMs?: number; maxAttempts?: number },
): Promise<T> {
  const res = await fetchApi(path, { headers: deviceHeaders() }, opts);
  return parseJson<T>(res);
}

export async function apiPost<T>(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<T> {
  const res = await fetchApi(
    path,
    {
      method: 'POST',
      headers: deviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    opts,
  );
  return parseJson<T>(res);
}

export { SUBMIT_TIMEOUT_MS };

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
    throw new Error(formatApiError(res.status, text));
  }
}

function resolveUploadPutUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/v1/uploads/receive/')) {
      const apiRoot = resolveApiBase('/v1/uploads/receive/x');
      if (apiRoot) return `${apiRoot.replace(/\/$/, '')}${u.pathname}`;
      return u.href;
    }
  } catch {
    if (url.startsWith('/v1/uploads/receive/')) {
      const apiRoot = resolveApiBase(url);
      return apiRoot ? `${apiRoot.replace(/\/$/, '')}${url}` : url;
    }
  }
  return url;
}

export async function apiPutRaw(
  url: string,
  body: Blob,
  contentType: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const target = resolveUploadPutUrl(url);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = isLocalDevHost() ? 1 : PROD_RETRY_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
    try {
      const res = await fetchOnce(
        target,
        {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body,
        },
        timeoutMs,
      );
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
        await res.text().catch(() => undefined);
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${text}`);
      }
      return;
    } catch (e) {
      lastError = e;
      if (e instanceof Error && /^\d{3} /.test(e.message)) throw e;
      if (attempt < maxAttempts - 1 && isTransientFetchError(e)) continue;
      break;
    }
  }

  if (lastError instanceof DOMException && lastError.name === 'AbortError') {
    throw new Error(`圖片上傳逾時（${timeoutMs / 1000}s）。${connectionErrorMessage()}`);
  }
  if (lastError instanceof TypeError) {
    if (target.includes('r2.cloudflarestorage.com')) {
      throw new Error(
        '圖片上傳失敗（R2 CORS）。請在 R2 bucket 設定允許本站網域 PUT/GET，或暫改 UPLOAD_VIA_API=true。',
      );
    }
    throw new Error(`圖片上傳失敗：無法連到上傳端點。${connectionErrorMessage()}`);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
