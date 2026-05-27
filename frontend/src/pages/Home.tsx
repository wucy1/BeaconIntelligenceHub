import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiGet } from '../api';
import { useI18n } from '../i18n/I18nContext';

type Crisis = {
  id: string;
  slug: string;
  name: Record<string, string>;
};

export function Home() {
  const { t, crisisName } = useI18n();
  const [items, setItems] = useState<Crisis[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Crisis[]>('/v1/crises')
      .then(setItems)
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <section className="card">
        <p className="error">{t('home.loadError', { message: err })}</p>
        <p className="muted">{t('home.backendHint')}</p>
      </section>
    );
  }
  if (!items) return <p>{t('common.loading')}</p>;

  return (
    <section className="card">
      <h1>{t('home.title')}</h1>
      <ul className="list">
        {items.map((c) => (
          <li key={c.id}>
            <Link to={`/r/${c.id}/new`}>{crisisName(c.name, c.slug)}</Link>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/dashboard">{t('home.openDashboard')}</Link>
      </p>
    </section>
  );
}
