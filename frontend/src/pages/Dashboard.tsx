import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiBase } from '../api';
import { DashboardReviewModal } from '../components/ops/DashboardReviewModal';
import { useI18n } from '../i18n/I18nContext';
import { isManageableCrisis } from '../ops/crisisUtils';
import { opsGet, opsPatch, opsPost, type OpsCrisis, type OpsZone } from '../ops/opsApi';
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
  debris_clearing_required?: boolean;
  crisis_types?: string[];
  infrastructure_types?: string[];
};

type ListResp = { items: ReportSummary[]; nextCursor?: string | null; zone_scope?: string[] | null };

type ReviewFilter = 'all' | 'pending' | 'flagged' | 'reviewed';
type ReportView = 'crisis' | 'unspecified' | 'all';

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
  const [reportView, setReportView] = useState<ReportView>('crisis');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('pending');
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const manageableCrises = useMemo(() => crises.filter(isManageableCrisis), [crises]);

  const loadReports = useCallback(async () => {
    if (reportView === 'crisis' && !crisisId) {
      setData({ items: [], zone_scope: [] });
      return;
    }
    try {
      const q = new URLSearchParams({ limit: '200', view: reportView });
      if (reportView === 'crisis' && crisisId) q.set('crisis_id', crisisId);
      if (zoneId) q.set('zone_id', zoneId);
      const d = await opsGet<ListResp>(`/v1/ops/reports?${q}`);
      setData({ items: d.items, nextCursor: null, zone_scope: d.zone_scope });
      setSelectedIds(new Set());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [crisisId, zoneId, reportView]);

  useEffect(() => {
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        const manageable = d.items.filter(isManageableCrisis);
        setCrisisId((prev) =>
          prev && manageable.some((c) => c.id === prev) ? prev : manageable[0]?.id ?? '',
        );
      })
      .catch(() => setCrises([]));
  }, []);

  useEffect(() => {
    if (!crisisId || reportView !== 'crisis') {
      setZones([]);
      return;
    }
    opsGet<{ items: OpsZone[] }>(`/v1/ops/zones?crisis_id=${crisisId}`)
      .then((d) => setZones(d.items))
      .catch(() => setZones([]));
  }, [crisisId, reportView]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const listStats = useMemo(() => {
    if (!data) return null;
    const items = data.items;
    const damage_counts: Record<string, number> = {};
    const crisis_type_counts: Record<string, number> = {};
    let debris = 0;
    for (const r of items) {
      damage_counts[r.damage_level] = (damage_counts[r.damage_level] ?? 0) + 1;
      if (r.debris_clearing_required) debris += 1;
      for (const ct of r.crisis_types ?? []) {
        crisis_type_counts[ct] = (crisis_type_counts[ct] ?? 0) + 1;
      }
    }
    return {
      total: items.length,
      pending: items.filter((r) => !r.admin_reviewed).length,
      flagged: items.filter((r) => r.admin_flagged).length,
      debris,
      damage_counts,
      crisis_type_counts,
    };
  }, [data]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchReview = async (reviewed: boolean) => {
    if (selectedIds.size === 0) return;
    setBatchBusy(true);
    try {
      await opsPost('/v1/ops/reports/batch-review', {
        report_ids: [...selectedIds],
        reviewed,
      });
      await loadReports();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(false);
    }
  };

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

  const reviewRow = reviewId ? data?.items.find((r) => r.id === reviewId) : null;
  const damageMax = Math.max(1, ...Object.values(listStats?.damage_counts ?? {}));
  const crisisTypeMax = Math.max(1, ...Object.values(listStats?.crisis_type_counts ?? {}));

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
  const activeCrisis = manageableCrises.find((c) => c.id === crisisId);

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
        <p className="muted">{t('dashboard.archiveScopeHint')}</p>
      </section>

      <section className="ops-dash-section">
        <h2>{t('dashboard.filterTitle')}</h2>
        <div className="ops-review-tabs ops-dash-view-tabs">
          {(['crisis', 'unspecified', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={reportView === v ? 'ops-review-tab active' : 'ops-review-tab'}
              onClick={() => setReportView(v)}
            >
              {t(`dashboard.view.${v}`)}
            </button>
          ))}
        </div>
        {manageableCrises.length > 0 && reportView === 'crisis' && (
          <label className="ops-field ops-dash-crisis-field">
            {t('dashboard.crisisFilter')}
            <select
              className="ops-input"
              value={crisisId}
              onChange={(e) => {
                setCrisisId(e.target.value);
                setZoneId('');
              }}
            >
              {manageableCrises.map((c) => (
                <option key={c.id} value={c.id}>
                  {crisisName(c.name, c.slug)}
                </option>
              ))}
            </select>
          </label>
        )}
        {activeCrisis && reportView === 'crisis' && (
          <p className="muted">
            {t('dashboard.statusLabel')}: {activeCrisis.archive_status}
          </p>
        )}
        {reportView !== 'crisis' && (
          <p className="muted">{t(`dashboard.viewHint.${reportView}`)}</p>
        )}
        {zones.length > 0 && reportView === 'crisis' && (
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
        <p className="muted ops-review-hint">{t('dashboard.reviewVsFlagHint')}</p>
      </section>

      {listStats && (
        <section className="ops-dash-section ops-analytics-section">
          <h2>{t('dashboard.analytics')}</h2>
          <p className="muted">{t('dashboard.analyticsListHint')}</p>
          <div className="ops-analytics-stats">
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.totalReports')}</span>
              <strong>{listStats.total}</strong>
            </div>
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.pendingCount')}</span>
              <strong>{listStats.pending}</strong>
            </div>
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.flaggedCount')}</span>
              <strong>{listStats.flagged}</strong>
            </div>
            <div className="ops-stat-card">
              <span className="ops-stat-label">{t('dashboard.debrisCount')}</span>
              <strong>{listStats.debris}</strong>
            </div>
          </div>
          <h3 className="ops-analytics-sub">{t('dashboard.damageCounts')}</h3>
          <div className="ops-bar-chart">
            {Object.entries(listStats.damage_counts).map(([level, count]) => (
              <div key={level} className="ops-bar-row">
                <span>{level}</span>
                <div className="ops-bar-track">
                  <div className="ops-bar-fill" style={{ width: `${(count / damageMax) * 100}%` }} />
                </div>
                <span>{count}</span>
              </div>
            ))}
            {Object.keys(listStats.damage_counts).length === 0 && (
              <p className="muted">{t('dashboard.emptyFilter')}</p>
            )}
          </div>
          {Object.keys(listStats.crisis_type_counts).length > 0 && (
            <>
              <h3 className="ops-analytics-sub">{t('dashboard.crisisTypeCounts')}</h3>
              <div className="ops-bar-chart">
                {Object.entries(listStats.crisis_type_counts).map(([type, count]) => (
                  <div key={type} className="ops-bar-row">
                    <span>{type}</span>
                    <div className="ops-bar-track">
                      <div className="ops-bar-fill secondary" style={{ width: `${(count / crisisTypeMax) * 100}%` }} />
                    </div>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {crisisId && reportView === 'crisis' && (
        <section className="ops-dash-section">
          <h2>{t('dashboard.exportTitle')}</h2>
          <p className="muted">{t('dashboard.exportImageHint')}</p>
          <p className="ops-export-links">
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv`}>{t('dashboard.exportCsv')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson`}>{t('dashboard.exportGeojson')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv&latest=1`}>{t('dashboard.exportLatestCsv')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson&latest=1`}>
              {t('dashboard.exportLatestGeojson')}
            </a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv&reviewed_only=true`}>
              {t('dashboard.exportReviewedCsv')}
            </a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson&reviewed_only=true`}>
              {t('dashboard.exportReviewedGeojson')}
            </a>
          </p>
        </section>
      )}

      <section className="ops-dash-section">
        <h2>{t('dashboard.reviewQueueTitle')}</h2>
        {selectedIds.size > 0 && (
          <div className="ops-batch-actions">
            <span className="muted">{t('dashboard.batchSelected', { count: selectedIds.size })}</span>
            <button type="button" className="small" disabled={batchBusy} onClick={() => void batchReview(true)}>
              {t('dashboard.batchMarkReviewed')}
            </button>
            <button type="button" className="small secondary" disabled={batchBusy} onClick={() => void batchReview(false)}>
              {t('dashboard.batchUnreview')}
            </button>
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <div className="ops-table-wrap">
          <table className="table ops-table">
            <thead>
              <tr>
                <th aria-label={t('dashboard.col.select')} />
                <th>{t('dashboard.col.time')}</th>
                <th>{t('dashboard.col.damage')}</th>
                <th>{t('dashboard.col.building')}</th>
                <th>{t('dashboard.col.summary')}</th>
                <th>{t('dashboard.col.review')}</th>
                <th>{t('dashboard.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((r) => {
                const mapQ = new URLSearchParams();
                if (crisisId) mapQ.set('crisis_id', crisisId);
                mapQ.set('report_id', r.id);
                if (r.geom) {
                  mapQ.set('lat', String(r.geom.coordinates[1]));
                  mapQ.set('lng', String(r.geom.coordinates[0]));
                }
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        aria-label={t('dashboard.col.select')}
                      />
                    </td>
                    <td>{new Date(r.received_at_server).toLocaleString()}</td>
                    <td>{r.damage_level}</td>
                    <td>{r.building_id?.slice(0, 8) ?? '—'}</td>
                    <td>
                      <button type="button" className="linkish" onClick={() => setReviewId(r.id)}>
                        {r.description_preview}
                      </button>
                    </td>
                    <td>
                      {r.admin_reviewed ? '✓' : '—'}
                      {r.admin_flagged ? ' ⚑' : ''}
                    </td>
                    <td className="ops-table-actions">
                      <button type="button" className="small" onClick={() => setReviewId(r.id)}>
                        {t('dashboard.openReview')}
                      </button>
                      <Link to={`/ops/map?${mapQ}`} className="ops-dash-inline-link">
                        {t('dashboard.openOnMap')}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredItems.length === 0 && <p className="muted">{t('dashboard.emptyFilter')}</p>}
      </section>

      <DashboardReviewModal
        reportId={reviewId}
        reviewed={reviewRow?.admin_reviewed}
        flagged={reviewRow?.admin_flagged}
        busy={busyId === reviewId}
        onClose={() => setReviewId(null)}
        onReviewed={(v) => reviewId && void patchReport(reviewId, v, undefined)}
        onFlagged={(v) => reviewId && void patchReport(reviewId, undefined, v)}
      />
    </section>
  );
}
