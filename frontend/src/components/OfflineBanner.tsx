import { useEffect, useState } from 'react';

import { useI18n } from '../i18n/I18nContext';
import { countPending, syncQueue } from '../offline/queue';

export function OfflineBanner() {
  const { t } = useI18n();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = () => {
    void countPending().then(setPending);
  };

  useEffect(() => {
    refresh();
    const onOnline = () => {
      setOnline(true);
      void syncQueue().then(refresh);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const id = window.setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(id);
    };
  }, []);

  if (pending === 0 && online) return null;

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
