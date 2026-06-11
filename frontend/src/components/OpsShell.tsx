import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '../i18n/I18nContext';
import { getOpsUser } from '../ops/opsAuth';
import { BihLogo } from './BihLogo';
import { OpsUserMenu } from './OpsUserMenu';
import { LanguageSwitcher } from './LanguageSwitcher';
import { OfflineBanner } from './OfflineBanner';

type Props = {
  children: ReactNode;
  /** 登入頁等窄版面板 */
  narrow?: boolean;
};

export function OpsShell({ children, narrow }: Props) {
  const { t } = useI18n();
  const user = getOpsUser();

  return (
    <div className="layout ops-layout">
      <header className="header ops-header">
        <BihLogo to={user ? '/ops' : '/ops/login'} />
        <nav className="ops-header-nav">
          {!narrow && (
            <>
              <Link to="/ops">{t('ops.nav.console')}</Link>
              <Link to="/ops/map">{t('ops.nav.map')}</Link>
              {user && <Link to="/dashboard">{t('ops.nav.dashboard')}</Link>}
              <Link to="/">{t('ops.nav.contributorMap')}</Link>
              <LanguageSwitcher />
            </>
          )}
          {user ? <OpsUserMenu /> : <Link to="/ops/login">{t('ops.nav.login')}</Link>}
        </nav>
      </header>
      <OfflineBanner />
      <main className="main ops-main-centered">
        <div className={`ops-center-panel${narrow ? ' ops-center-narrow' : ''}`}>{children}</div>
      </main>
    </div>
  );
}
