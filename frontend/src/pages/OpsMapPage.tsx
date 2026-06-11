import L from 'leaflet';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isManageableCrisis } from '../ops/crisisUtils';
import { CircleMarker, GeoJSON, MapContainer, useMap } from 'react-leaflet';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import 'leaflet/dist/leaflet.css';

import { apiGet, wakeApiBackend } from '../api';
import {
  opsDelete,
  opsGet,
  opsPatch,
  opsPost,
  type ArchivePreview,
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
  opsCanRunArchive,
  opsIsSystemAdmin,
  setOpsSession,
  type OpsUserSession,
} from '../ops/opsAuth';
import { BihLogo } from '../components/BihLogo';
import { OpsUserMenu } from '../components/OpsUserMenu';
import { OsmTileLayer } from '../components/map/CachedOsmTileLayer';
import { MapRailZoom } from '../components/map/MapRailZoom';
import { OpsMapClearSelection } from '../components/ops/OpsMapClearSelection';
import { OpsPolygonEditor } from '../components/ops/OpsPolygonEditor';
import { useI18n } from '../i18n/I18nContext';
import {
  formatArea,
  fromDatetimeLocalValue,
  polygonAreaKm2,
  polygonToVertices,
  toDatetimeLocalValue,
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

export function OpsMapPage() {
  const { t, crisisName } = useI18n();
  const [searchParams] = useSearchParams();
  const crisisFromUrl = searchParams.get('crisis_id') ?? '';
  const reportFromUrl = searchParams.get('report_id');
  const latFromUrl = searchParams.get('lat');
  const lngFromUrl = searchParams.get('lng');
  const [user, setUser] = useState<OpsUserSession | null>(() => getOpsUser());
  const isAdmin = opsIsSystemAdmin(user);
  const hasZoneDrawRole =
    isAdmin || ((user?.crisis_lead_assignments?.length ?? 0) > 0);
  const [activeCrisisId, setActiveCrisisId] = useState<string>(crisisFromUrl);
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [crisisLinkedCount, setCrisisLinkedCount] = useState(0);
  const [crisisCandidateCount, setCrisisCandidateCount] = useState(0);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [mapMode, setMapMode] = useState<MapMode>('browse');

  const [zoneName, setZoneName] = useState('');
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [closed, setClosed] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [reportView, setReportView] = useState<'crisis' | 'unspecified' | 'all'>('crisis');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flyZone, setFlyZone] = useState<OpsZone | null>(null);
  const [flyPoint, setFlyPoint] = useState<[number, number] | null>(null);
  const [zonesRevision, setZonesRevision] = useState(0);
  const [defaultOpsMonths, setDefaultOpsMonths] = useState(2);

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
    const q = new URLSearchParams({ limit: '300', view: reportView });
    if (reportView === 'crisis' && activeCrisisId) q.set('crisis_id', activeCrisisId);
    if (selectedZoneId) q.set('zone_id', selectedZoneId);
    const from = fromDatetimeLocalValue(filterFrom);
    const to = fromDatetimeLocalValue(filterTo);
    if (from) q.set('captured_from', from);
    if (to) q.set('captured_to', to);
    opsGet<{
      items: OpsReport[];
      crisis_linked_count?: number | null;
      crisis_candidate_count?: number | null;
    }>(`/v1/ops/reports?${q}`)
      .then((d) => {
        setReports(d.items);
        setCrisisLinkedCount(d.crisis_linked_count ?? 0);
        setCrisisCandidateCount(d.crisis_candidate_count ?? 0);
      })
      .catch(() => {
        setReports([]);
        setCrisisLinkedCount(0);
        setCrisisCandidateCount(0);
      });
  }, [selectedZoneId, filterFrom, filterTo, reportView, activeCrisisId]);

  useEffect(() => {
    apiGet<{ default_ops_view_months?: number }>('/v1/public/settings')
      .then((s) => {
        if (s.default_ops_view_months) setDefaultOpsMonths(s.default_ops_view_months);
      })
      .catch(() => undefined);
  }, []);

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
    if (!activeCrisis) return;
    if (activeCrisis.archive_window_start || activeCrisis.archive_window_end) {
      setFilterFrom(toDatetimeLocalValue(activeCrisis.archive_window_start));
      setFilterTo(toDatetimeLocalValue(activeCrisis.archive_window_end));
      return;
    }
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - defaultOpsMonths);
    setFilterFrom(toDatetimeLocalValue(start.toISOString()));
    setFilterTo(toDatetimeLocalValue(end.toISOString()));
  }, [
    activeCrisis?.id,
    activeCrisis?.archive_window_start,
    activeCrisis?.archive_window_end,
    defaultOpsMonths,
  ]);

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

  const runArchivePreview = async () => {
    if (!activeCrisisId) return;
    setBusy(true);
    try {
      const from = fromDatetimeLocalValue(filterFrom);
      const to = fromDatetimeLocalValue(filterTo);
      const body = {
        zone_ids: selectedZoneId ? [selectedZoneId] : null,
        limit: 500,
        captured_from: from || null,
        captured_to: to || null,
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
    if (!activeCrisisId || !window.confirm('執行批次歸檔？將建立 report_crisis_links。')) return;
    setBusy(true);
    try {
      const from = fromDatetimeLocalValue(filterFrom);
      const to = fromDatetimeLocalValue(filterTo);
      const body = {
        zone_ids: selectedZoneId ? [selectedZoneId] : null,
        limit: 500,
        captured_from: from || null,
        captured_to: to || null,
      };
      const r = await opsPost<{ linked_count: number }>(`/v1/ops/crises/${activeCrisisId}/archive-run`, body);
      setPreview(null);
      loadCrises();
      loadAudit();
      setErr(null);
      alert(
        t('ops.map.archiveDone', {
          linked: r.linked_count,
          hint: r.linked_count === 0 ? t('ops.map.archiveDoneZeroHint') : '',
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePanel = (key: PanelKey) => {
    setPanel((p) => (p === key ? null : key));
    if (key === 'audit') loadAudit();
  };

  return (
    <div className="map-page ops-map-page">
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
          const color = isCandidate ? '#7c3aed' : (DAMAGE_COLOR[r.damage_level] ?? '#64748b');
          return (
            <CircleMarker
              key={r.id}
              center={[lat, lng]}
              radius={selectedReportId === r.id ? 9 : isCandidate ? 5 : 6}
              pathOptions={{
                color: selectedReportId === r.id ? '#0f172a' : color,
                fillColor: isCandidate ? '#ede9fe' : color,
                fillOpacity: isCandidate ? 0.75 : 0.85,
                weight: isCandidate ? 2.5 : 2,
                dashArray: isCandidate ? '4 3' : undefined,
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
          <Link to="/dashboard" className="ops-map-chip ops-map-link">
            {t('ops.nav.dashboard')}
          </Link>
        </div>
        <div className="ops-map-top-right">
          <OpsUserMenu className="ops-map-user-menu" compact />
        </div>
      </div>

      <div className="ops-map-fab-col">
        {hasZoneDrawRole && (
          <button
            type="button"
            className={`ops-map-fab ${mapMode === 'draw' ? 'active' : ''}`}
            onClick={startDraw}
            title={!canCreateZones && activeCrisisId ? '此危機無畫分區權限' : undefined}
          >
            ＋ 畫分區
          </button>
        )}
        {canArchive && (
          <button type="button" className={`ops-map-fab ${panel === 'crisis' ? 'active' : ''}`} onClick={() => togglePanel('crisis')}>
            危機歸檔
          </button>
        )}
        {isAdmin && (
          <button type="button" className={`ops-map-fab ${panel === 'audit' ? 'active' : ''}`} onClick={() => togglePanel('audit')}>
            稽核
          </button>
        )}
      </div>

      <div className="ops-map-view-panel">
        <div className="ops-map-view-row">
          <label className="ops-map-chip ops-map-view-field">
            <span className="ops-map-view-label">{t('ops.map.viewPanel')}</span>
            <select
              value={reportView}
              onChange={(e) => setReportView(e.target.value as 'crisis' | 'unspecified' | 'all')}
              aria-label={t('dashboard.viewMode')}
            >
              <option value="crisis">{t('dashboard.view.crisis')}</option>
              <option value="unspecified">{t('dashboard.view.unspecified')}</option>
              <option value="all">{t('dashboard.view.all')}</option>
            </select>
          </label>
          {reportView === 'crisis' && manageableCrises.length > 0 ? (
            <label className="ops-map-chip ops-map-crisis-select ops-map-view-field">
              <span className="ops-map-view-label">{t('ops.map.crisis')}</span>
              <select value={activeCrisisId} onChange={(e) => setActiveCrisisId(e.target.value)}>
                {manageableCrises.map((c) => (
                  <option key={c.id} value={c.id}>
                    {crisisName(c.name, c.slug)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="ops-map-chip muted ops-map-view-field">
              {reportView !== 'crisis' ? t(`dashboard.viewHint.${reportView}`) : t('ops.map.noCrisis')}
            </span>
          )}
          {zones.length > 0 && reportView === 'crisis' ? (
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
            <span className="ops-map-view-label">{t('ops.map.timeFrom')}</span>
            <input type="datetime-local" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </label>
          <label className="ops-map-chip ops-map-view-field">
            <span className="ops-map-view-label">{t('ops.map.timeTo')}</span>
            <input type="datetime-local" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </label>
          <span className="ops-map-chip ops-map-view-field ops-map-report-count">
            {reportView === 'crisis'
              ? t('ops.map.reportCountCrisis', {
                  total: reports.length,
                  linked: crisisLinkedCount,
                  candidate: crisisCandidateCount,
                })
              : t('ops.map.reportCount', { count: reports.length })}
          </span>
        </div>
        <p className="ops-map-view-rules muted">
          {reportView === 'crisis' && t('ops.map.viewRules.crisis')}
          {reportView === 'unspecified' && t('ops.map.viewRules.unspecified')}
          {reportView === 'all' && t('ops.map.viewRules.all')}
        </p>
        {selectedZone && (
          <button type="button" className="ops-map-chip ops-map-btn secondary" onClick={clearZoneSelection}>
            {t('ops.map.clearZone')}
          </button>
        )}
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

      {panel === 'crisis' && canArchive && (
        <div className="ops-map-card ops-map-card-wide">
          <button type="button" className="ops-map-card-close" onClick={() => setPanel(null)}>
            ×
          </button>
          <h3>{t('ops.map.archiveTitle')}</h3>
          <p className="muted">{t('ops.map.archiveHint')}</p>
          {activeCrisis && (
            <p className="muted">
              {crisisName(activeCrisis.name, activeCrisis.slug)} · {activeCrisis.archive_status}
            </p>
          )}
          <div className="ops-map-card-actions">
            <button type="button" onClick={runArchivePreview} disabled={busy}>
              {t('ops.map.archivePreview')}
            </button>
            <button type="button" onClick={runArchive} disabled={busy}>
              {t('ops.map.archiveRun')}
            </button>
          </div>
          {preview && (
            <div className="ops-preview-box">
              <strong>預覽（3c）</strong>
              <p>
                {t('ops.map.archivePreviewCounts', {
                  matched: preview.matched_count,
                  linked: preview.already_linked_count,
                })}
              </p>
              {preview.sample_report_ids.length > 0 && (
                <p className="muted">範例：{preview.sample_report_ids.slice(0, 5).join(', ')}</p>
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
          <h3>稽核紀錄（3c）</h3>
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
