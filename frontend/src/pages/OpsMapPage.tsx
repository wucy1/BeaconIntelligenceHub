import L from 'leaflet';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Link, Navigate } from 'react-router-dom';

import 'leaflet/dist/leaflet.css';

import {
  opsDelete,
  opsGet,
  opsPatch,
  opsPost,
  type ArchivePreview,
  type AuditEntry,
  type OpsCrisis,
  type OpsReport,
  type OpsUserRecord,
  type OpsZone,
} from '../ops/opsApi';
import {
  clearOpsSession,
  getOpsUser,
  opsCanCreateZones,
  opsCanEditZone,
  opsCanManageUsers,
  opsCanRunArchive,
  opsIsSystemAdmin,
} from '../ops/opsAuth';
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
type PanelKey = 'zone' | 'crisis' | 'audit' | 'users' | null;

function PolygonDrawHandler({
  active,
  onAddVertex,
}: {
  active: boolean;
  onAddVertex: (v: LatLng) => void;
}) {
  useMapEvents({
    click(e) {
      if (!active) return;
      onAddVertex({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

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

function crisisLabel(c: OpsCrisis): string {
  return c.name['zh-Hant'] ?? c.name.zh ?? c.name.en ?? c.slug;
}

function roleLabel(role: string): string {
  if (role === 'system_admin') return '系統管理員';
  if (role === 'crisis_lead') return '營運人員（舊）';
  return '營運人員';
}

export function OpsMapPage() {
  const user = getOpsUser();
  const isAdmin = opsIsSystemAdmin(user);
  const canCreateZones = opsCanCreateZones(user);
  const canArchive = opsCanRunArchive(user);
  const canManageUsers = opsCanManageUsers(user);

  const [zones, setZones] = useState<OpsZone[]>([]);
  const [opsUsers, setOpsUsers] = useState<OpsUserRecord[]>([]);
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [activeCrisisId, setActiveCrisisId] = useState<string>('');
  const [panel, setPanel] = useState<PanelKey>(null);
  const [mapMode, setMapMode] = useState<MapMode>('browse');

  const [zoneName, setZoneName] = useState('');
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [closed, setClosed] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [crisisWindowStart, setCrisisWindowStart] = useState('');
  const [crisisWindowEnd, setCrisisWindowEnd] = useState('');
  const [crisisStatus, setCrisisStatus] = useState<OpsCrisis['archive_status']>('draft');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flyZone, setFlyZone] = useState<OpsZone | null>(null);

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignZoneId, setAssignZoneId] = useState('');
  const [assignRole, setAssignRole] = useState<'lead' | 'coordinator'>('coordinator');

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const canEditSelectedZone = selectedZone ? opsCanEditZone(user, selectedZone.id) : false;
  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? null;
  const activeCrisis = crises.find((c) => c.id === activeCrisisId) ?? null;

  const draftPolygon = useMemo(() => verticesToPolygon(vertices), [vertices]);
  const draftAreaKm2 = useMemo(() => polygonAreaKm2(vertices), [vertices]);
  const leafletPositions = useMemo(
    () => vertices.map((v) => [v.lat, v.lng] as [number, number]),
    [vertices],
  );

  const loadZones = useCallback(() => {
    opsGet<{ items: OpsZone[] }>('/v1/ops/zones').then((d) => setZones(d.items)).catch(() => setZones([]));
  }, []);

  const loadCrises = useCallback(() => {
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        if (!activeCrisisId && d.items.length > 0) setActiveCrisisId(d.items[0].id);
      })
      .catch(() => setCrises([]));
  }, [activeCrisisId]);

  const loadAudit = useCallback(() => {
    if (!isAdmin) return;
    opsGet<{ items: AuditEntry[] }>('/v1/ops/audit-log?limit=30')
      .then((d) => setAudit(d.items))
      .catch(() => setAudit([]));
  }, [isAdmin]);

  const loadUsers = useCallback(() => {
    if (!canManageUsers) return;
    opsGet<{ items: OpsUserRecord[] }>('/v1/ops/users')
      .then((d) => setOpsUsers(d.items))
      .catch(() => setOpsUsers([]));
  }, [canManageUsers]);

  const loadReports = useCallback(() => {
    const q = new URLSearchParams({ limit: '300' });
    if (selectedZoneId) q.set('zone_id', selectedZoneId);
    const from = fromDatetimeLocalValue(filterFrom);
    const to = fromDatetimeLocalValue(filterTo);
    if (from) q.set('captured_from', from);
    if (to) q.set('captured_to', to);
    opsGet<{ items: OpsReport[] }>(`/v1/ops/reports?${q}`)
      .then((d) => setReports(d.items))
      .catch(() => setReports([]));
  }, [selectedZoneId, filterFrom, filterTo]);

  useEffect(() => {
    loadZones();
    loadCrises();
  }, [loadZones, loadCrises]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!activeCrisis) return;
    setCrisisWindowStart(toDatetimeLocalValue(activeCrisis.archive_window_start));
    setCrisisWindowEnd(toDatetimeLocalValue(activeCrisis.archive_window_end));
    setCrisisStatus(activeCrisis.archive_status);
  }, [activeCrisis]);

  if (!user) return <Navigate to="/ops/login" replace />;

  const resetDraft = () => {
    setVertices([]);
    setClosed(false);
    setEditingZoneId(null);
    setZoneName('');
    setMapMode('browse');
  };

  const startDraw = () => {
    if (!canCreateZones) return;
    resetDraft();
    setMapMode('draw');
    setPanel('zone');
    setSelectedZoneId(null);
    setErr(null);
  };

  const startEditZone = (zone: OpsZone) => {
    setEditingZoneId(zone.id);
    setZoneName(zone.name);
    setVertices(polygonToVertices(zone.geom));
    setClosed(true);
    setMapMode('edit');
    setPanel('zone');
    setErr(null);
  };

  const finishDrawing = () => {
    if (vertices.length < 3) {
      setErr('至少需要 3 個頂點');
      return;
    }
    setClosed(true);
    setMapMode('browse');
    setErr(null);
  };

  const saveZone = async () => {
    if (!zoneName.trim() || !draftPolygon || !closed) {
      setErr('請完成名稱與多邊形');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (editingZoneId) {
        await opsPatch(`/v1/ops/zones/${editingZoneId}`, { name: zoneName.trim(), geom: draftPolygon });
      } else {
        await opsPost('/v1/ops/zones', { name: zoneName.trim(), geom: draftPolygon });
      }
      resetDraft();
      loadZones();
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

  const saveCrisisMeta = async () => {
    if (!activeCrisisId) return;
    setBusy(true);
    try {
      await opsPatch(`/v1/ops/crises/${activeCrisisId}`, {
        archive_status: crisisStatus,
        archive_window_start: fromDatetimeLocalValue(crisisWindowStart),
        archive_window_end: fromDatetimeLocalValue(crisisWindowEnd),
      });
      loadCrises();
      loadAudit();
      setErr(null);
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
      const body = { zone_ids: selectedZoneId ? [selectedZoneId] : null, limit: 500 };
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
      const body = { zone_ids: selectedZoneId ? [selectedZoneId] : null, limit: 500 };
      const r = await opsPost<{ linked_count: number }>(`/v1/ops/crises/${activeCrisisId}/archive-run`, body);
      setPreview(null);
      loadCrises();
      loadAudit();
      setErr(null);
      alert(`已歸檔連結 ${r.linked_count} 筆回報`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearOpsSession();
    window.location.href = '/ops/login';
  };

  const createUser = async () => {
    if (!newUserEmail.trim() || newUserPassword.length < 8) {
      setErr('請填 email 與至少 8 字元密碼');
      return;
    }
    setBusy(true);
    try {
      await opsPost('/v1/ops/users', {
        email: newUserEmail.trim(),
        password: newUserPassword,
        display_name: newUserName.trim() || null,
        role: 'coordinator',
      });
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserName('');
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignZoneToUser = async () => {
    if (!assignUserId || !assignZoneId) {
      setErr('請選擇人員與分區');
      return;
    }
    setBusy(true);
    try {
      await opsPost(`/v1/ops/users/${assignUserId}/zones/${assignZoneId}`, {
        assignment_role: assignRole,
      });
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unassignZone = async (userId: string, zoneId: string) => {
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/users/${userId}/zones/${zoneId}`);
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePanel = (key: PanelKey) => {
    setPanel((p) => (p === key ? null : key));
    if (key === 'audit') loadAudit();
    if (key === 'users') loadUsers();
  };

  return (
    <div className="map-page ops-map-page">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="contributor-map"
        style={{ cursor: mapMode === 'draw' || mapMode === 'edit' ? 'crosshair' : undefined }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FlyToZone zone={flyZone} />
        {((mapMode === 'draw' && canCreateZones) || (mapMode === 'edit' && editingZoneId && opsCanEditZone(user, editingZoneId))) && (
          <PolygonDrawHandler
            active
            onAddVertex={(v) => {
              setVertices((prev) => [...prev, v]);
              setClosed(false);
            }}
          />
        )}

        {zones.map((z) => {
          const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
            type: 'Feature',
            properties: { name: z.name },
            geometry: z.geom,
          };
          const selected = z.id === selectedZoneId;
          return (
            <GeoJSON
              key={z.id}
              data={feature}
              style={{
                color: selected ? '#0d47a1' : '#b91c1c',
                weight: selected ? 3 : 2,
                fillOpacity: selected ? 0.2 : 0.1,
              }}
              onEachFeature={(_f, layer) => {
                layer.on('click', () => {
                  setSelectedZoneId(z.id);
                  setSelectedReportId(null);
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
          const color = DAMAGE_COLOR[r.damage_level] ?? '#64748b';
          return (
            <CircleMarker
              key={r.id}
              center={[lat, lng]}
              radius={selectedReportId === r.id ? 9 : 6}
              pathOptions={{
                color: selectedReportId === r.id ? '#0f172a' : color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: 2,
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

        {vertices.length >= 2 && !closed && (
          <Polyline positions={leafletPositions} pathOptions={{ color: '#1565c0', weight: 2, dashArray: '6 4' }} />
        )}
        {closed && draftPolygon && (
          <Polygon positions={leafletPositions} pathOptions={{ color: '#1565c0', weight: 2, fillOpacity: 0.18 }} />
        )}
        {vertices.map((v, i) => (
          <CircleMarker
            key={`v-${i}`}
            center={[v.lat, v.lng]}
            radius={5}
            pathOptions={{ color: '#1565c0', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
          />
        ))}
      </MapContainer>

      <div className="ops-map-overlay-top">
        <div className="ops-map-chip ops-map-title">
          <strong>營運地圖</strong>
          <span className="ops-map-sub">
            {user.email} · {roleLabel(user.role)}
            {!isAdmin && user.zone_assignments?.length
              ? ` · ${user.zone_assignments.map((a) => `${a.assignment_role}@${a.zone_id.slice(0, 4)}`).join(', ')}`
              : ''}
          </span>
        </div>
        <div className="ops-map-toolbar">
          <Link to="/" className="ops-map-chip ops-map-link">
            回報地圖
          </Link>
          <button type="button" className="ops-map-chip" onClick={logout}>
            登出
          </button>
        </div>
      </div>

      <div className="ops-map-fab-col">
        {canCreateZones && (
          <button type="button" className={`ops-map-fab ${mapMode === 'draw' ? 'active' : ''}`} onClick={startDraw}>
            ＋ 畫分區
          </button>
        )}
        {canArchive && (
          <button type="button" className={`ops-map-fab ${panel === 'crisis' ? 'active' : ''}`} onClick={() => togglePanel('crisis')}>
            危機歸檔
          </button>
        )}
        {canManageUsers && (
          <button type="button" className={`ops-map-fab ${panel === 'users' ? 'active' : ''}`} onClick={() => togglePanel('users')}>
            人員
          </button>
        )}
        {isAdmin && (
          <button type="button" className={`ops-map-fab ${panel === 'audit' ? 'active' : ''}`} onClick={() => togglePanel('audit')}>
            稽核
          </button>
        )}
      </div>

      <div className="ops-map-filter-bar">
        <label className="ops-map-chip">
          時間起
          <input type="datetime-local" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        </label>
        <label className="ops-map-chip">
          時間迄
          <input type="datetime-local" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </label>
        <span className="ops-map-chip muted">{reports.length} 筆回報</span>
        {selectedZone && <span className="ops-map-chip">分區：{selectedZone.name}</span>}
      </div>

      {err && (
        <div className="ops-map-toast error" role="alert">
          {err}
          <button type="button" onClick={() => setErr(null)} aria-label="關閉">
            ×
          </button>
        </div>
      )}

      {panel === 'zone' && (mapMode !== 'browse' || selectedZone || editingZoneId) && (
        <div className="ops-map-card ops-map-card-zone">
          <button type="button" className="ops-map-card-close" onClick={() => { setPanel(null); resetDraft(); }}>
            ×
          </button>
          {(mapMode === 'draw' || mapMode === 'edit') ? (
            <>
              <h3>{editingZoneId ? '編輯分區' : '新增分區'}</h3>
              <p className="muted">點擊地圖加頂點，不限範圍大小。</p>
              <input
                className="ops-input"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                placeholder="分區名稱"
              />
              <p className="muted">
                頂點 {vertices.length}
                {draftAreaKm2 != null && closed && ` · ${formatArea(draftAreaKm2)}`}
              </p>
              <div className="ops-map-card-actions">
                {!closed && (
                  <>
                    <button type="button" onClick={finishDrawing} disabled={vertices.length < 3}>
                      完成
                    </button>
                    <button type="button" onClick={() => setVertices((p) => p.slice(0, -1))} disabled={!vertices.length}>
                      復原
                    </button>
                  </>
                )}
                {closed && (
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
                <button type="button" className="secondary" onClick={() => setSelectedZoneId(null)}>
                  清除選取
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
          <h3>危機歸檔（3b）</h3>
          <label className="ops-field">
            危機
            <select value={activeCrisisId} onChange={(e) => setActiveCrisisId(e.target.value)}>
              {crises.map((c) => (
                <option key={c.id} value={c.id}>
                  {crisisLabel(c)} ({c.archive_status})
                </option>
              ))}
            </select>
          </label>
          <label className="ops-field">
            狀態
            <select value={crisisStatus} onChange={(e) => setCrisisStatus(e.target.value as OpsCrisis['archive_status'])}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="ops-field">
            歸檔時間起
            <input type="datetime-local" value={crisisWindowStart} onChange={(e) => setCrisisWindowStart(e.target.value)} />
          </label>
          <label className="ops-field">
            歸檔時間迄
            <input type="datetime-local" value={crisisWindowEnd} onChange={(e) => setCrisisWindowEnd(e.target.value)} />
          </label>
          <p className="muted">
            依 <code>captured_at_client</code> 與{selectedZone ? `分區「${selectedZone.name}」` : '可見分區'}空間交集篩選；不影響 Contributor 回報。
          </p>
          <div className="ops-map-card-actions">
            <button type="button" onClick={saveCrisisMeta} disabled={busy}>
              儲存時間設定
            </button>
            <button type="button" onClick={runArchivePreview} disabled={busy}>
              預覽歸檔
            </button>
            <button type="button" onClick={runArchive} disabled={busy}>
              執行歸檔
            </button>
          </div>
          {preview && (
            <div className="ops-preview-box">
              <strong>預覽（3c）</strong>
              <p>符合 {preview.matched_count} 筆 · 已連結 {preview.already_linked_count} 筆</p>
              {preview.sample_report_ids.length > 0 && (
                <p className="muted">範例：{preview.sample_report_ids.slice(0, 5).join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {panel === 'users' && canManageUsers && (
        <div className="ops-map-card ops-map-card-wide">
          <button type="button" className="ops-map-card-close" onClick={() => setPanel(null)}>
            ×
          </button>
          <h3>人員管理</h3>
          <p className="muted">帳號僅分系統管理員／營運人員；Lead 與 Coordinator 依分區指派。</p>
          <div className="ops-user-create">
            <h4>新增營運人員</h4>
            <input className="ops-input" placeholder="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
            <input className="ops-input" type="password" placeholder="密碼（≥8）" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
            <input className="ops-input" placeholder="顯示名稱（選填）" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
            <button type="button" onClick={createUser} disabled={busy}>
              建立
            </button>
          </div>
          <div className="ops-user-assign">
            <h4>分區指派</h4>
            <select className="ops-input" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
              <option value="">選擇人員</option>
              {opsUsers.filter((u) => u.role !== 'system_admin').map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </select>
            <select className="ops-input" value={assignZoneId} onChange={(e) => setAssignZoneId(e.target.value)}>
              <option value="">選擇分區</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            <select className="ops-input" value={assignRole} onChange={(e) => setAssignRole(e.target.value as 'lead' | 'coordinator')}>
              <option value="coordinator">Coordinator（檢視／審核）</option>
              <option value="lead">Lead（編輯分區／歸檔）</option>
            </select>
            <button type="button" onClick={assignZoneToUser} disabled={busy}>
              指派
            </button>
          </div>
          <ul className="ops-users-list">
            {opsUsers.map((u) => (
              <li key={u.id}>
                <strong>{u.email}</strong>
                <span className="muted"> {roleLabel(u.role)}</span>
                {u.zone_assignments.length > 0 && (
                  <ul>
                    {u.zone_assignments.map((a) => (
                      <li key={`${u.id}-${a.zone_id}`}>
                        {a.zone_name ?? a.zone_id.slice(0, 8)} — {a.assignment_role}
                        {u.role !== 'system_admin' && (
                          <button type="button" className="linkish" onClick={() => unassignZone(u.id, a.zone_id)}>
                            移除
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
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
