import { LOCALE_LABELS } from '../i18n/localeLabels';
import { UI_LOCALES, useI18n, type UiLocale } from '../i18n/I18nContext';

type Props = {
  /** 僅顯示下拉選單（如營運地圖頂欄） */
  compact?: boolean;
};

export function LanguageSwitcher({ compact = false }: Props) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`lang-switcher${compact ? ' lang-switcher-compact' : ''}`}>
      {!compact && <span className="muted">{t('lang.label')}</span>}
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
