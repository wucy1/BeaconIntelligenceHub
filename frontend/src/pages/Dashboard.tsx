import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { apiBase } from '../api';
import { DashboardReviewModal } from '../components/ops/DashboardReviewModal';
import { useI18n } from '../i18n/I18nContext';
import { isManageableCrisis } from '../ops/crisisUtils';
import { buildOpsMapHref, savedReportToBrowseParams } from '../ops/opsBrowseParams';
import {
  opsDelete,
  opsGet,
  opsPatch,
  opsPost,
  type OpsArchiveSummary,
  type OpsCrisis,
  type OpsSavedReport,
  type OpsZoneSnapshot,
} from '../ops/opsApi';
import {
  getOpsUser,
  opsHasStaffAccess,
  opsIsCrisisLead,
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

type ListResp = {
  items: ReportSummary[];
  saved_report_id?: string | null;
  saved_report_name?: string | null;
  crisis_linked_count?: number | null;
  crisis_candidate_count?: number | null;
};

type ReviewFilter = 'all' | 'pending' | 'flagged' | 'reviewed';

function zoneVertexCount(geom: GeoJSON.Polygon): number {
  return geom.coordinates[0]?.length ?? 0;
}

function formatRange(from: string | null, to: string | null, openEnded: string): string {
  const f = from ? new Date(from).toLocaleString() : '—';
  const t = to ? new Date(to).toLocaleString() : openEnded;
  return `${f} ～ ${t}`;
}

function ZoneSnapshotList({ snapshots }: { snapshots: OpsZoneSnapshot[] }) {
  const { t } = useI18n();
  if (!snapshots.length) return null;
  return (
    <ul className="ops-zone-snapshot-list">
      {snapshots.map((z, i) => (
        <li key={z.zone_id ?? `snap-${i}`}>
          <span>{z.name}</span>
          <span className="muted">
            {' '}
            · {t('dashboard.zoneVertices', { count: zoneVertexCount(z.geom) })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const { t, crisisName } = useI18n();
  const opsUser = getOpsUser()!;
  const isAdmin = opsIsSystemAdmin(opsUser);
  const isLead = (opsUser.crisis_lead_assignments?.length ?? 0) > 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const crisisFromUrl = searchParams.get('crisis_id') ?? '';
  const savedFromUrl = searchParams.get('saved_report_id') ?? '';

  const [data, setData] = useState<ListResp | null>(null);
  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [crisisId, setCrisisId] = useState(crisisFromUrl);
  const [savedReports, setSavedReports] = useState<OpsSavedReport[]>([]);
  const [archiveSummary, setArchiveSummary] = useState<OpsArchiveSummary | null>(null);
  const [activeSavedId, setActiveSavedId] = useState(savedFromUrl || '');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('pending');
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const manageableCrises = useMemo(() => crises.filter(isManageableCrisis), [crises]);
  const activeCrisis = manageableCrises.find((c) => c.id === crisisId);
  const activeSaved = savedReports.find((s) => s.id === activeSavedId) ?? null;
  const canViewArchiveForCrisis = isAdmin || (crisisId ? opsIsCrisisLead(opsUser, crisisId) : false);

  const loadReports = useCallback(async () => {
    if (!activeSavedId) {
      setData({ items: [] });
      return;
    }
    try {
      const d = await opsGet<ListResp>(`/v1/ops/reports?saved_report_id=${activeSavedId}&limit=200`);
      setData(d);
      setSelectedIds(new Set());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [activeSavedId]);

  const loadSavedReports = useCallback(async () => {
    if (!crisisId) {
      setSavedReports([]);
      return;
    }
    try {
      const d = await opsGet<{ items: OpsSavedReport[] }>(
        `/v1/ops/saved-reports?crisis_id=${crisisId}&limit=100`,
      );
      setSavedReports(d.items);
    } catch {
      setSavedReports([]);
    }
  }, [crisisId]);

  const loadArchiveSummary = useCallback(async () => {
    if (!crisisId || (!isAdmin && !opsIsCrisisLead(opsUser, crisisId))) {
      setArchiveSummary(null);
      return;
    }
    try {
      const s = await opsGet<OpsArchiveSummary>(`/v1/ops/crises/${crisisId}/archive-summary`);
      setArchiveSummary(s);
    } catch {
      setArchiveSummary(null);
    }
  }, [crisisId, isAdmin, opsUser]);

  useEffect(() => {
    if (!savedFromUrl) return;
    opsGet<OpsSavedReport>(`/v1/ops/saved-reports/${savedFromUrl}`)
      .then((saved) => {
        setActiveSavedId(saved.id);
        if (saved.crisis_id) setCrisisId(saved.crisis_id);
      })
      .catch(() => undefined);
  }, [savedFromUrl]);

  useEffect(() => {
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        const manageable = d.items.filter(isManageableCrisis);
        setCrisisId((prev) =>
          prev && manageable.some((c) => c.id === prev)
            ? prev
            : crisisFromUrl && manageable.some((c) => c.id === crisisFromUrl)
              ? crisisFromUrl
              : manageable[0]?.id ?? '',
        );
      })
      .catch(() => setCrises([]));
  }, [crisisFromUrl]);

  useEffect(() => {
    void loadSavedReports();
    void loadArchiveSummary();
  }, [loadSavedReports, loadArchiveSummary]);

  useEffect(() => {
    if (!activeSavedId) return;
    if (savedReports.length > 0 && !savedReports.some((s) => s.id === activeSavedId)) {
      setActiveSavedId('');
    }
  }, [savedReports, activeSavedId]);

  useEffect(() => {
    if (activeSaved) {
      setReviewFilter(activeSaved.review_filter);
    }
  }, [activeSaved?.id, activeSaved?.review_filter]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (crisisId) q.set('crisis_id', crisisId);
    if (activeSavedId) q.set('saved_report_id', activeSavedId);
    const cur = searchParams.toString();
    const nxt = q.toString();
    if (cur !== nxt) setSearchParams(q, { replace: true });
  }, [crisisId, activeSavedId, searchParams, setSearchParams]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const selectSavedReport = (saved: OpsSavedReport) => {
    setActiveSavedId(saved.id);
    if (saved.crisis_id && saved.crisis_id !== crisisId) {
      setCrisisId(saved.crisis_id);
    }
  };

  const deleteSavedReport = async (id: string) => {
    if (!window.confirm(t('dashboard.savedReportDeleteConfirm'))) return;
    try {
      await opsDelete(`/v1/ops/saved-reports/${id}`);
      setSavedReports((prev) => prev.filter((r) => r.id !== id));
      if (activeSavedId === id) setActiveSavedId('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

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

  const mapHref = activeSaved
    ? buildOpsMapHref(savedReportToBrowseParams(activeSaved))
    : crisisId
      ? `/ops/map?crisis_id=${crisisId}`
      : '/ops/map';

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
        <Link to={mapHref} className="ops-dash-map-link">
          {t('dashboard.openMapView')}
        </Link>
      </header>

      <section className="ops-dash-section ops-dash-crisis-top">
        <h2>{t('dashboard.crisisFilter')}</h2>
        {manageableCrises.length > 0 ? (
          <label className="ops-field ops-dash-crisis-field">
            <select
              className="ops-input"
              value={crisisId}
              onChange={(e) => {
                setCrisisId(e.target.value);
                setActiveSavedId('');
              }}
            >
              {manageableCrises.map((c) => (
                <option key={c.id} value={c.id}>
                  {crisisName(c.name, c.slug)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted">{t('ops.map.noCrisis')}</p>
        )}
        {activeCrisis && (
          <p className="muted">
            {t('dashboard.statusLabel')}: {activeCrisis.archive_status}
          </p>
        )}
      </section>

      {activeCrisis && canViewArchiveForCrisis && archiveSummary && (
        <section className="ops-dash-section ops-archive-status-section">
          <h2>{t('dashboard.archiveStatusTitle')}</h2>
          <p className="muted">{t('dashboard.archiveStatusHint')}</p>
          <div className="ops-archive-status-grid">
            <div>
              <span className="ops-stat-label">{t('dashboard.officialWindow')}</span>
              <p>
                {formatRange(
                  archiveSummary.archive_window_start,
                  archiveSummary.archive_window_end,
                  t('dashboard.openEnded'),
                )}
              </p>
            </div>
            <div>
              <span className="ops-stat-label">{t('dashboard.officialZones')}</span>
              <p>{t('dashboard.zoneCount', { count: archiveSummary.zone_count })}</p>
            </div>
            <div>
              <span className="ops-stat-label">{t('dashboard.archiveLinkedTotal')}</span>
              <p>
                {t('dashboard.archiveLinkBreakdown', {
                  total: archiveSummary.linked_total,
                  auto: archiveSummary.linked_auto,
                  manual: archiveSummary.linked_manual,
                })}
              </p>
            </div>
            <div>
              <span className="ops-stat-label">{t('dashboard.archivePendingOfficial')}</span>
              <p>{archiveSummary.candidate_count}</p>
            </div>
          </div>
          {archiveSummary.last_manual_archive_at ? (
            <p className="ops-last-manual-archive">
              {t('dashboard.lastManualArchive', {
                time: new Date(archiveSummary.last_manual_archive_at).toLocaleString(),
                actor: archiveSummary.last_manual_archive_actor ?? '—',
                linked: archiveSummary.last_manual_archive_detail?.linked_count ?? 0,
                unlinked: archiveSummary.last_manual_archive_detail?.unlinked_count ?? 0,
              })}
            </p>
          ) : (
            <p className="muted">{t('dashboard.noManualArchiveYet')}</p>
          )}
          <Link to={`/ops/map?crisis_id=${crisisId}`} className="ops-dash-inline-link">
            {t('dashboard.openArchiveOnMap')}
          </Link>
        </section>
      )}

      <section className="ops-dash-section">
        <h2>{t('dashboard.queryTitle')}</h2>
        <p className="muted">{t('dashboard.querySavedOnlyHint')}</p>
        {savedReports.length === 0 ? (
          <p className="muted">{t('dashboard.savedReportsEmpty')}</p>
        ) : (
          <ul className="ops-saved-reports-list">
            {savedReports.map((saved) => (
              <li key={saved.id} className={activeSavedId === saved.id ? 'active' : ''}>
                <button type="button" className="ops-saved-report-btn" onClick={() => selectSavedReport(saved)}>
                  <strong>{saved.name}</strong>
                  <span className="muted">
                    {t(`dashboard.view.${saved.report_view}`)}
                    {' · '}
                    {formatRange(saved.browse_from, saved.browse_to, t('dashboard.openEnded'))}
                    {saved.snapshot_total != null && ` · ${saved.snapshot_total} ${t('dashboard.savedAtCount')}`}
                  </span>
                  {saved.zone_snapshots && saved.zone_snapshots.length > 0 && (
                    <ZoneSnapshotList snapshots={saved.zone_snapshots} />
                  )}
                  <span className="muted ops-saved-report-meta">
                    {saved.updated_at ? new Date(saved.updated_at).toLocaleString() : ''}
                    {saved.creator_email ? ` · ${saved.creator_email}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="small secondary"
                  onClick={() => void deleteSavedReport(saved.id)}
                >
                  {t('dashboard.savedReportDelete')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeSaved && (
          <div className="ops-active-saved-detail">
            <strong>{t('dashboard.activeSavedReport', { name: activeSaved.name })}</strong>
            {activeSaved.zone_snapshots && activeSaved.zone_snapshots.length > 0 && (
              <p className="muted">{t('dashboard.frozenZoneBoundaries')}</p>
            )}
          </div>
        )}
      </section>

      {!activeSavedId && (
        <p className="muted ops-dash-pick-saved">{t('dashboard.pickSavedReportHint')}</p>
      )}

      {activeSavedId && listStats && (
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

      {crisisId && activeSavedId && (
        <section className="ops-dash-section">
          <h2>{t('dashboard.exportTitle')}</h2>
          <p className="muted">{t('dashboard.exportImageHint')}</p>
          <p className="ops-export-links">
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=csv`}>{t('dashboard.exportCsv')}</a>
            <a href={`${api}/v1/export?crisis_id=${crisisId}&format=geojson`}>{t('dashboard.exportGeojson')}</a>
          </p>
        </section>
      )}

      {activeSavedId && (
        <section className="ops-dash-section">
          <h2>{t('dashboard.reviewQueueTitle')}</h2>
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
          {selectedIds.size > 0 && (
            <div className="ops-batch-actions">
              <span className="muted">{t('dashboard.batchSelected', { count: selectedIds.size })}</span>
              <button type="button" className="small" disabled={batchBusy} onClick={() => void batchReview(true)}>
                {t('dashboard.batchMarkReviewed')}
              </button>
              <button
                type="button"
                className="small secondary"
                disabled={batchBusy}
                onClick={() => void batchReview(false)}
              >
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
                  const browse = activeSaved ? savedReportToBrowseParams(activeSaved) : null;
                  const extra: Record<string, string> = { report_id: r.id };
                  if (r.geom) {
                    extra.lat = String(r.geom.coordinates[1]);
                    extra.lng = String(r.geom.coordinates[0]);
                  }
                  const rowMapHref = browse ? buildOpsMapHref(browse, extra) : mapHref;
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
                        <Link to={rowMapHref} className="ops-dash-inline-link">
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
      )}

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
