import { apiBase } from '../api';
import { getOpsToken } from './opsAuth';

function opsHeaders(extra?: HeadersInit): HeadersInit {
  const token = getOpsToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (extra) {
    Object.assign(h, extra as Record<string, string>);
  }
  return h;
}

async function opsFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = apiBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: opsHeaders(init?.headers),
  });
  return res;
}

async function parseOpsJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} — ${detail}`);
  }
  return JSON.parse(text) as T;
}

export async function opsGet<T>(path: string): Promise<T> {
  const res = await opsFetch(path);
  return parseOpsJson<T>(res);
}

export async function opsPost<T>(path: string, body: unknown): Promise<T> {
  const res = await opsFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseOpsJson<T>(res);
}

export async function opsPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await opsFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseOpsJson<T>(res);
}

export async function opsDelete(path: string): Promise<void> {
  const res = await opsFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
}

export type OpsZone = {
  id: string;
  name: string;
  description: string | null;
  parent_zone_id: string | null;
  geom: GeoJSON.Polygon;
  created_at: string | null;
  updated_at: string | null;
};
