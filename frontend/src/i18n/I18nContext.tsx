import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useState,

  type ReactNode,

} from 'react';



import ar from './locales/ar.json';

import de from './locales/de.json';

import en from './locales/en.json';

import es from './locales/es.json';

import fr from './locales/fr.json';

import pt from './locales/pt.json';

import ru from './locales/ru.json';

import zh from './locales/zh.json';

import zhHant from './locales/zh-Hant.json';



export const UI_LOCALES = ['en', 'zh-Hant', 'zh', 'de', 'pt', 'ar', 'fr', 'ru', 'es'] as const;

export type UiLocale = (typeof UI_LOCALES)[number];



const STORAGE_KEY = 'bih-ui-locale';



const bundles: Record<UiLocale, Record<string, string>> = {

  en,

  'zh-Hant': zhHant,

  zh,

  de,

  pt,

  ar,

  fr,

  ru,

  es,

};



function htmlLang(locale: UiLocale): string {

  if (locale === 'zh') return 'zh-Hans';

  if (locale === 'zh-Hant') return 'zh-Hant';

  return locale;

}



function detectDeviceLocale(): UiLocale {

  if (typeof navigator === 'undefined') return 'en';

  const candidates = navigator.languages?.length

    ? navigator.languages

    : [navigator.language];

  for (const raw of candidates) {

    const tag = raw.toLowerCase().replace(/_/g, '-');

    if (tag.startsWith('zh-tw') || tag.startsWith('zh-hk') || tag.startsWith('zh-hant')) {

      return 'zh-Hant';

    }

    if (tag.startsWith('zh')) return 'zh';

    if (tag.startsWith('de')) return 'de';

    if (tag.startsWith('pt')) return 'pt';

    if (tag.startsWith('ar')) return 'ar';

    if (tag.startsWith('fr')) return 'fr';

    if (tag.startsWith('ru')) return 'ru';

    if (tag.startsWith('es')) return 'es';

    if (tag.startsWith('en')) return 'en';

  }

  return 'en';

}



function interpolate(template: string, vars?: Record<string, string | number>): string {

  if (!vars) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));

}



type I18nContextValue = {

  locale: UiLocale;

  setLocale: (l: UiLocale) => void;

  t: (key: string, vars?: Record<string, string | number>) => string;

  crisisName: (name: Record<string, string>, slug: string) => string;

};



const I18nContext = createContext<I18nContextValue | null>(null);



export function I18nProvider({ children }: { children: ReactNode }) {

  const [locale, setLocaleState] = useState<UiLocale>(() => {

    const saved = localStorage.getItem(STORAGE_KEY) as UiLocale | null;

    if (saved && UI_LOCALES.includes(saved)) return saved;

    return detectDeviceLocale();

  });



  useEffect(() => {

    localStorage.setItem(STORAGE_KEY, locale);

    document.documentElement.lang = htmlLang(locale);

    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';

  }, [locale]);



  const setLocale = useCallback((l: UiLocale) => setLocaleState(l), []);



  const t = useCallback(

    (key: string, vars?: Record<string, string | number>) => {

      const msg = bundles[locale][key] ?? bundles.en[key] ?? key;

      return interpolate(msg, vars);

    },

    [locale],

  );



  const crisisName = useCallback(

    (name: Record<string, string>, slug: string) =>

      name[locale] ??

      name.en ??

      name['zh-Hant'] ??

      name['zh-Hans'] ??

      name.zh ??

      Object.values(name)[0] ??

      slug,

    [locale],

  );



  const value = useMemo(

    () => ({ locale, setLocale, t, crisisName }),

    [locale, setLocale, t, crisisName],

  );



  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;

}



export function useI18n() {

  const ctx = useContext(I18nContext);

  if (!ctx) throw new Error('useI18n must be used within I18nProvider');

  return ctx;

}


