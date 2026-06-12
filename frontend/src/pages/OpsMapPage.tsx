import L from 'leaflet';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isManageableCrisis } from '../ops/crisisUtils';
import { CircleMarker, GeoJSON, MapContainer, useMap } from 'react-leaflet';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import {
  applyBrowseToSearchParams,
  defaultBrowseRange,
  eventArchiveRange,
  officialTimesDifferFromBrowse,
  parseOpsBrowseSearchParams,
  type OpsBrowseParams,
} from '../ops/opsBrowseParams';

import 'leaflet/dist/leaflet.css';

import { apiGet, wakeApiBackend } from '../api';
import {
  opsDelete,
  opsGet,
  opsPatch,
  opsPost,
  type ArchivePreview,
  type ArchiveRunResult,
  type AuditEntry,
  type OpsCrisis,
  type OpsReport,
  type OpsZone,
} from '../ops/opsApi';
import {
  getOpsToken,
  getOpsUser,
  opsCanCreateZones,
  opsCanEditZone,
  opsCanBrowseWideViews,
  opsCanRunArchive,
  opsCanUseWorkMode,
  opsIsSystemAdmin,
  setOpsSession,
  type OpsUserSession,
} from '../ops/opsAuth';
import { BihLogo } from '../components/BihLogo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { OpsUserMenu } from '../components/OpsUserMenu';
import { applyOpsProfileLocaleIfSet } from '../ops/applyOpsLocale';
import { OsmTileLayer } from '../components/map/CachedOsmTileLayer';
import { MapRailZoom } from '../components/map/MapRailZoom';
import { OpsMapClearSelection } from '../components/ops/OpsMapClearSelection';
import { OpsMapShellToggle, type OpsMapShellMode } from '../components/ops/OpsMapShellToggle';
import { OpsPolygonEditor } from '../components/ops/OpsPolygonEditor';
import { useI18n } from '../i18n/I18nContext';
import {
  formatArea,
  fromDatetimeLocalValue,
  polygonAreaKm2,
  polygonToVertices,
  verticesToPolygon,
  type LatLng,
} from '../ops/polygonUtils';

L.Icon.Default.mergeOptions({ iconRetinaUrl: iconRetina, iconUrl, shadowUrl: iconShadow });

const DEFAULT_CENTER: [number, number] = [25.03, 121.56];
const DEFAULT_ZOOM = 11;

const DAMAGE_COLOR: Record<string, string> = {
  minimal: '#16a34a',
  partial: '#ea580c',
  complete: '#dc2626',
};

function formatPanelTime(value: string): string {
  if (!value) return '—';
  const iso = fromDatetimeLocalValue(value);
  if (!iso) return value;
  return new Date(iso).toLocaleString();
}

function formatIsoTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

type MapMode = 'browse' | 'draw' | 'edit';
type PanelKey = 'zone' | 'crisis' | 'audit' | null;

