import { useI18n } from '../../i18n/I18nContext';

type Props = {
  onCancel: () => void;
};

/** Shown while map mode is "new" — one tap exits the whole reporting flow. */
export function NewReportBanner({ onCancel }: Props) {
  const { t } = useI18n();

  return (
    <div className="new-report-banner" role="status">
      <span className="new-report-banner-label">{t('map.newFlow.active')}</span>
      <button type="button" className="new-report-banner-cancel" onClick={onCancel}>
        {t('map.newFlow.cancel')}
      </button>
    </div>
  );
}
