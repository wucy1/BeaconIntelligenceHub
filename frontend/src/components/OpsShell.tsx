import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { BihLogo } from './BihLogo';
import { OfflineBanner } from './OfflineBanner';
import { clearOpsSession, getOpsUser } from '../ops/opsAuth';
import { OPS_LABELS } from '../ops/opsLabels';

type Props = {
  children: ReactNode;
  /** 登入頁等窄版面板 */
  narrow?: boolean;
};

export function OpsShell({ children, narrow }: Props) {
  const user = getOpsUser();

  const logout = () => {
    clearOpsSession();
    window.location.href = '/ops/login';
  };

  return (
    <div className="layout ops-layout">
      <header className="header ops-header">
        <BihLogo to={user ? '/ops' : '/ops/login'} />
        <nav className="ops-header-nav">
          {!narrow && (
            <>
              <Link to="/ops">{OPS_LABELS.console}</Link>
              <Link to="/ops/map">{OPS_LABELS.map}</Link>
              {user && <Link to="/dashboard">{OPS_LABELS.dashboard}</Link>}
              <Link to="/">{OPS_LABELS.contributorMap}</Link>
            </>
          )}
          {user ? (
            <button type="button" className="ops-header-linkish" onClick={logout}>
              {OPS_LABELS.logout}
            </button>
          ) : (
            <Link to="/ops/login">{OPS_LABELS.login}</Link>
          )}
        </nav>
      </header>
      <OfflineBanner />
      <main className="main ops-main-centered">
        <div className={`ops-center-panel${narrow ? ' ops-center-narrow' : ''}`}>{children}</div>
      </main>
    </div>
  );
}
