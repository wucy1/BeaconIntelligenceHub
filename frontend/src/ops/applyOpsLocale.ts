import { detectDeviceLocale, UI_LOCALES, type UiLocale } from '../i18n/I18nContext';

export function resolveOpsProfileLocale(locale: string | null | undefined): UiLocale | null {
  if (!locale) return null;
  return UI_LOCALES.includes(locale as UiLocale) ? (locale as UiLocale) : null;
}

/** 僅在 profile 有明確語言時套用（營運地圖載入） */
export function applyOpsProfileLocaleIfSet(
  locale: string | null | undefined,
  setLocale: (l: UiLocale) => void,
): void {
  const loc = resolveOpsProfileLocale(locale);
  if (loc) setLocale(loc);
}

/** 儲存個人檔案後套用；null = 跟隨瀏覽器 */
export function applyOpsProfileLocale(
  locale: string | null | undefined,
  setLocale: (l: UiLocale) => void,
): void {
  const loc = resolveOpsProfileLocale(locale);
  setLocale(loc ?? detectDeviceLocale());
}
