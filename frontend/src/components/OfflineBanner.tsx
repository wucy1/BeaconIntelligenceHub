import { useEffect, useState } from 'react';

import { useI18n } from '../i18n/I18nContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { countPending, syncQueue } from '../offline/queue';

type Props = {
  /** 地圖頁：僅在有待同步回報時顯示（連線狀態由地圖右上角燈號負責） */
  mapPage?: boolean;
};

export function OfflineBanner({ mapPage = false }: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const online = useOnlineStatus();

  const refresh = () => {
    void countPending().then(setPending);
  };

  useEffect(() => {
    refresh();
    if (online) {
      void syncQueue().then(refresh);
    }
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [online]);

  if (mapPage && pending === 0) return null;
  if (!mapPage && pending === 0 && online) return null;

  return (
    <div className="offline-banner">
      {!online && <span className="offline-dot" title="offline" />}
      {pending > 0 && <span>{t('offline.pending', { count: pending })}</span>}
      {pending > 0 && online && (
        <button
          type="button"
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            void syncQueue()
              .then(refresh)
              .finally(() => setSyncing(false));
          }}
        >
          {syncing ? t('offline.syncing') : t('offline.sync')}
        </button>
      )}
    </div>
  );
}
