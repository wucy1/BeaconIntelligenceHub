import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { UI_LOCALES, useI18n, type UiLocale } from '../i18n/I18nContext';
import { LOCALE_LABELS } from '../i18n/localeLabels';
import { opsGet, opsPatch } from '../ops/opsApi';
import { getOpsUser, setOpsSession, getOpsToken } from '../ops/opsAuth';

type MeProfile = {
  id: string;
  email: string;
  display_name: string | null;
  locale: string | null;
  phone: string | null;
  title: string | null;
  org_unit: string | null;
  role: string;
};

export function OpsProfile() {
  const { t, locale, setLocale } = useI18n();
  const user = getOpsUser();
  const [displayName, setDisplayName] = useState('');
  const [profileLocale, setProfileLocale] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [orgUnit, setOrgUnit] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    opsGet<MeProfile>('/v1/ops/me')
      .then((me) => {
        setDisplayName(me.display_name ?? '');
        setProfileLocale(me.locale ?? '');
        setPhone(me.phone ?? '');
        setTitle(me.title ?? '');
        setOrgUnit(me.org_unit ?? '');
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [user]);

  if (!user) return <Navigate to="/ops/login" replace />;

  const changePassword = async () => {
    if (newPassword.length < 8) {
      setPwdErr(t('ops.profile.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdErr(t('ops.profile.passwordMismatch'));
      return;
    }
    setPwdBusy(true);
    setPwdMsg(null);
    setPwdErr(null);
    try {
      await opsPatch('/v1/ops/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdMsg(t('ops.profile.passwordChanged'));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPwdErr(
        message.includes('401') || message.toLowerCase().includes('incorrect')
          ? t('ops.profile.passwordWrong')
          : message,
      );
    } finally {
      setPwdBusy(false);
    }
  };

  const save = async () => {
    const token = getOpsToken();
    if (!token) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const saved = await opsPatch<MeProfile>('/v1/ops/me', {
        display_name: displayName.trim() || null,
        locale: profileLocale || null,
        phone: phone.trim() || null,
        title: title.trim() || null,
        org_unit: orgUnit.trim() || null,
      });
      setOpsSession(token, {
        ...user,
        display_name: saved.display_name,
      });
      if (saved.locale && UI_LOCALES.includes(saved.locale as UiLocale)) {
        setLocale(saved.locale as UiLocale);
      }
      setMsg(t('ops.profile.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card ops-dashboard">
      <header className="ops-dash-header">
        <h1>{t('ops.profile.title')}</h1>
        <p className="muted">
          {user.email} · {t('ops.profile.currentLocale', { locale: LOCALE_LABELS[locale] })}
        </p>
      </header>

      {err && <p className="error">{err}</p>}
      {msg && <p className="ops-form-ok">{msg}</p>}

      <label className="ops-field">
        {t('ops.profile.displayName')}
        <input className="ops-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <label className="ops-field">
        {t('ops.profile.locale')}
        <select className="ops-input" value={profileLocale} onChange={(e) => setProfileLocale(e.target.value)}>
          <option value="">{t('ops.profile.localeDefault')}</option>
          {UI_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </label>

      <label className="ops-field">
        {t('ops.profile.phone')}
        <input className="ops-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      <label className="ops-field">
        {t('ops.profile.jobTitle')}
        <input className="ops-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="ops-field">
        {t('ops.profile.orgUnit')}
        <input className="ops-input" value={orgUnit} onChange={(e) => setOrgUnit(e.target.value)} />
      </label>

      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? t('ops.profile.saving') : t('ops.profile.save')}
      </button>

      <hr className="ops-profile-divider" />

      <h2>{t('ops.profile.passwordTitle')}</h2>
      {pwdErr && <p className="error">{pwdErr}</p>}
      {pwdMsg && <p className="ops-form-ok">{pwdMsg}</p>}

      <label className="ops-field">
        {t('ops.profile.currentPassword')}
        <input
          className="ops-input"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </label>

      <label className="ops-field">
        {t('ops.profile.newPassword')}
        <input
          className="ops-input"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>

      <label className="ops-field">
        {t('ops.profile.confirmPassword')}
        <input
          className="ops-input"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>

      <button
        type="button"
        disabled={pwdBusy || !currentPassword || !newPassword}
        onClick={() => void changePassword()}
      >
        {pwdBusy ? t('ops.profile.passwordSaving') : t('ops.profile.passwordSave')}
      </button>
    </section>
  );
}
