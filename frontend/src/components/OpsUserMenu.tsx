import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '../i18n/I18nContext';
import { clearOpsSession, getOpsUser, opsIsSystemAdmin } from '../ops/opsAuth';

type Props = {
  className?: string;
  compact?: boolean;
};

export function OpsUserMenu({ className, compact }: Props) {
  const { t } = useI18n();
  const user = getOpsUser();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isAdmin = opsIsSystemAdmin(user);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;

  const logout = () => {
    clearOpsSession();
    window.location.href = '/ops/login';
  };

  const label = user.display_name?.trim() || user.email;

  return (
    <div ref={rootRef} className={`ops-user-menu${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="ops-user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="ops-user-menu-name">{label}</span>
        {!compact && <span className="ops-user-menu-caret" aria-hidden />}
      </button>
      {open && (
        <div className="ops-user-menu-dropdown" role="menu">
          <Link to="/ops/profile" role="menuitem" onClick={() => setOpen(false)}>
            {t('ops.userMenu.profile')}
          </Link>
          {isAdmin && (
            <Link to="/ops/settings" role="menuitem" onClick={() => setOpen(false)}>
              {t('ops.userMenu.settings')}
            </Link>
          )}
          <button type="button" role="menuitem" onClick={logout}>
            {t('ops.nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
