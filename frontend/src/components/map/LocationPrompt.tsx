import { useI18n } from '../../i18n/I18nContext';

type Props = {
  open: boolean;
  onAllow: () => void;
  onSkip: () => void;
};

export function LocationPrompt({ open, onAllow, onSkip }: Props) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="location-prompt-backdrop" role="dialog" aria-modal="true">
      <div className="location-prompt">
        <h2>{t('map.location.title')}</h2>
        <p>{t('map.location.body')}</p>
        <div className="location-prompt-actions">
          <button type="button" onClick={onAllow}>
            {t('map.location.allow')}
          </button>
          <button type="button" className="secondary" onClick={onSkip}>
            {t('map.location.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
