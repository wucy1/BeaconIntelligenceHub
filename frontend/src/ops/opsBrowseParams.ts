import type { OpsCrisis } from './opsApi';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from './polygonUtils';

export type OpsReportView = 'crisis' | 'unspecified' | 'all';

export type OpsBrowseParams = {
  view: OpsReportView;
  crisisId: string;
  zoneId: string;
  browseFrom: string;
  browseTo: string;
};

export function rollingBrowseRange(defaultOpsMonths: number): {
  browseFrom: string;
  browseTo: string;
} {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - defaultOpsMonths);
  return {
    browseFrom: toDatetimeLocalValue(start.toISOString()),
    browseTo: toDatetimeLocalValue(end.toISOString()),
  };
}

export function defaultBrowseRange(
  _crisis: OpsCrisis | null | undefined,
  defaultOpsMonths: number,
): { browseFrom: string; browseTo: string } {
  return rollingBrowseRange(defaultOpsMonths);
}

export function eventArchiveRange(crisis: OpsCrisis | null | undefined): {
  archiveFrom: string;
  archiveTo: string;
} {
  return {
    archiveFrom: toDatetimeLocalValue(crisis?.archive_window_start),
    archiveTo: toDatetimeLocalValue(crisis?.archive_window_end),
  };
}

export function parseOpsBrowseSearchParams(search: URLSearchParams): Partial<OpsBrowseParams> & {
  reportId?: string;
  lat?: string;
  lng?: string;
} {
  const view = search.get('view');
  const out: Partial<OpsBrowseParams> & { reportId?: string; lat?: string; lng?: string } = {};
  if (view === 'crisis' || view === 'unspecified' || view === 'all') out.view = view;
  else out.view = 'all';
  const crisisId = search.get('crisis_id');
  if (crisisId) out.crisisId = crisisId;
  const zoneId = search.get('zone_id');
  if (zoneId) out.zoneId = zoneId;
  const browseFrom = search.get('browse_from');
  if (browseFrom) out.browseFrom = isoToDatetimeLocal(browseFrom);
  const browseTo = search.get('browse_to');
  if (browseTo) out.browseTo = isoToDatetimeLocal(browseTo);
  const reportId = search.get('report_id');
  if (reportId) out.reportId = reportId;
  const lat = search.get('lat');
  const lng = search.get('lng');
  if (lat) out.lat = lat;
  if (lng) out.lng = lng;
  return out;
}

function isoToDatetimeLocal(iso: string): string {
  try {
    return toDatetimeLocalValue(iso.includes('T') ? iso : `${iso}T00:00:00`);
  } catch {
    return '';
  }
}

export function browseRangeToApi(fromLocal: string, toLocal: string): {
  captured_from: string | null;
  captured_to: string | null;
} {
  return {
    captured_from: fromDatetimeLocalValue(fromLocal) || null,
    captured_to: fromDatetimeLocalValue(toLocal) || null,
  };
}

export function applyBrowseToSearchParams(
  base: URLSearchParams,
  p: OpsBrowseParams,
): URLSearchParams {
  const next = new URLSearchParams(base);
  next.set('view', p.view);
  if (p.crisisId && p.view === 'crisis') next.set('crisis_id', p.crisisId);
  else next.delete('crisis_id');
  if (p.zoneId) next.set('zone_id', p.zoneId);
  else next.delete('zone_id');
  const fromIso = fromDatetimeLocalValue(p.browseFrom);
  const toIso = fromDatetimeLocalValue(p.browseTo);
  if (fromIso) next.set('browse_from', fromIso);
  else next.delete('browse_from');
  if (toIso) next.set('browse_to', toIso);
  else next.delete('browse_to');
  return next;
}

export function buildOpsMapHref(p: OpsBrowseParams, extra?: Record<string, string>): string {
  const q = applyBrowseToSearchParams(new URLSearchParams(), p);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
  }
  const s = q.toString();
  return s ? `/ops/map?${s}` : '/ops/map';
}

export function buildDashboardHref(p: OpsBrowseParams): string {
  const q = applyBrowseToSearchParams(new URLSearchParams(), p);
  const s = q.toString();
  return s ? `/dashboard?${s}` : '/dashboard';
}

export function captureRangeForOpsMap(
  shellMode: 'work' | 'view',
  crisis: OpsCrisis | null | undefined,
  browseFrom: string,
  browseTo: string,
): { captured_from: string | null; captured_to: string | null } {
  if (shellMode === 'work') {
    if (crisis?.archive_window_start) {
      return {
        captured_from: crisis.archive_window_start,
        captured_to: crisis.archive_window_end,
      };
    }
    return browseRangeToApi(browseFrom, browseTo);
  }
  return browseRangeToApi(browseFrom, browseTo);
}

export function officialTimesDifferFromBrowse(
  browseFrom: string,
  browseTo: string,
  officialFrom: string,
  officialTo: string,
): boolean {
  return browseFrom !== officialFrom || browseTo !== officialTo;
}

export function savedReportToBrowseParams(
  saved: {
    report_view: OpsReportView;
    crisis_id: string | null;
    zone_id: string | null;
    browse_from: string | null;
    browse_to: string | null;
  },
): OpsBrowseParams {
  return {
    view: saved.report_view,
    crisisId: saved.crisis_id ?? '',
    zoneId: saved.zone_id ?? '',
    browseFrom: saved.browse_from ? isoToDatetimeLocal(saved.browse_from) : '',
    browseTo: saved.browse_to ? isoToDatetimeLocal(saved.browse_to) : '',
  };
}
