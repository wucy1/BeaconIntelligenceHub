import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiBase, apiGet } from '../api';
import { useI18n } from '../i18n/I18nContext';
import { opsGet, opsPatch, type OpsCrisis, type OpsZone } from '../ops/opsApi';
import {
  getOpsUser,
  opsHasStaffAccess,
  opsIsSystemAdmin,
  opsRoleLabel,
} from '../ops/opsAuth';

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

type ReviewFilter = 'all' | 'pending' | 'flagged' | 'reviewed';

type AnalyticsSummary = {
  total_reports: number;
  latest_building_count: number;
  damage_counts: Record<string, number>;
  timeline: Array<{ day: string; count: number }>;
};

export function Dashboard() {
  const { t, crisisName } = useI18n();
  const opsUser = getOpsUser()!;
  const isAdmin = opsIsSystemAdmin(opsUser);
  const isLead = (opsUser.crisis_lead_assignments?.length ?? 0) > 0;
  const [data, setData] = useState<ListResp | null>(null);
  const [zones, setZones] = useState<OpsZone[]>([]);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [crisisId, setCrisisId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('pending');
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!crisisId) {
      setData({ items: [], zone_scope: [] });
      return;
    }
    try {
      const q = new URLSearchParams({ crisis_id: crisisId, limit: '200' });
      if (zoneId) q.set('zone_id', zoneId);
      const d = await opsGet<ListResp>(`/v1/ops/reports?${q}`);
      setData({ items: d.items, nextCursor: null, zone_scope: d.zone_scope });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [crisisId, zoneId]);

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
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!crisisId) {
      setAnalytics(null);
      return;
    }
    apiGet<AnalyticsSummary>(`/v1/analytics/summary?crisis_id=${crisisId}`)
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [crisisId]);

  const patchReport = async (id: string, reviewed?: boolean, flagged?: boolean) => {
    setBusyId(id);
    try {
      await opsPatch(`/v1/ops/reports/${id}`, { reviewed, flagged });
      await loadReports();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter((r) => {
      if (reviewFilter === 'pending') return !r.admin_reviewed;
      if (reviewFilter === 'reviewed') return Boolean(r.admin_reviewed);
      if (reviewFilter === 'flagged') return Boolean(r.admin_flagged);
      return true;
    });
  }, [data, reviewFilter]);

  if (!opsHasStaffAccess(opsUser)) {
    return (
      <section className="card ops-dashboard">
        <header className="ops-dash-header">
          <h1>{t('dashboard.title')}</h1>
        </header>
        <p className="muted">{t('dashboard.noAccess')}</p>
      </section>
    );
  }

  if (err && !data) {
    return (
      <section className="card ops-dashboard">
        <p className="error">{err}</p>
      </section>
    );
  }
  if (!data) return <p className="muted">{t('common.loading')}</p>;

  const api = apiBase();
  const activeCrisis = crises.find((c) => c.id === crisisId);
  const damageMax = Math.max(1, ...Object.values(analytics?.damage_counts ?? {}));
  const timelineMax = Math.max(1, ...(analytics?.timeline ?? []).map((x) => x.count));

  return (
    <section className="card ops-dashboard">
      <header className="ops-dash-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className="muted">
            {opsUser.email} · {opsRoleLabel(opsUser.role)}
            {isAdmin && ` · ${t('dashboard.scopeAdmin')}`}
            {!isAdmin && isLead && ` · ${t('dashboard.scopeLead')}`}
            {!isAdmin && !isLead && ` · ${t('dashboard.scopeCoord')}`}
          </p>
        </div>
      </header>

      <section className="ops-dash-banner">
        <strong>{t('dashboard.reviewBannerTitle')}</strong>
        <p className="muted">
          {t('dashboard.reviewBannerHint', {
            console: t('ops.nav.console'),
            map: t('ops.nav.map'),
          })}
        </p>
      </section>

      <section className="ops-dash-section">
        <h2>{t('dashboard.filterTitle')}</h2>
        {crises.length > 0 && (
          <label className="ops-field">
            {t('dashboard.crisisFilter')}
            <select
              className="ops-input"
              value={crisisId}
              onChange={(e) => {
                setCrisisId(e.target.value);
                setZoneId('');
              }}
            >
              {crises.map((c) => (
                <option key={c.id} value={c.id}>
                  {crisisName(c.name, c.slug)}
                </option>
              ))}
            </select>
          </label>
        )}
        {activeCrisis && (
          <p className="muted">
            {t('dashboard.statusLabel')}: {activeCrisis.archive_status}
          </p>
        )}
        {zones.length > 0 && (
          <label className="ops-field">
            {t('dashboard.zoneFilter')}
            <select className="ops-input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">{t('dashboard.allZones')}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ops-review-tabs">
          {(['pending', 'flagged', 'reviewed', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={reviewFilter === f ? 'ops-review-tab active' : 'ops-review-tab'}
              onClick={() => setReviewFilter(f)}
            >
              {t(`dashboard.reviewFilter.${f}`)}
            </button>
          ))}
        </div>
      </section>

      {analytics && crisisId && (
        <section className="ops-dash-section ops-analytics-section">
          <h2>{t('dashboard.analytics')}</h2>
          <div className="ops-analytics-stats">
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.totalReports')}</span>
              <strong>{analytics.total_reports}</strong>
            </div>
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.latestBuildings')}</span>
              <strong>{analytics.latest_building_count}</strong>
            </div>
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.pendingCount')}</span>
              <strong>{data.items.filter((r) => !r.admin_reviewed).length}</strong>
            </div>
          </div>
          <h3 className="ops-analytics-sub">{t('dashboard.damageCounts')}</h3>
          <div className="ops-bar-chart">
            {Object.entries(analytics.damage_counts).map(([level, count]) => (
              <div key={level} className="ops-bar-row">
                <span>{level}</span>
                <div className="ops-bar-track">
                  <div className="ops-bar-fill" style={{ width: `${(count / damageMax) * 100}%` }} />
                </div>
                <span>{count}</span>
              </div>
            ))}
          </div>
          {analytics.timeline.length > 0 && (
            <>
              <h3 className="ops-analytics-sub">{t('dashboard.timeline')}</h3>
              <div className="ops-timeline-chart">
                {analytics.timeline.slice(-14).map((pt) => (
                  <div key={pt.day} className="ops-timeline-col" title={`${pt.day}: ${pt.count}`}>
                    <div
                      className="ops-timeline-bar"
                      style={{ height: `${(pt.count / timelineMax) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {crisisId && (
        <section className="ops-dash-section">
          <h2>{t('dashboard.exportTitle')}</h2>
          <p className="ops-export-links">
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv`}>{t('dashboard.exportCsv')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson`}>{t('dashboard.exportGeojson')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv&latest=1`}>{t('dashboard.exportLatestCsv')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson&latest=1`}>
              {t('dashboard.exportLatestGeojson')}
            </a>
          </p>
        </section>
      )}

      <section className="ops-dash-section">
        <h2>{t('dashboard.reviewQueueTitle')}</h2>
        {err && <p className="error">{err}</p>}
        <div className="ops-table-wrap">
          <table className="table ops-table">
            <thead>
              <tr>
                <th>{t('dashboard.col.time')}</th>
                <th>{t('dashboard.col.damage')}</th>
                <th>{t('dashboard.col.building')}</th>
                <th>{t('dashboard.col.summary')}</th>
                <th>{t('dashboard.col.review')}</th>
                <th>{t('dashboard.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.received_at_server).toLocaleString()}</td>
                  <td>{r.damage_level}</td>
                  <td>{r.building_id?.slice(0, 8) ?? '—'}</td>
                  <td>{r.description_preview}</td>
                  <td>
                    {r.admin_reviewed ? '✓' : '—'}
                    {r.admin_flagged ? ' ⚑' : ''}
                  </td>
                  <td className="ops-table-actions">
                    <button
                      type="button"
                      className="small"
                      disabled={busyId === r.id}
                      onClick={() => void patchReport(r.id, !r.admin_reviewed, undefined)}
                    >
                      {r.admin_reviewed ? t('dashboard.unreview') : t('dashboard.markReviewed')}
                    </button>
                    <button
                      type="button"
                      className="small secondary"
                      disabled={busyId === r.id}
                      onClick={() => void patchReport(r.id, undefined, !r.admin_flagged)}
                    >
                      {r.admin_flagged ? t('dashboard.unflag') : t('dashboard.flag')}
                    </button>
                    <Link to={`/ops/map?crisis_id=${crisisId}`} className="ops-dash-inline-link">
                      {t('dashboard.openOnMap')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredItems.length === 0 && <p className="muted">{t('dashboard.emptyFilter')}</p>}
      </section>
    </section>
  );
}
