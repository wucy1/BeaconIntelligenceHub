import { LOCALE_LABELS } from '../i18n/localeLabels';
import { UI_LOCALES, useI18n, type UiLocale } from '../i18n/I18nContext';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="lang-switcher">
      <span className="muted">{t('lang.label')}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as UiLocale)} aria-label={t('lang.label')}>
        {UI_LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
