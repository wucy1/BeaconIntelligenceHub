import { useEffect, useState } from 'react';

import { apiGet } from '../../api';
import { useI18n } from '../../i18n/I18nContext';

type ReportDetail = {
  id: string;
  damage_level: string;
  site_status?: string;
  captured_at_client: string;
  received_at_server: string;
  description: string;
  textual_location: string | null;
  infrastructure_types: string[];
  infrastructure_name: string;
  crisis_types: string[];
  debris_clearing_required: boolean;
  image_url: string | null;
  admin_reviewed?: boolean;
  admin_flagged?: boolean;
};

type Props = {
  reportId: string | null;
  onClose: () => void;
  onReviewed?: (reviewed: boolean) => void;
  onFlagged?: (flagged: boolean) => void;
  busy?: boolean;
  reviewed?: boolean;
  flagged?: boolean;
};

export function DashboardReviewModal({
  reportId,
  onClose,
  onReviewed,
  onFlagged,
  busy,
  reviewed,
  flagged,
}: Props) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) {
      setDetail(null);
      return;
    }
    setErr(null);
    apiGet<ReportDetail>(`/v1/reports/${reportId}?includeImageUrl=1`)
      .then(setDetail)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [reportId]);

  if (!reportId) return null;

  return (
    <div className="ops-review-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ops-review-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-review-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ops-review-modal-header">
          <h2 id="ops-review-modal-title">{t('dashboard.reviewModal.title')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
            ×
          </button>
        </header>

        {err && <p className="error">{err}</p>}
        {!detail && !err && <p className="muted">{t('common.loading')}</p>}

        {detail && (
          <div className="ops-review-modal-body">
            {detail.image_url && (
              <figure className="ops-review-modal-image">
                <img src={detail.image_url} alt="" />
              </figure>
            )}
            <dl className="ops-review-dl">
              <dt>{t('dashboard.col.damage')}</dt>
              <dd>{detail.damage_level}</dd>
              <dt>{t('dashboard.reviewModal.location')}</dt>
              <dd>{detail.textual_location || '—'}</dd>
              <dt>{t('dashboard.reviewModal.infrastructure')}</dt>
              <dd>
                {detail.infrastructure_name} ({detail.infrastructure_types.join(', ')})
              </dd>
              <dt>{t('dashboard.reviewModal.crisisTypes')}</dt>
              <dd>{detail.crisis_types.join(', ') || '—'}</dd>
              <dt>{t('dashboard.reviewModal.debris')}</dt>
              <dd>{detail.debris_clearing_required ? t('dashboard.reviewModal.yes') : t('dashboard.reviewModal.no')}</dd>
              <dt>{t('dashboard.col.time')}</dt>
              <dd>{new Date(detail.received_at_server).toLocaleString()}</dd>
              <dt>{t('dashboard.col.summary')}</dt>
              <dd>{detail.description}</dd>
            </dl>
            <p className="muted ops-review-modal-hint">{t('dashboard.reviewVsFlagHint')}</p>
            <div className="ops-review-modal-actions">
              <button type="button" disabled={busy} onClick={() => onReviewed?.(!reviewed)}>
                {reviewed ? t('dashboard.unreview') : t('dashboard.markReviewed')}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => onFlagged?.(!flagged)}>
                {flagged ? t('dashboard.unflag') : t('dashboard.flag')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