function FlyToZone({ zone }: { zone: OpsZone | null }) {
  const map = useMap();
  useEffect(() => {
    if (!zone) return;
    const bounds = L.latLngBounds([]);
    zone.geom.coordinates[0].forEach(([lng, lat]) => bounds.extend([lat, lng]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [map, zone]);
  return null;
}

function FlyToPoint({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.flyTo(point, 16, { duration: 0.8 });
  }, [map, point]);
  return null;
}

function FitVisibleZones({ zones, tick }: { zones: OpsZone[]; tick: number }) {
  const map = useMap();
  useEffect(() => {
    if (!tick || zones.length === 0) return;
    const bounds = L.latLngBounds([]);
    for (const z of zones) {
      z.geom.coordinates[0].forEach(([lng, lat]) => bounds.extend([lat, lng]));
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [map, zones, tick]);
  return null;
}

export function OpsMapPage() {
  const { t, crisisName, setLocale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlBrowse = parseOpsBrowseSearchParams(searchParams);
  const crisisFromUrl = urlBrowse.crisisId ?? searchParams.get('crisis_id') ?? '';
  const shellFromUrl = searchParams.get('shell');
  const reportFromUrl = urlBrowse.reportId ?? searchParams.get('report_id');
  const latFromUrl = urlBrowse.lat ?? searchParams.get('lat');
  const lngFromUrl = urlBrowse.lng ?? searchParams.get('lng');
  const [user, setUser] = useState<OpsUserSession | null>(() => getOpsUser());
  const isAdmin = opsIsSystemAdmin(user);
  const canUseWorkMode = opsCanUseWorkMode(user);
  const canBrowseWideViews = opsCanBrowseWideViews(user);
  const [activeCrisisId, setActiveCrisisId] = useState<string>(crisisFromUrl);
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [crisisLinkedCount, setCrisisLinkedCount] = useState(0);
  const [crisisCandidateCount, setCrisisCandidateCount] = useState(0);
  const [crisisOtherLinkedCount, setCrisisOtherLinkedCount] = useState(0);
  const [viewHelpOpen, setViewHelpOpen] = useState(false);
  const [workHelpOpen, setWorkHelpOpen] = useState(false);
  const viewHelpRef = useRef<HTMLDivElement>(null);
  const workHelpRef = useRef<HTMLDivElement>(null);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(urlBrowse.zoneId || null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [mapMode, setMapMode] = useState<MapMode>('browse');

  const [zoneName, setZoneName] = useState('');
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [closed, setClosed] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const [browseFrom, setBrowseFrom] = useState(urlBrowse.browseFrom ?? '');
  const [browseTo, setBrowseTo] = useState(urlBrowse.browseTo ?? '');
  const [shellMode, setShellMode] = useState<OpsMapShellMode>(() => {
    if (!opsCanUseWorkMode(getOpsUser())) return 'view';
    return shellFromUrl === 'view' ? 'view' : 'work';
  });
  const [reportView, setReportView] = useState<'crisis' | 'unspecified' | 'all'>(() => {
    const fromUrl = urlBrowse.view ?? 'all';
    if (!opsCanBrowseWideViews(getOpsUser()) && fromUrl !== 'crisis') return 'crisis';
    return fromUrl;
  });
  const effectiveReportView = shellMode === 'work' ? 'all' : reportView;
  const [unlinkOutOfScope, setUnlinkOutOfScope] = useState(true);
  const [draftWindowOpen, setDraftWindowOpen] = useState(false);
  const [draftWindowStart, setDraftWindowStart] = useState('');
  const [draftWindowEnd, setDraftWindowEnd] = useState('');
  const [saveReportOpen, setSaveReportOpen] = useState(false);
  const [saveReportName, setSaveReportName] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flyZone, setFlyZone] = useState<OpsZone | null>(null);
  const [flyPoint, setFlyPoint] = useState<[number, number] | null>(null);
  const [zonesRevision, setZonesRevision] = useState(0);
  const [zoneFitTick, setZoneFitTick] = useState(0);
  const [defaultOpsMonths, setDefaultOpsMonths] = useState(2);

  const zonesToFit = useMemo(() => zones, [zones]);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const canEditSelectedZone = selectedZone ? opsCanEditZone(user, selectedZone.crisis_id ?? undefined) : false;
  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? null;
  const activeCrisis = crises.find((c) => c.id === activeCrisisId) ?? null;
  const manageableCrises = useMemo(() => crises.filter(isManageableCrisis), [crises]);
  const canCreateZones =
    activeCrisisId && isManageableCrisis(activeCrisis) ? opsCanCreateZones(user, activeCrisisId) : false;
  const canArchive =
    activeCrisisId && isManageableCrisis(activeCrisis) ? opsCanRunArchive(user, activeCrisisId) : false;

  const draftPolygon = useMemo(() => verticesToPolygon(vertices), [vertices]);
  const draftAreaKm2 = useMemo(() => polygonAreaKm2(vertices), [vertices]);
  const isEditingShape = mapMode === 'draw' || mapMode === 'edit';
  const canSaveZone =
    zoneName.trim().length > 0 && vertices.length >= 3 && (mapMode === 'edit' || closed);

  const officialRange = eventArchiveRange(activeCrisis);
  const browseDiffersFromOfficial = officialTimesDifferFromBrowse(
    browseFrom,
    browseTo,
    officialRange.archiveFrom,
    officialRange.archiveTo,
  );
  const archiveNeedsOfficialStart =
    activeCrisis?.archive_status === 'draft' && !activeCrisis.archive_window_start;
  const archiveMissingZones = zones.length === 0;

  useEffect(() => {
    if (!getOpsToken()) return;
    opsGet<{ locale?: string | null }>('/v1/ops/me')
      .then((me) => {
        applyOpsProfileLocaleIfSet(me.locale, setLocale);
      })
      .catch(() => undefined);
  }, [setLocale]);

  useEffect(() => {
    if (!viewHelpOpen && !workHelpOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!viewHelpRef.current?.contains(t)) setViewHelpOpen(false);
      if (!workHelpRef.current?.contains(t)) setWorkHelpOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [viewHelpOpen, workHelpOpen]);

  const loadZones = useCallback(async () => {
    const q = activeCrisisId ? `?crisis_id=${activeCrisisId}` : '';
    try {
      const d = await opsGet<{ items: OpsZone[] }>(`/v1/ops/zones${q}`);
      setZones(d.items);
    } catch {
      setZones([]);
    }
  }, [activeCrisisId]);

  const loadCrises = useCallback(() => {
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        setActiveCrisisId((prev) => {
          if (prev && d.items.some((c) => c.id === prev)) return prev;
          const manageable = d.items.filter(isManageableCrisis);
          if (crisisFromUrl && manageable.some((c) => c.id === crisisFromUrl)) return crisisFromUrl;
          return manageable[0]?.id ?? d.items[0]?.id ?? '';
        });
      })
      .catch(() => setCrises([]));
  }, [crisisFromUrl]);

  const loadAudit = useCallback(() => {
    if (!isAdmin) return;
    opsGet<{ items: AuditEntry[] }>('/v1/ops/audit-log?limit=30')
      .then((d) => setAudit(d.items))
      .catch(() => setAudit([]));
  }, [isAdmin]);

  const loadReports = useCallback(() => {
    const q = new URLSearchParams({ limit: '300', view: effectiveReportView });
    if (activeCrisisId) q.set('crisis_id', activeCrisisId);
    if (shellMode === 'view' && selectedZoneId) q.set('zone_id', selectedZoneId);
    const from = fromDatetimeLocalValue(browseFrom);
    const to = fromDatetimeLocalValue(browseTo);
    if (from) q.set('captured_from', from);
    if (to) q.set('captured_to', to);
    opsGet<{
      items: OpsReport[];
      crisis_linked_count?: number | null;
      crisis_candidate_count?: number | null;
      crisis_other_linked_count?: number | null;
    }>(`/v1/ops/reports?${q}`)
      .then((d) => {
        setReports(d.items);
        setCrisisLinkedCount(d.crisis_linked_count ?? 0);
        setCrisisCandidateCount(d.crisis_candidate_count ?? 0);
        setCrisisOtherLinkedCount(d.crisis_other_linked_count ?? 0);
      })
      .catch(() => {
        setReports([]);
        setCrisisLinkedCount(0);
        setCrisisCandidateCount(0);
        setCrisisOtherLinkedCount(0);
      });
  }, [shellMode, selectedZoneId, browseFrom, browseTo, effectiveReportView, activeCrisisId]);

  useEffect(() => {
    apiGet<{ default_ops_view_months?: number }>('/v1/public/settings')
      .then((s) => {
        if (s.default_ops_view_months) setDefaultOpsMonths(s.default_ops_view_months);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!opsCanUseWorkMode(user)) {
      setShellMode('view');
      setPanel((p) => (p === 'crisis' ? null : p));
      setPreview(null);
    }
    if (!opsCanBrowseWideViews(user)) {
      setReportView((v) => (v === 'crisis' ? v : 'crisis'));
    }
  }, [user]);

  useEffect(() => {
    void wakeApiBackend();
    const token = getOpsToken();
    const current = getOpsUser();
    if (!token || !current) return;
    opsGet<{
      role: OpsUserSession['role'];
      zone_assignments: OpsUserSession['zone_assignments'];
      crisis_lead_assignments: OpsUserSession['crisis_lead_assignments'];
      zone_ids: string[];
    }>('/v1/ops/me')
      .then((me) => {
        const updated: OpsUserSession = {
          ...current,
          role: me.role,
          zone_ids: me.zone_ids,
          zone_assignments: me.zone_assignments,
          crisis_lead_assignments: me.crisis_lead_assignments,
        };
        setOpsSession(token, updated);
        setUser(updated);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadCrises();
  }, [loadCrises]);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (reportFromUrl) setSelectedReportId(reportFromUrl);
    const lat = latFromUrl ? Number(latFromUrl) : NaN;
    const lng = lngFromUrl ? Number(lngFromUrl) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setFlyPoint([lat, lng]);
      const id = window.setTimeout(() => setFlyPoint(null), 200);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [reportFromUrl, latFromUrl, lngFromUrl]);

  useEffect(() => {
    if (browseFrom || browseTo) return;
    const { browseFrom: from, browseTo: to } = defaultBrowseRange(activeCrisis, defaultOpsMonths);
    setBrowseFrom(from);
    setBrowseTo(to);
  }, [activeCrisis?.id, activeCrisis?.archive_window_start, activeCrisis?.archive_window_end, defaultOpsMonths, browseFrom, browseTo]);

  useEffect(() => {
    const browse: OpsBrowseParams = {
      view: effectiveReportView,
      crisisId: activeCrisisId,
      zoneId: shellMode === 'view' ? selectedZoneId ?? '' : '',
      browseFrom,
      browseTo,
    };
    const next = applyBrowseToSearchParams(new URLSearchParams(), browse);
    if (shellMode === 'view') next.set('shell', 'view');
    else next.delete('shell');
    const keep = new URLSearchParams(window.location.search);
    for (const key of ['report_id', 'lat', 'lng'] as const) {
      const v = keep.get(key);
      if (v) next.set(key, v);
      else next.delete(key);
    }
    const cur = new URLSearchParams(window.location.search).toString();
    const nxt = next.toString();
    if (cur !== nxt) setSearchParams(next, { replace: true });
  }, [effectiveReportView, shellMode, activeCrisisId, selectedZoneId, browseFrom, browseTo, setSearchParams]);

  const clearZoneSelection = useCallback(() => {
    setSelectedZoneId(null);
    setFlyZone(null);
    setPanel((p) => (p === 'zone' && mapMode === 'browse' ? null : p));
  }, [mapMode]);

  if (!user) return <Navigate to="/ops/login" replace />;

  const resetDraft = () => {
    setVertices([]);
    setClosed(false);
    setEditingZoneId(null);
    setZoneName('');
    setSelectedVertex(null);
    setMapMode('browse');
  };

  const startDraw = () => {
    if (!activeCrisisId) {
      setErr(crises.length === 0 ? '尚無危機，請至營運控制台建立' : '請先於上方選擇危機');
      return;
    }
    if (!opsCanCreateZones(user, activeCrisisId)) {
      setErr('您無權在此危機畫分區（需為系統管理員或該危機 Lead）');
      return;
    }
    resetDraft();
    setMapMode('draw');
    setPanel('zone');
    setSelectedZoneId(null);
    setErr(null);
  };

  const startEditZone = (zone: OpsZone) => {
    setSelectedZoneId(zone.id);
    setEditingZoneId(zone.id);
    setZoneName(zone.name);
    setVertices(polygonToVertices(zone.geom));
    setClosed(true);
    setSelectedVertex(null);
    setMapMode('edit');
    setPanel('zone');
    setErr(null);
  };

  const removeSelectedVertex = () => {
    if (selectedVertex == null || vertices.length <= 3) return;
    setVertices((prev) => prev.filter((_, i) => i !== selectedVertex));
    setSelectedVertex(null);
  };

  const finishDrawing = () => {
    if (vertices.length < 3) {
      setErr('至少需要 3 個頂點');
      return;
    }
    setClosed(true);
    setErr(null);
  };

  const saveZone = async () => {
    if (!activeCrisisId) {
      setErr('請先選擇危機');
      return;
    }
    if (!zoneName.trim()) {
      setErr('請輸入分區名稱');
      return;
    }
    if (vertices.length < 3) {
      setErr('至少需要 3 個頂點');
      return;
    }
    const polygon = draftPolygon ?? verticesToPolygon(vertices);
    if (!polygon) {
      setErr('多邊形無效');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let saved: OpsZone;
      if (editingZoneId) {
        saved = await opsPatch<OpsZone>(`/v1/ops/zones/${editingZoneId}`, {
          name: zoneName.trim(),
          geom: polygon,
        });
      } else {
        saved = await opsPost<OpsZone>('/v1/ops/zones', {
          crisis_id: activeCrisisId,
          name: zoneName.trim(),
          geom: polygon,
        });
      }
      setZones((prev) => {
        const idx = prev.findIndex((z) => z.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setZonesRevision((n) => n + 1);
      resetDraft();
      setPanel(null);
      await loadZones();
      setZonesRevision((n) => n + 1);
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeZone = async (id: string) => {
    if (!window.confirm('刪除此分區？')) return;
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/zones/${id}`);
      if (selectedZoneId === id) setSelectedZoneId(null);
      loadZones();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const patchReport = async (id: string, reviewed?: boolean, flagged?: boolean) => {
    setBusy(true);
    try {
      await opsPatch(`/v1/ops/reports/${id}`, { reviewed, flagged });
      loadReports();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const initArchivePanel = () => {
    setUnlinkOutOfScope(activeCrisis?.archive_status !== 'draft');
    setPreview(null);
    if (archiveNeedsOfficialStart) {
      setDraftWindowStart('');
      setDraftWindowEnd('');
      setDraftWindowOpen(true);
    }
  };

  const ensureArchiveReady = (): boolean => {
    if (archiveMissingZones) {
      setErr(t('ops.map.archiveNoZones'));
      return false;
    }
    if (archiveNeedsOfficialStart) {
      setDraftWindowOpen(true);
      return false;
    }
    return true;
  };

  const saveDraftOfficialWindow = async () => {
    if (!activeCrisisId || !draftWindowStart.trim()) {
      setErr(t('ops.map.draftWindowStartRequired'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const updated = await opsPatch<OpsCrisis>(`/v1/ops/crises/${activeCrisisId}`, {
        archive_window_start: fromDatetimeLocalValue(draftWindowStart) || null,
        archive_window_end: fromDatetimeLocalValue(draftWindowEnd) || null,
      });
      setCrises((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setDraftWindowOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNamedReport = async () => {
    const name = saveReportName.trim();
    if (!name) {
      setErr(t('ops.map.saveReportNameRequired'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const zoneSnapshots =
        selectedZoneId && selectedZone
          ? [
              {
                zone_id: selectedZone.id,
                name: selectedZone.name,
                geom: selectedZone.geom,
              },
            ]
          : zones.map((z) => ({
              zone_id: z.id,
              name: z.name,
              geom: z.geom,
            }));
      await opsPost('/v1/ops/saved-reports', {
        name,
        report_view: reportView,
        crisis_id: reportView === 'crisis' ? activeCrisisId || null : null,
        zone_id: selectedZoneId,
        browse_from: fromDatetimeLocalValue(browseFrom) || null,
        browse_to: fromDatetimeLocalValue(browseTo) || null,
        review_filter: 'all',
        snapshot_total: reports.length,
        snapshot_linked: crisisLinkedCount,
        snapshot_candidate: crisisCandidateCount,
        zone_snapshots: zoneSnapshots,
      });
      setSaveReportOpen(false);
      setSaveReportName('');
      alert(t('ops.map.saveReportDone'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runArchivePreview = async () => {
    if (!activeCrisisId || !ensureArchiveReady()) return;
    setBusy(true);
    try {
      const body = {
        limit: 500,
        unlink_out_of_scope: unlinkOutOfScope,
      };
      const p = await opsPost<ArchivePreview>(`/v1/ops/crises/${activeCrisisId}/archive-preview`, body);
      setPreview(p);
      setPanel('crisis');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runArchive = async () => {
    if (!activeCrisisId || !ensureArchiveReady()) return;
    const confirmKey = unlinkOutOfScope ? 'ops.map.archiveConfirmFull' : 'ops.map.archiveConfirmLinkOnly';
    if (!window.confirm(t(confirmKey))) return;
    setBusy(true);
    try {
      const body = {
        limit: 500,
        unlink_out_of_scope: unlinkOutOfScope,
      };
      const r = await opsPost<ArchiveRunResult>(`/v1/ops/crises/${activeCrisisId}/archive-run`, body);
      setPreview(null);
      loadCrises();
      loadReports();
      loadAudit();
      setErr(null);
      const noChange = r.linked_count === 0 && r.unlinked_count === 0;
      alert(
        t('ops.map.archiveDone', {
          linked: r.linked_count,
          unlinked: r.unlinked_count,
          hint: noChange ? t('ops.map.archiveDoneZeroHint') : '',
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePanel = (key: PanelKey) => {
    if (key === 'crisis' && panel !== 'crisis') initArchivePanel();
    setPanel((p) => (p === key ? null : key));
    if (key === 'audit') loadAudit();
  };

  const onShellModeChange = (next: OpsMapShellMode) => {
    if (next === 'work' && !canUseWorkMode) return;
    if (next === 'view') {
      setPanel((p) => (p === 'crisis' ? null : p));
      setPreview(null);
      if (mapMode === 'draw' || mapMode === 'edit') resetDraft();
    } else {
      setSelectedZoneId(null);
      setSaveReportOpen(false);
      setViewHelpOpen(false);
    }
    setShellMode(next);
  };

  return (
    <div className={`map-page ops-map-page ops-shell-${shellMode}`}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        className="contributor-map"
        style={{ cursor: mapMode === 'draw' || mapMode === 'edit' ? 'crosshair' : undefined }}
      >
        <OsmTileLayer />
        <MapRailZoom />
        <OpsMapClearSelection enabled={mapMode === 'browse' && Boolean(selectedZoneId)} onClear={clearZoneSelection} />
        <FlyToZone zone={flyZone} />
        <FlyToPoint point={flyPoint} />
        <FitVisibleZones zones={zonesToFit} tick={zoneFitTick} />
        {isEditingShape && (mapMode === 'draw' ? canCreateZones : editingZoneId != null) && (
          <OpsPolygonEditor
            vertices={vertices}
            closed={closed || mapMode === 'edit'}
            selectedVertex={selectedVertex}
            onVerticesChange={(next) => {
              setVertices(next);
              if (mapMode === 'draw') setClosed(false);
            }}
            onSelectVertex={setSelectedVertex}
            allowMapAdd={mapMode === 'draw' && !closed}
            allowEdgeInsert={mapMode === 'edit' || (mapMode === 'draw' && closed)}
          />
        )}

        {zones.map((z) => {
          if (editingZoneId === z.id) return null;
          const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
            type: 'Feature',
            properties: { name: z.name },
            geometry: z.geom,
          };
          const selected = z.id === selectedZoneId;
          return (
            <GeoJSON
              key={`${z.id}-${zonesRevision}-${selectedZoneId ?? ''}-${z.updated_at ?? ''}`}
              data={feature}
              style={{
                color: selected ? '#0d47a1' : '#b91c1c',
                weight: selected ? 3 : 2,
                fillOpacity: selected ? 0.2 : 0.1,
              }}
              onEachFeature={(_f, layer) => {
                const path = layer as L.Path;
                path.options.interactive = mapMode === 'browse';
                layer.off('click');
                if (mapMode !== 'browse') return;
                layer.on('click', (ev) => {
                  L.DomEvent.stopPropagation(ev);
                  setSelectedReportId(null);
                  if (selectedZoneId === z.id) {
                    clearZoneSelection();
                    return;
                  }
                  setSelectedZoneId(z.id);
                  setPanel('zone');
                  setFlyZone(z);
                  setTimeout(() => setFlyZone(null), 100);
                });
              }}
            />
          );
        })}

        {reports.map((r) => {
          if (!r.geom) return null;
          const [lng, lat] = r.geom.coordinates;
          const isCandidate = r.crisis_link_status === 'candidate';
          const isOtherLinked = r.crisis_link_status === 'other_linked';
          const baseColor = DAMAGE_COLOR[r.damage_level] ?? '#64748b';
          const color = isCandidate ? '#7c3aed' : baseColor;
          return (
            <CircleMarker
              key={r.id}
              center={[lat, lng]}
              radius={selectedReportId === r.id ? 9 : isCandidate ? 5 : 6}
              pathOptions={{
                color: selectedReportId === r.id ? '#0f172a' : isOtherLinked ? '#b45309' : color,
                fillColor: isCandidate ? '#ede9fe' : baseColor,
                fillOpacity: isCandidate ? 0.75 : 0.85,
                weight: isCandidate || isOtherLinked ? 2.5 : 2,
                dashArray: isCandidate ? '4 3' : isOtherLinked ? '2 2' : undefined,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedReportId(r.id);
                  setPanel(null);
                },
              }}
            />
          );
        })}

      </MapContainer>

      <div className="ops-map-overlay-top">
        <div className="ops-map-top-left">
          <BihLogo to="/ops" large />
          <Link to="/ops" className="ops-map-chip ops-map-link">
            {t('ops.nav.console')}
          </Link>
          <Link
            to={(() => {
              const q = applyBrowseToSearchParams(new URLSearchParams(), {
                view: reportView,
                crisisId: activeCrisisId,
                zoneId: selectedZoneId ?? '',
                browseFrom,
                browseTo,
              });
              const s = q.toString();
              return s ? `/dashboard?${s}` : '/dashboard';
            })()}
            className="ops-map-chip ops-map-link"
          >
            {t('ops.nav.dashboard')}
          </Link>
        </div>
        <div className="ops-map-top-right">
          <LanguageSwitcher compact />
          <OpsUserMenu className="ops-map-user-menu" compact />
        </div>
      </div>

      {(zones.length > 0 || (canUseWorkMode && shellMode === 'work')) && (
        <div className="ops-map-fab-col">
          {zones.length > 0 && (
            <button
              type="button"
              className="ops-map-fab ops-map-fab-icon"
              title={t('map.crisis.showZones')}
              aria-label={t('map.crisis.showZones')}
              onClick={() => setZoneFitTick((n) => n + 1)}
            >
              ⊞
            </button>
          )}
          {canUseWorkMode && shellMode === 'work' && (
            <>
              <button
                type="button"
                className={`ops-map-fab ${mapMode === 'draw' ? 'active' : ''}`}
                onClick={startDraw}
                title={!canCreateZones && activeCrisisId ? t('ops.map.drawZoneDenied') : undefined}
              >
                {t('ops.map.drawZone')}
              </button>
              {canArchive && (
                <button
                  type="button"
                  className={`ops-map-fab ${panel === 'crisis' ? 'active' : ''}`}
                  onClick={() => togglePanel('crisis')}
                >
                  {t('ops.map.archiveFab')}
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className={`ops-map-fab ${panel === 'audit' ? 'active' : ''}`}
                  onClick={() => togglePanel('audit')}
                >
                  {t('ops.tab.audit')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="ops-map-bottom-chrome">
        {shellMode === 'work' && (
          <div className="ops-map-work-bar ops-map-panel-compact">
            {manageableCrises.length > 0 ? (
              <label className="ops-map-chip ops-map-crisis-select ops-map-view-field ops-map-work-crisis">
                <span className="ops-map-view-label">{t('ops.map.workCrisis')}</span>
                <select value={activeCrisisId} onChange={(e) => setActiveCrisisId(e.target.value)}>
                  {manageableCrises.map((c) => (
                    <option key={c.id} value={c.id}>
                      {crisisName(c.name, c.slug)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="ops-map-chip muted ops-map-view-field">{t('ops.map.noCrisis')}</span>
            )}
            <div ref={workHelpRef} className="ops-map-chip ops-map-report-count-wrap ops-map-work-stats">
              <span className="ops-map-report-count">
                {activeCrisisId
                  ? t('ops.map.reportCountCrisis', {
                      total: reports.length,
                      linked: crisisLinkedCount,
                      other: crisisOtherLinkedCount,
                      candidate: crisisCandidateCount,
                    })
                  : t('ops.map.reportCount', { count: reports.length })}
              </span>
              <button
                type="button"
                className="ops-map-help-btn"
                aria-expanded={workHelpOpen}
                aria-label={t('ops.map.workHelp.button')}
                onClick={() => setWorkHelpOpen((v) => !v)}
              >
                ?
              </button>
              {workHelpOpen && (
                <div className="ops-map-help-popover" role="dialog" aria-labelledby="ops-map-work-help-title">
                  <header className="ops-map-help-popover-header">
                    <strong id="ops-map-work-help-title">{t('ops.map.workHelp.title')}</strong>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setWorkHelpOpen(false)}
                      aria-label={t('common.cancel')}
                    >
                      ×
                    </button>
                  </header>
                  <p className="ops-map-help-summary">{t('ops.map.workBarHint')}</p>
                  <p>{t('ops.map.workHelp.body')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {shellMode === 'view' && (
          <div className="ops-map-view-panel">
            <div className="ops-map-view-row">
              <label className="ops-map-chip ops-map-view-field">
                <span className="ops-map-view-label">{t('ops.map.queryPanel')}</span>
                <select
                  value={reportView}
                  onChange={(e) => setReportView(e.target.value as 'crisis' | 'unspecified' | 'all')}
                  aria-label={t('dashboard.viewMode')}
                >
                  {canBrowseWideViews && <option value="all">{t('dashboard.view.all')}</option>}
                  {canBrowseWideViews && (
                    <option value="unspecified">{t('dashboard.view.unspecified')}</option>
                  )}
                  <option value="crisis">{t('dashboard.view.crisis')}</option>
                </select>
              </label>
              {manageableCrises.length > 0 ? (
                <label className="ops-map-chip ops-map-crisis-select ops-map-view-field">
                  <span className="ops-map-view-label">{t('ops.map.workCrisis')}</span>
                  <select value={activeCrisisId} onChange={(e) => setActiveCrisisId(e.target.value)}>
                    {manageableCrises.map((c) => (
                      <option key={c.id} value={c.id}>
                        {crisisName(c.name, c.slug)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="ops-map-chip muted ops-map-view-field">{t('ops.map.noCrisis')}</span>
              )}
              {zones.length > 0 ? (
                <label className="ops-map-chip ops-map-view-field">
                  <span className="ops-map-view-label">{t('ops.map.zone')}</span>
                  <select
                    value={selectedZoneId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setSelectedZoneId(id);
                      if (!id) {
                        setPanel((p) => (p === 'zone' ? null : p));
                        return;
                      }
                      const z = zones.find((x) => x.id === id);
                      if (z) {
                        setPanel('zone');
                        setFlyZone(z);
                        setTimeout(() => setFlyZone(null), 100);
                      }
                    }}
                  >
                    <option value="">{t('ops.map.allZones')}</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="ops-map-chip muted ops-map-view-field">—</span>
              )}
            </div>
            <div className="ops-map-view-row">
              <label className="ops-map-chip ops-map-view-field">
                <span className="ops-map-view-label">{t('ops.map.browseTimeFrom')}</span>
                <input type="datetime-local" value={browseFrom} onChange={(e) => setBrowseFrom(e.target.value)} />
              </label>
              <label className="ops-map-chip ops-map-view-field">
                <span className="ops-map-view-label">{t('ops.map.browseTimeTo')}</span>
                <input type="datetime-local" value={browseTo} onChange={(e) => setBrowseTo(e.target.value)} />
              </label>
              <div ref={viewHelpRef} className="ops-map-chip ops-map-view-field ops-map-report-count-wrap">
                <span className="ops-map-report-count">
                  {reportView === 'all' && activeCrisisId
                    ? t('ops.map.reportCountCrisis', {
                        total: reports.length,
                        linked: crisisLinkedCount,
                        other: crisisOtherLinkedCount,
                        candidate: crisisCandidateCount,
                      })
                    : reportView === 'crisis'
                      ? t('ops.map.reportCountLinked', { count: reports.length })
                      : t('ops.map.reportCount', { count: reports.length })}
                </span>
                <button
                  type="button"
                  className="ops-map-help-btn"
                  aria-expanded={viewHelpOpen}
                  aria-label={t('ops.map.viewHelp.button')}
                  onClick={() => setViewHelpOpen((v) => !v)}
                >
                  ?
                </button>
                {viewHelpOpen && (
                  <div className="ops-map-help-popover" role="dialog" aria-labelledby="ops-map-view-help-title">
                    <header className="ops-map-help-popover-header">
                      <strong id="ops-map-view-help-title">{t('ops.map.viewHelp.title')}</strong>
                      <button type="button" className="icon-btn" onClick={() => setViewHelpOpen(false)} aria-label={t('common.cancel')}>
                        ×
                      </button>
                    </header>
                    <p className="ops-map-help-summary">{t(`ops.map.viewHint.${reportView}`)}</p>
                    <p>{t(`ops.map.viewHelp.${reportView}`)}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="ops-map-view-actions">
              <button type="button" className="ops-map-chip ops-map-btn" onClick={() => setSaveReportOpen(true)}>
                {t('ops.map.saveReport')}
              </button>
              {selectedZone && (
                <button type="button" className="ops-map-chip ops-map-btn secondary" onClick={clearZoneSelection}>
                  {t('ops.map.clearZone')}
                </button>
              )}
            </div>
          </div>
        )}

        {canUseWorkMode && <OpsMapShellToggle mode={shellMode} onChange={onShellModeChange} />}
      </div>

      {err && (
        <div className="ops-map-toast error" role="alert">
          {err}
          <button type="button" onClick={() => setErr(null)} aria-label="關閉">
            ×
          </button>
        </div>
      )}

      {panel === 'zone' &&
        (mapMode !== 'browse' || selectedZone || editingZoneId || (closed && vertices.length >= 3)) && (
        <div className="ops-map-card ops-map-card-zone">
          <button type="button" className="ops-map-card-close" onClick={() => { setPanel(null); resetDraft(); }}>
            ×
          </button>
          {(mapMode === 'draw' || mapMode === 'edit') ? (
            <>
              <h3>{editingZoneId ? '編輯分區' : '新增分區'}</h3>
              <p className="muted">
                {mapMode === 'draw' && !closed && '點擊地圖新增頂點；至少 3 點後按「完成多邊形」。'}
                {(closed || mapMode === 'edit') &&
                  '拖曳白點移動頂點；點綠色中點或邊線附近可加邊；選取頂點後可刪除。'}
              </p>
              <label className="ops-field">
                <span>分區名稱（必填）</span>
                <input
                  className="ops-input"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="例如：北區、撤離區 A"
                  required
                />
              </label>
              <p className="muted">
                頂點 {vertices.length}
                {draftAreaKm2 != null && (closed || mapMode === 'edit') && ` · ${formatArea(draftAreaKm2)}`}
                {selectedVertex != null && ` · 已選頂點 #${selectedVertex + 1}`}
              </p>
              <div className="ops-map-card-actions">
                {mapMode === 'draw' && !closed && (
                  <>
                    <button type="button" onClick={finishDrawing} disabled={vertices.length < 3}>
                      完成多邊形
                    </button>
                    <button type="button" onClick={() => setVertices((p) => p.slice(0, -1))} disabled={!vertices.length}>
                      復原上一點
                    </button>
                  </>
                )}
                {(mapMode === 'edit' || closed) && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={removeSelectedVertex}
                    disabled={selectedVertex == null || vertices.length <= 3}
                  >
                    刪除選取頂點
                  </button>
                )}
                {canSaveZone && (
                  <button type="button" onClick={saveZone} disabled={busy}>
                    儲存
                  </button>
                )}
                <button type="button" className="secondary" onClick={resetDraft}>
                  取消
                </button>
              </div>
            </>
          ) : selectedZone ? (
            <>
              <h3>{selectedZone.name}</h3>
              <p className="muted">{selectedZone.id.slice(0, 8)}…</p>
              <div className="ops-map-card-actions">
                {canEditSelectedZone && (
                  <button type="button" onClick={() => startEditZone(selectedZone)}>
                    編輯邊界
                  </button>
                )}
                {isAdmin && (
                  <button type="button" className="danger" onClick={() => removeZone(selectedZone.id)} disabled={busy}>
                    刪除
                  </button>
                )}
                <button type="button" className="secondary" onClick={clearZoneSelection}>
                  {t('ops.map.clearZone')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {shellMode === 'work' && panel === 'crisis' && canArchive && (
        <div className="ops-map-card ops-map-card-wide">
          <button type="button" className="ops-map-card-close" onClick={() => setPanel(null)}>
            ×
          </button>
          <h3>{t('ops.map.archiveTitle')}</h3>
          <p className="muted">{t('ops.map.archiveHint')}</p>
          {activeCrisis && (
            <p className="muted">
              {crisisName(activeCrisis.name, activeCrisis.slug)} · {activeCrisis.archive_status}
              {activeCrisis.archive_status === 'draft' && (
                <span className="ops-archive-draft-hint"> · {t('ops.map.archiveDraftHint')}</span>
              )}
            </p>
          )}
          {browseDiffersFromOfficial && (
            <p className="ops-archive-warn" role="status">
              {t('ops.map.queryDiffersFromOfficial')}
            </p>
          )}
          {archiveNeedsOfficialStart && (
            <p className="ops-archive-warn" role="status">
              {t('ops.map.archiveNeedsOfficialStart')}
              <button type="button" className="linkish" onClick={() => setDraftWindowOpen(true)}>
                {t('ops.map.setOfficialWindow')}
              </button>
            </p>
          )}
          {archiveMissingZones && (
            <p className="ops-archive-warn" role="status">
              {t('ops.map.archiveNoZones')}
            </p>
          )}
          <div className="ops-archive-window-block">
            <p className="ops-archive-window-label">{t('ops.map.officialArchiveWindow')}</p>
            <p className="ops-archive-window-range">
              {t('ops.map.archiveWindowRange', {
                from: formatPanelTime(officialRange.archiveFrom),
                to: formatPanelTime(officialRange.archiveTo),
              })}
            </p>
            <p className="muted ops-archive-window-zone">
              {t('ops.map.archiveAllZones', { count: zones.length })}
            </p>
            <p className="ops-archive-window-label">{t('ops.map.archiveStrategy')}</p>
            <div className="ops-archive-mode-row">
              <label className="ops-archive-mode-opt">
                <input
                  type="radio"
                  name="archiveStrategy"
                  checked={unlinkOutOfScope}
                  onChange={() => setUnlinkOutOfScope(true)}
                />
                {t('ops.map.archiveStrategyFull')}
              </label>
              <label className="ops-archive-mode-opt">
                <input
                  type="radio"
                  name="archiveStrategy"
                  checked={!unlinkOutOfScope}
                  onChange={() => setUnlinkOutOfScope(false)}
                />
                {t('ops.map.archiveStrategyLinkOnly')}
              </label>
            </div>
            <p className="muted ops-archive-window-note">{t('ops.map.archiveWindowNote')}</p>
          </div>
          <div className="ops-map-card-actions">
            <button
              type="button"
              onClick={runArchivePreview}
              disabled={busy || archiveNeedsOfficialStart || archiveMissingZones}
            >
              {t('ops.map.archivePreview')}
            </button>
            <button
              type="button"
              onClick={runArchive}
              disabled={busy || archiveNeedsOfficialStart || archiveMissingZones}
            >
              {t('ops.map.archiveRun')}
            </button>
          </div>
          {preview && (
            <div className="ops-preview-box">
              <strong>{t('ops.map.archivePreviewTitle')}</strong>
              <p className="ops-archive-window-range">
                {t('ops.map.archiveWindowRange', {
                  from: formatIsoTime(preview.archive_window_start),
                  to: formatIsoTime(preview.archive_window_end),
                })}
              </p>
              <p>
                {unlinkOutOfScope
                  ? t('ops.map.archivePreviewCounts', {
                      matched: preview.matched_count,
                      unlinked: preview.unlinked_count,
                      kept: preview.linked_in_scope_count,
                    })
                  : t('ops.map.archivePreviewCountsLinkOnly', {
                      matched: preview.matched_count,
                      kept: preview.linked_in_scope_count,
                    })}
              </p>
              {preview.sample_report_ids.length > 0 && (
                <p className="muted">
                  {t('ops.map.archivePreviewSampleAdd', {
                    ids: preview.sample_report_ids.slice(0, 5).join(', '),
                  })}
                </p>
              )}
              {preview.sample_unlink_report_ids.length > 0 && (
                <p className="muted">
                  {t('ops.map.archivePreviewSampleRemove', {
                    ids: preview.sample_unlink_report_ids.slice(0, 5).join(', '),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {panel === 'audit' && isAdmin && (
        <div className="ops-map-card ops-map-card-wide ops-map-card-audit">
          <button type="button" className="ops-map-card-close" onClick={() => setPanel(null)}>
            ×
          </button>
          <h3>{t('ops.tab.audit')}</h3>
          <ul className="ops-audit-list">
            {audit.map((a) => (
              <li key={a.id}>
                <time>{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</time>
                <span>{a.action}</span>
                <span className="muted">{a.entity_type}</span>
              </li>
            ))}
          </ul>
          {audit.length === 0 && <p className="muted">尚無紀錄</p>}
        </div>
      )}

      {draftWindowOpen && (
        <div className="ops-map-modal-backdrop" role="presentation" onClick={() => setDraftWindowOpen(false)}>
          <div
            className="ops-map-modal"
            role="dialog"
            aria-labelledby="ops-draft-window-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="ops-draft-window-title">{t('ops.map.draftWindowTitle')}</h3>
            <p className="muted">{t('ops.map.draftWindowHint')}</p>
            <label className="ops-field">
              <span>{t('ops.map.officialStart')}</span>
              <input
                className="ops-input"
                type="datetime-local"
                value={draftWindowStart}
                onChange={(e) => setDraftWindowStart(e.target.value)}
                required
              />
            </label>
            <label className="ops-field">
              <span>{t('ops.map.officialEnd')}</span>
              <input
                className="ops-input"
                type="datetime-local"
                value={draftWindowEnd}
                onChange={(e) => setDraftWindowEnd(e.target.value)}
              />
            </label>
            <p className="muted">{t('ops.map.officialEndOptional')}</p>
            <div className="ops-map-card-actions">
              <button type="button" onClick={saveDraftOfficialWindow} disabled={busy}>
                {t('ops.map.draftWindowSave')}
              </button>
              <button type="button" className="secondary" onClick={() => setDraftWindowOpen(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {saveReportOpen && (
        <div className="ops-map-modal-backdrop" role="presentation" onClick={() => setSaveReportOpen(false)}>
          <div
            className="ops-map-modal"
            role="dialog"
            aria-labelledby="ops-save-report-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="ops-save-report-title">{t('ops.map.saveReportTitle')}</h3>
            <p className="muted">{t('ops.map.saveReportHint')}</p>
            <label className="ops-field">
              <span>{t('ops.map.saveReportName')}</span>
              <input
                className="ops-input"
                value={saveReportName}
                onChange={(e) => setSaveReportName(e.target.value)}
                placeholder={t('ops.map.saveReportNamePlaceholder')}
              />
            </label>
            <div className="ops-map-card-actions">
              <button type="button" onClick={saveNamedReport} disabled={busy}>
                {t('ops.map.saveReportConfirm')}
              </button>
              <button type="button" className="secondary" onClick={() => setSaveReportOpen(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedReport && (
        <div className="ops-map-card ops-map-card-report">
          <button type="button" className="ops-map-card-close" onClick={() => setSelectedReportId(null)}>
            ×
          </button>
          <h3>回報</h3>
          <p>{selectedReport.description_preview}</p>
          <p className="muted">
            {selectedReport.damage_level} · {new Date(selectedReport.captured_at_client).toLocaleString()}
          </p>
          <div className="ops-map-card-actions">
            <button
              type="button"
              onClick={() => patchReport(selectedReport.id, !selectedReport.admin_reviewed, undefined)}
              disabled={busy}
            >
              {selectedReport.admin_reviewed ? '取消審核' : '標記審核'}
            </button>
            <button
              type="button"
              onClick={() => patchReport(selectedReport.id, undefined, !selectedReport.admin_flagged)}
              disabled={busy}
            >
              {selectedReport.admin_flagged ? '取消旗標' : '加旗標'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
