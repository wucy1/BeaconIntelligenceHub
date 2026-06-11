import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { useI18n } from '../i18n/I18nContext';
import { opsGet, opsPatch } from '../ops/opsApi';
import { getOpsUser, opsIsSystemAdmin } from '../ops/opsAuth';
import { setOpsDemoHostingHint } from '../ops/opsHosting';

type OrgSettings = {
  default_public_report_months: number;
  default_ops_view_months: number;
  show_demo_cold_start_hint: boolean;
};

export function OpsSettings() {
  const { t } = useI18n();
  const user = getOpsUser();
  const isAdmin = opsIsSystemAdmin(user);
  const [data, setData] = useState<OrgSettings | null>(null);
  const [publicMonths, setPublicMonths] = useState('2');
  const [opsMonths, setOpsMonths] = useState('2');
  const [demoHint, setDemoHint] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    opsGet<OrgSettings>('/v1/ops/settings')
      .then((s) => {
        setData(s);
        setPublicMonths(String(s.default_public_report_months));
        setOpsMonths(String(s.default_ops_view_months));
        setDemoHint(s.show_demo_cold_start_hint);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [isAdmin]);

  if (!user) return <Navigate to="/ops/login" replace />;
  if (!isAdmin) {
    return (
      <section className="card ops-dashboard">
        <p className="muted">{t('ops.settings.noAccess')}</p>
      </section>
    );
  }

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const body = {
        default_public_report_months: Number(publicMonths),
        default_ops_view_months: Number(opsMonths),
        show_demo_cold_start_hint: demoHint,
      };
      const s = await opsPatch<OrgSettings>('/v1/ops/settings', body);
      setData(s);
      setOpsDemoHostingHint(s.show_demo_cold_start_hint);
      setMsg(t('ops.settings.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data && !err) return <p className="muted">{t('common.loading')}</p>;

  return (
    <section className="card ops-dashboard">
      <header className="ops-dash-header">
        <h1>{t('ops.settings.title')}</h1>
        <p className="muted">{t('ops.settings.hint')}</p>
      </header>

      {err && <p className="error">{err}</p>}
      {msg && <p className="ops-form-ok">{msg}</p>}

      <label className="ops-field">
        {t('ops.settings.publicMonths')}
        <input
          className="ops-input"
          type="number"
          min={1}
          max={24}
          value={publicMonths}
          onChange={(e) => setPublicMonths(e.target.value)}
        />
      </label>
      <p className="muted ops-crisis-meta-hint">{t('ops.settings.publicMonthsHint')}</p>

      <label className="ops-field">
        {t('ops.settings.opsMonths')}
        <input
          className="ops-input"
          type="number"
          min={1}
          max={24}
          value={opsMonths}
          onChange={(e) => setOpsMonths(e.target.value)}
        />
      </label>
      <p className="muted ops-crisis-meta-hint">{t('ops.settings.opsMonthsHint')}</p>

      <label className="ops-field ops-field-inline">
        <input type="checkbox" checked={demoHint} onChange={(e) => setDemoHint(e.target.checked)} />
        <span>{t('ops.settings.demoHint')}</span>
      </label>

      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? t('ops.settings.saving') : t('ops.settings.save')}
      </button>
    </section>
  );
}
