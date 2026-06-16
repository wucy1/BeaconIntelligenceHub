import { apiFetch, apiUrl, formatApiError } from '../api';
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
  return apiFetch(path, {
    ...init,
    headers: opsHeaders(init?.headers),
  });
}

async function parseOpsJson<T>(res: Response, path: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatApiError(res.status, text));
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(
      `API returned HTML instead of JSON. Request URL: ${apiUrl(path)}; ` +
        'set VITE_API_BASE in Cloudflare Build or clear cache and retry.',
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse API response: ${text.slice(0, 80)}...`);
  }
}

export async function opsGet<T>(path: string): Promise<T> {
  const res = await opsFetch(path);
  return parseOpsJson<T>(res, path);
}

export async function opsPost<T>(path: string, body: unknown): Promise<T> {
  const res = await opsFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseOpsJson<T>(res, path);
}

export async function opsPostFile<T>(
  path: string,
  file: File,
  fields?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      form.append(k, v);
    }
  }
  const res = await opsFetch(path, { method: 'POST', body: form });
  return parseOpsJson<T>(res, path);
}

export async function opsPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await opsFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseOpsJson<T>(res, path);
}

export async function opsDelete(path: string): Promise<void> {
  const res = await opsFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, text));
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
  is_system?: boolean;
  archive_status: 'draft' | 'active' | 'archived';
  archive_window_start: string | null;
  archive_window_end: string | null;
  created_at: string | null;
};

export type OpsReport = {
  id: string;
  crisis_id: string;
  building_id: string | null;
  building_name?: string | null;
  damage_level: string;
  site_status: string;
  captured_at_client: string;
  received_at_server: string;
  geom: GeoJSON.Point | null;
  description_preview: string;
  admin_reviewed: boolean;
  admin_flagged: boolean;
  /** crisis 視角：linked=已歸檔至此危機，candidate=分區內待歸檔 */
  crisis_link_status?: 'linked' | 'candidate' | 'other_linked' | null;
};

export type ArchivePreview = {
  crisis_id: string;
  matched_count: number;
  unlinked_count: number;
  linked_in_scope_count: number;
  sample_report_ids: string[];
  sample_unlink_report_ids: string[];
  already_linked_count: number;
  archive_window_start: string | null;
  archive_window_end: string | null;
  zone_ids: string[] | null;
  zone_count?: number;
};

export type OpsZoneSnapshot = {
  zone_id: string | null;
  name: string;
  geom: GeoJSON.Polygon;
};

export type OpsSavedReport = {
  id: string;
  name: string;
  created_by: string | null;
  creator_email?: string | null;
  report_view: 'crisis' | 'unspecified' | 'all';
  crisis_id: string | null;
  zone_id: string | null;
  browse_from: string | null;
  browse_to: string | null;
  review_filter: 'all' | 'pending' | 'flagged' | 'reviewed';
  snapshot_total: number | null;
  snapshot_linked: number | null;
  snapshot_candidate: number | null;
  zone_snapshots: OpsZoneSnapshot[] | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OpsArchiveSummary = {
  crisis_id: string;
  archive_status: string;
  archive_window_start: string | null;
  archive_window_end: string | null;
  zone_count: number;
  linked_total: number;
  linked_auto: number;
  linked_manual: number;
  candidate_count: number;
  last_manual_archive_at: string | null;
  last_manual_archive_actor: string | null;
  last_manual_archive_detail: {
    linked_count?: number;
    unlinked_count?: number;
  } | null;
};

export type ArchiveRunResult = {
  ok: boolean;
  linked_count: number;
  unlinked_count: number;
  crisis_id: string;
  unlink_out_of_scope?: boolean;
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
    crisis_id?: string | null;
    crisis_slug?: string | null;
    crisis_name?: Record<string, string> | null;
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
