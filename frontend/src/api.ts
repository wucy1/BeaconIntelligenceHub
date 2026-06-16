import { getDeviceId } from './utils/deviceId';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const API_FALLBACK_BASE = import.meta.env.VITE_API_FALLBACK ?? 'https://beaconintelligencehub.onrender.com';
const DEFAULT_TIMEOUT_MS = 45_000;
const SUBMIT_TIMEOUT_MS = 90_000;
/** GeoJSON footprint requests can be large on cold start. */
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

/** Production static host must not call /v1 on the SPA origin (Worker returns index.html). */
function remoteApiBase(): string {
  if (typeof window === 'undefined') {
    return API_BASE || API_FALLBACK_BASE;
  }
  if (API_BASE) {
    try {
      const configured = new URL(API_BASE, window.location.origin);
      if (configured.origin !== window.location.origin) {
        return configured.origin + configured.pathname.replace(/\/$/, '');
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  return API_FALLBACK_BASE;
}

export function resolveApiBase(path: string): string {
  if (path.startsWith('http')) return '';
  if (isLocalDevHost()) {
    return API_BASE || '';
  }
  if (path.startsWith('/v1/') || path.startsWith('/health')) {
    return remoteApiBase();
  }
  return '';
}

export function apiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${resolveApiBase(path)}${path}`;
}

export function effectiveApiRoot(): string {
  return resolveApiBase('/v1/health') || '(site /v1 via local dev proxy)';
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
    return 'Cannot reach local API. Confirm uvicorn is running on port 8000.';
  }
  return (
    'Backend is temporarily unreachable (Render cold start may take 30–60s). ' +
    'The app retries automatically; if it still fails, try reconnect shortly.'
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

/** Fetch with auto-retry for cold starts and 503s. */
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
    throw new Error(`API request timed out (${timeoutMs / 1000}s). ${connectionErrorMessage()}`);
  }
  if (lastError instanceof TypeError || lastError instanceof DOMException) {
    throw new Error(`${connectionErrorMessage()}`);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Wake backend proactively before ops workflows. */
export async function wakeApiBackend(): Promise<boolean> {
  return probeApiReady();
}

function wakeProbeBase(): string {
  return remoteApiBase().replace(/\/$/, '');
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

/** Wait until API + Neon are ready before submit/sync. */
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
    'Backend is still waking up (Render + Neon may take 1–2 minutes). Please retry sync/reconnect shortly.',
  );
}

export function formatApiError(status: number, text: string): string {
  if (status === 503 && !text.trim()) {
    return 'Backend is temporarily unavailable (possibly waking up or DB disconnected). Please retry shortly.';
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
    return `${status} — Backend error. Check Render logs for details.`;
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
    const base = API_BASE || API_FALLBACK_BASE || '(VITE_API_BASE not set)';
    throw new Error(
      `API returned HTML instead of JSON. Verify VITE_API_BASE=${base}, then clear browser cache and retry.`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unable to parse API response: ${text.slice(0, 80)}…`);
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
    throw new Error(`Image upload timed out (${timeoutMs / 1000}s). ${connectionErrorMessage()}`);
  }
  if (lastError instanceof TypeError) {
    if (target.includes('r2.cloudflarestorage.com')) {
      throw new Error(
        'Image upload failed (R2 CORS). Allow this site origin for PUT/GET in the R2 bucket, or set UPLOAD_VIA_API=true.',
      );
    }
    throw new Error(`Image upload failed: unable to reach upload endpoint. ${connectionErrorMessage()}`);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
