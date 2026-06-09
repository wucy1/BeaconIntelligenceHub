import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiGet, apiBase } from '../api';
import { useI18n } from '../i18n/I18nContext';
import { opsGet, type OpsCrisis, type OpsZone } from '../ops/opsApi';
import { getOpsToken, getOpsUser, opsIsSystemAdmin } from '../ops/opsAuth';

const DEMO_CRISIS = 'a0000000-0000-0000-0000-000000000001';

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

type Analytics = {
  crisis_id: string;
  total_reports: number;
  latest_building_count: number;
  damage_counts: Record<string, number>;
};

function crisisLabel(c: OpsCrisis): string {
  return c.name['zh-Hant'] ?? c.name.zh ?? c.name.en ?? c.slug;
}

export function Dashboard() {
  const { t } = useI18n();
  const opsUser = getOpsUser();
  const opsToken = getOpsToken();
  const isAdmin = opsIsSystemAdmin(opsUser);
  const [data, setData] = useState<ListResp | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [crisisId, setCrisisId] = useState(DEMO_CRISIS);
  const [zoneId, setZoneId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [latestOnly, setLatestOnly] = useState(true);

  useEffect(() => {
    if (!opsToken) return;
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        if (d.items.length > 0) setCrisisId(d.items[0].id);
      })
      .catch(() => setCrises([]));
  }, [opsToken]);

  useEffect(() => {
    if (!opsToken) return;
    const q = crisisId ? `?crisis_id=${crisisId}` : '';
    opsGet<{ items: OpsZone[] }>(`/v1/ops/zones${q}`)
      .then((d) => setZones(d.items))
      .catch(() => setZones([]));
  }, [opsToken, crisisId]);

  useEffect(() => {
    const loadReports = async () => {
      try {
        if (opsToken) {
          const q = new URLSearchParams({ crisis_id: crisisId, limit: '100' });
          if (zoneId) q.set('zone_id', zoneId);
          const d = await opsGet<ListResp>(`/v1/ops/reports?${q}`);
          setData({ items: d.items, nextCursor: null, zone_scope: d.zone_scope });
          setErr(null);
        } else {
          const path = latestOnly
            ? `/v1/reports/latest?crisis_id=${DEMO_CRISIS}&limit=100`
            : `/v1/reports?crisis_id=${DEMO_CRISIS}&limit=100`;
          const d = await apiGet<ListResp>(path);
          setData(d);
          setErr(null);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    };
    loadReports();
    if (!opsToken) {
      apiGet<Analytics>(`/v1/analytics/summary?crisis_id=${DEMO_CRISIS}`)
        .then(setAnalytics)
        .catch(() => setAnalytics(null));
    } else {
      setAnalytics(null);
    }
  }, [latestOnly, opsToken, zoneId, crisisId]);

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
  const exportCrisisId = opsToken ? crisisId : DEMO_CRISIS;

  return (
    <section className="card">
      <h1>{t('dashboard.title')}</h1>
      <p>
        <Link to="/">{t('common.back')}</Link>
        {opsUser ? (
          <>
            {' '}
            · <Link to="/ops">營運控制台</Link> · <Link to="/ops/map">營運地圖</Link> · {opsUser.email} (
            {opsUser.role})
          </>
        ) : (
          <>
            {' '}
            · <Link to="/ops/login">營運登入</Link>
          </>
        )}
        {!opsToken && (
          <>
            {' '}
            ·{' '}
            <label>
              <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />{' '}
              {t('dashboard.latestView')}
            </label>
          </>
        )}
      </p>

      {opsToken && (
        <section className="ops-dash-banner">
          <strong>營運人員</strong>
          <p className="muted">
            建立危機、指派 Lead／Coordinator 請至{' '}
            <Link to="/ops">營運控制台</Link>；畫分區與歸檔請至 <Link to="/ops/map">營運地圖</Link>。
            {isAdmin && ' 您是系統管理員，可從控制台建立新危機。'}
          </p>
        </section>
      )}

      {opsToken && crises.length > 0 && (
        <p>
          <label>
            危機{' '}
            <select value={crisisId} onChange={(e) => { setCrisisId(e.target.value); setZoneId(''); }}>
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

      {opsToken && zones.length > 0 && (
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

      <p>
        <a href={`${api}/v1/export?crisis_id=${exportCrisisId}&format=csv`}>{t('dashboard.exportCsv')}</a> ·{' '}
        <a href={`${api}/v1/export?crisis_id=${exportCrisisId}&format=geojson`}>{t('dashboard.exportGeojson')}</a>
        {' · '}
        <a href={`${api}/v1/export?crisis_id=${exportCrisisId}&format=csv&latest=1`}>{t('dashboard.exportLatestCsv')}</a>
        {' · '}
        <a href={`${api}/v1/export?crisis_id=${exportCrisisId}&format=geojson&latest=1`}>
          {t('dashboard.exportLatestGeojson')}
        </a>
      </p>
      {!opsToken && (
        <p className="muted">
          {t('dashboard.crisisId')}: {DEMO_CRISIS}
        </p>
      )}

      {analytics && (
        <section className="analytics-box">
          <h2>{t('dashboard.analytics')}</h2>
          <p>
            {t('dashboard.totalReports')}: {analytics.total_reports} · {t('dashboard.latestBuildings')}:{' '}
            {analytics.latest_building_count}
          </p>
          <p>
            {t('dashboard.damageCounts')}:{' '}
            {Object.entries(analytics.damage_counts)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')}
          </p>
        </section>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>{t('dashboard.col.time')}</th>
            <th>{t('dashboard.col.damage')}</th>
            <th>{t('dashboard.col.building')}</th>
            <th>{t('dashboard.col.summary')}</th>
            {opsToken && <th>審核</th>}
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
              {opsToken && (
                <td>
                  {r.admin_reviewed ? '✓' : '—'}
                  {r.admin_flagged ? ' ⚑' : ''}
                </td>
              )}
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
