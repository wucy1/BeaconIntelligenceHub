import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '../i18n/I18nContext';

const DEMO_CRISIS = 'a0000000-0000-0000-0000-000000000001';
const TOKEN_KEY = 'bih-admin-token';

type AdminReport = {
  id: string;
  damage_level: string;
  received_at_server: string;
  description_preview: string;
  admin_reviewed: boolean;
  admin_flagged: boolean;
};

function adminHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  return token ? { 'X-Admin-Token': token } : {};
}

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${path}`, {
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function adminPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

export function Admin() {
  const { t } = useI18n();
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) ?? '');
  const [items, setItems] = useState<AdminReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    adminGet<{ items: AdminReport[] }>(`/v1/admin/reports?crisis_id=${DEMO_CRISIS}&limit=50`)
      .then((d) => {
        setItems(d.items);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  };

  useEffect(() => {
    if (token) load();
  }, []);

  const saveToken = () => {
    localStorage.setItem(TOKEN_KEY, token);
    load();
  };

  const mark = async (id: string, reviewed?: boolean, flagged?: boolean) => {
    await adminPatch(`/v1/admin/reports/${id}`, { reviewed, flagged });
    load();
  };

  return (
    <section className="card">
      <h1>{t('admin.title')}</h1>
      <p>
        <Link to="/dashboard">{t('nav.dashboard')}</Link>
      </p>
      <label className="field">
        <span>{t('admin.token')}</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <button type="button" onClick={saveToken}>
        {t('admin.login')}
      </button>
      {err && <p className="error">{err}</p>}
      {items && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('dashboard.col.time')}</th>
              <th>{t('dashboard.col.damage')}</th>
              <th>{t('dashboard.col.summary')}</th>
              <th>{t('admin.reviewedCol')}</th>
              <th>{t('admin.flaggedCol')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.received_at_server).toLocaleString()}</td>
                <td>{r.damage_level}</td>
                <td>{r.description_preview}</td>
                <td>{r.admin_reviewed ? '✓' : '—'}</td>
                <td>{r.admin_flagged ? '!' : '—'}</td>
                <td>
                  <button type="button" onClick={() => void mark(r.id, true, r.admin_flagged)}>
                    {t('admin.reviewed')}
                  </button>{' '}
                  <button type="button" onClick={() => void mark(r.id, r.admin_reviewed, true)}>
                    {t('admin.flagged')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
