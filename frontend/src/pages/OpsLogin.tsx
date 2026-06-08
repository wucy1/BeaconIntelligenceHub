import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { opsPost } from '../ops/opsApi';
import { setOpsSession, type OpsUserSession } from '../ops/opsAuth';

type LoginResp = {
  access_token: string;
  user: OpsUserSession;
};

export function OpsLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const data = await opsPost<LoginResp>('/v1/ops/auth/login', { email, password });
      setOpsSession(data.access_token, data.user);
      navigate('/ops/zones');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 420 }}>
      <h1>營運登入</h1>
      <p className="muted">
        Coordinator / Crisis lead / System admin · <Link to="/dashboard">儀表板</Link>
      </p>
      <form onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>密碼</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '登入中…' : '登入'}
        </button>
      </form>
    </section>
  );
}
