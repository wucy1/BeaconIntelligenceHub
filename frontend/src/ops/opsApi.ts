import { apiUrl } from '../api';
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
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: opsHeaders(init?.headers),
  });
  return res;
}

function formatOpsError(status: number, text: string): string {
  try {
    const j = JSON.parse(text) as { detail?: string | Array<{ msg?: string }>; hint?: string };
    if (j.hint) return `${status} — ${j.hint}`;
    if (typeof j.detail === 'string' && j.detail) return `${status} — ${j.detail}`;
    if (Array.isArray(j.detail)) {
      const msg = j.detail.map((d) => d.msg).filter(Boolean).join('；');
      if (msg) return `${status} — ${msg}`;
    }
  } catch {
    /* not JSON */
  }
  if (text === 'Internal Server Error' || !text.trim()) {
    return `${status} — 後端錯誤（請確認資料庫 migration 已執行，含 007 ops_audit_log）`;
  }
  return `${status} ${text}`;
}

async function parseOpsJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatOpsError(res.status, text));
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
  crisis_id: string | null;
  name: string;
  description: string | null;
  parent_zone_id: string | null;
  geom: GeoJSON.Polygon;
  created_at: string | null;
  updated_at: string | null;
};

export type OpsCrisis = {
  id: string;
  slug: string;
  name: Record<string, string>;
  archive_status: 'draft' | 'active' | 'archived';
  archive_window_start: string | null;
  archive_window_end: string | null;
  created_at: string | null;
};

export type OpsReport = {
  id: string;
  crisis_id: string;
  building_id: string | null;
  damage_level: string;
  site_status: string;
  captured_at_client: string;
  received_at_server: string;
  geom: GeoJSON.Point | null;
  description_preview: string;
  admin_reviewed: boolean;
  admin_flagged: boolean;
};

export type ArchivePreview = {
  crisis_id: string;
  matched_count: number;
  sample_report_ids: string[];
  already_linked_count: number;
  archive_window_start: string | null;
  archive_window_end: string | null;
  zone_ids: string[] | null;
};

export type OpsUserRecord = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'coordinator' | 'system_admin';
  is_active: boolean;
  created_at: string | null;
  zone_assignments: Array<{
    zone_id: string;
    zone_name?: string;
    assignment_role: 'lead' | 'coordinator';
  }>;
  crisis_lead_assignments: Array<{
    crisis_id: string;
    crisis_slug?: string;
    crisis_name?: Record<string, string>;
  }>;
};

export type AuditEntry = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at: string | null;
};
