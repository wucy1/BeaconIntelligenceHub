import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiGet, apiBase } from '../api';
import { useI18n } from '../i18n/I18nContext';

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
};

type ListResp = { items: ReportSummary[]; nextCursor: string | null };

type Analytics = {
  crisis_id: string;
  total_reports: number;
  latest_building_count: number;
  damage_counts: Record<string, number>;
};

export function Dashboard() {
  const { t } = useI18n();
  const [data, setData] = useState<ListResp | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [latestOnly, setLatestOnly] = useState(true);

  useEffect(() => {
    const path = latestOnly
      ? `/v1/reports/latest?crisis_id=${DEMO_CRISIS}&limit=100`
      : `/v1/reports?crisis_id=${DEMO_CRISIS}&limit=100`;
    apiGet<ListResp>(path)
      .then(setData)
      .catch((e: Error) => setErr(e.message));
    apiGet<Analytics>(`/v1/analytics/summary?crisis_id=${DEMO_CRISIS}`)
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [latestOnly]);

  if (err) {
    return (
      <section className="card">
        <p className="error">{err}</p>
      </section>
    );
  }
  if (!data) return <p>{t('common.loading')}</p>;

  const api = apiBase();

  return (
    <section className="card">
      <h1>{t('dashboard.title')}</h1>
      <p>
        <Link to="/">{t('common.back')}</Link> ·{' '}
        <label>
          <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />{' '}
          {t('dashboard.latestView')}
        </label>
      </p>
      <p>
        <a href={`${api}/v1/export?crisis_id=${DEMO_CRISIS}&format=csv`}>{t('dashboard.exportCsv')}</a> ·{' '}
        <a href={`${api}/v1/export?crisis_id=${DEMO_CRISIS}&format=geojson`}>{t('dashboard.exportGeojson')}</a>
        {' · '}
        <a href={`${api}/v1/export?crisis_id=${DEMO_CRISIS}&format=csv&latest=1`}>{t('dashboard.exportLatestCsv')}</a>
        {' · '}
        <a href={`${api}/v1/export?crisis_id=${DEMO_CRISIS}&format=geojson&latest=1`}>
          {t('dashboard.exportLatestGeojson')}
        </a>
      </p>
      <p className="muted">
        {t('dashboard.crisisId')}: {DEMO_CRISIS}
      </p>

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
