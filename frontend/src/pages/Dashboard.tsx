import { useEffect, useState } from 'react';

import { apiBase } from '../api';
import { useI18n } from '../i18n/I18nContext';
import { opsGet, type OpsCrisis, type OpsZone } from '../ops/opsApi';
import {
  getOpsUser,
  opsHasStaffAccess,
  opsIsSystemAdmin,
  opsRoleLabel,
} from '../ops/opsAuth';
import { OPS_LABELS } from '../ops/opsLabels';

type ReportSummary = {
  id: string;
  crisis_id: string;
  building_id: string | null;
  damage_level: string;
  captured_at_client: string;
  received_at_server: string;
  geom: GeoJSON.Point | null;
  description_preview: string;
  admin_reviewed?: boolean;
  admin_flagged?: boolean;
};

type ListResp = { items: ReportSummary[]; nextCursor?: string | null; zone_scope?: string[] | null };

function crisisLabel(c: OpsCrisis): string {
  return c.name['zh-Hant'] ?? c.name.zh ?? c.name.en ?? c.slug;
}

export function Dashboard() {
  const { t } = useI18n();
  const opsUser = getOpsUser()!;
  const isAdmin = opsIsSystemAdmin(opsUser);
  const isLead = (opsUser.crisis_lead_assignments?.length ?? 0) > 0;
  const [data, setData] = useState<ListResp | null>(null);
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [crisisId, setCrisisId] = useState('');
  const [zoneId, setZoneId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        setCrisisId((prev) => (prev && d.items.some((c) => c.id === prev) ? prev : d.items[0]?.id ?? ''));
      })
      .catch(() => setCrises([]));
  }, []);

  useEffect(() => {
    if (!crisisId) {
      setZones([]);
      return;
    }
    opsGet<{ items: OpsZone[] }>(`/v1/ops/zones?crisis_id=${crisisId}`)
      .then((d) => setZones(d.items))
      .catch(() => setZones([]));
  }, [crisisId]);

  useEffect(() => {
    if (!crisisId) {
      setData({ items: [], zone_scope: [] });
      return;
    }
    const loadReports = async () => {
      try {
        const q = new URLSearchParams({ crisis_id: crisisId, limit: '100' });
        if (zoneId) q.set('zone_id', zoneId);
        const d = await opsGet<ListResp>(`/v1/ops/reports?${q}`);
        setData({ items: d.items, nextCursor: null, zone_scope: d.zone_scope });
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void loadReports();
  }, [zoneId, crisisId]);

  if (!opsHasStaffAccess(opsUser)) {
    return (
      <section className="card">
        <h1>{t('dashboard.title')}</h1>
        <p className="muted">您的帳號尚未被指派危機或分區，請聯絡系統管理員。</p>
      </section>
    );
  }

  if (err) {
    return (
      <section className="card">
        <p className="error">{err}</p>
      </section>
    );
  }
  if (!data) return <p>{t('common.loading')}</p>;

  const api = apiBase();
  const activeCrisis = crises.find((c) => c.id === crisisId);

  return (
    <section className="card ops-dashboard">
      <h1>{t('dashboard.title')}</h1>
      <p className="muted">
        {opsUser.email} · {opsRoleLabel(opsUser.role)}
        {isAdmin && ' · 可檢視全部危機'}
        {!isAdmin && isLead && ' · 可檢視所負責危機與分區回報'}
        {!isAdmin && !isLead && ' · 僅可檢視指派分區內回報'}
      </p>

      <section className="ops-dash-banner">
        <strong>營運審核</strong>
        <p className="muted">
          建立危機、指派人員請至 {OPS_LABELS.console}；畫分區與歸檔請至 {OPS_LABELS.map}。
          此頁供檢視與匯出您權限範圍內的回報。
        </p>
      </section>

      {crises.length > 0 && (
        <p>
          <label>
            危機{' '}
            <select
              value={crisisId}
              onChange={(e) => {
                setCrisisId(e.target.value);
                setZoneId('');
              }}
            >
              {crises.map((c) => (
                <option key={c.id} value={c.id}>
                  {crisisLabel(c)}
                </option>
              ))}
            </select>
          </label>
          {activeCrisis && <span className="muted" style={{ marginLeft: 8 }}>{activeCrisis.archive_status}</span>}
        </p>
      )}

      {crises.length === 0 && (
        <p className="muted">尚無可檢視的危機。{isAdmin ? `請至${OPS_LABELS.console}建立危機。` : '請聯絡管理員指派權限。'}</p>
      )}

      {zones.length > 0 && (
        <p>
          <label>
            分區篩選{' '}
            <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">（全部可見分區）</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          {data.zone_scope && (
            <span className="muted" style={{ marginLeft: 8 }}>
              範圍：{data.zone_scope.length} 個分區
            </span>
          )}
        </p>
      )}

      {crisisId && (
        <p>
          <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv`}>{t('dashboard.exportCsv')}</a> ·{' '}
          <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson`}>{t('dashboard.exportGeojson')}</a>
          {' · '}
          <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv&latest=1`}>{t('dashboard.exportLatestCsv')}</a>
          {' · '}
          <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson&latest=1`}>
            {t('dashboard.exportLatestGeojson')}
          </a>
        </p>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>{t('dashboard.col.time')}</th>
            <th>{t('dashboard.col.damage')}</th>
            <th>{t('dashboard.col.building')}</th>
            <th>{t('dashboard.col.summary')}</th>
            <th>審核</th>
            <th>{t('dashboard.col.image')}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.received_at_server).toLocaleString()}</td>
              <td>{r.damage_level}</td>
              <td>{r.building_id?.slice(0, 8) ?? '—'}</td>
              <td>{r.description_preview}</td>
              <td>
                {r.admin_reviewed ? '✓' : '—'}
                {r.admin_flagged ? ' ⚑' : ''}
              </td>
              <td>
                <a href={`${api}/v1/reports/${r.id}?includeImageUrl=1`} target="_blank" rel="noreferrer">
                  JSON
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className="muted">{t('dashboard.empty')}</p>}
    </section>
  );
}
