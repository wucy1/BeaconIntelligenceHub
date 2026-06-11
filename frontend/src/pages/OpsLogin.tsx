import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { useI18n } from '../i18n/I18nContext';
import { opsPost } from '../ops/opsApi';
import { getOpsToken, getOpsUser, setOpsSession, type OpsUserSession } from '../ops/opsAuth';

type LoginResp = {
  access_token: string;
  user: OpsUserSession;
};

export function OpsLogin() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (getOpsToken() && getOpsUser()) {
    return <Navigate to="/ops" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const data = await opsPost<LoginResp>('/v1/ops/auth/login', { email, password });
      setOpsSession(data.access_token, data.user);
      navigate('/ops');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card ops-login-card">
      <h1>{t('ops.login.title')}</h1>
      <p className="muted">
        {t('ops.login.hint')}{' '}
        <Link to="/">{t('ops.nav.contributorMap')}</Link>。
      </p>
      <form className="ops-login-form" onSubmit={onSubmit}>
        <label className="ops-field">
          <span>{t('ops.login.email')}</span>
          <input
            className="ops-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="ops-field">
          <span>{t('ops.login.password')}</span>
          <input
            className="ops-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="ops-login-actions">
          <button type="submit" disabled={busy}>
            {busy ? t('ops.login.submitting') : t('ops.login.submit')}
          </button>
        </div>
      </form>
    </section>
  );
}
