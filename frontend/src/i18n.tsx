/**
 * English / Turkish interface text. English is the default; the choice is remembered per browser
 * (localStorage) and can be preset with `?lang=tr` / `?lang=en`.
 *
 * Changing the language only changes wording and units, never the analysis values or the request
 * sent to the API (same rule as the Public / Engineer mode switch).
 *
 * Components read strings with `useStrings(STR)`, where `STR = defineStrings({ en: {...}, tr: {...} })`
 * is declared next to the component; the `tr` object must have exactly the keys and types of `en`.
 * Non-React helpers (formatting, error catalog, Plotly figure builders) call `getLang()` / `pick()`;
 * the provider keeps that value in sync and `App` re-renders the whole tree when it changes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'tr';
export const LANGS: readonly Lang[] = ['en', 'tr'];
export const DEFAULT_LANG: Lang = 'en';
export const LANG_STORAGE_KEY = 'lunar-analyzer.lang';

export interface Localized<T> {
  en: T;
  tr: T;
}

/** Declares one value per language; `tr` is checked against the shape inferred from `en`. */
export function defineStrings<T>(strings: { en: T; tr: NoInfer<T> }): Localized<T> {
  return strings;
}

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'tr';
}

/** `?lang=` in the URL wins, then the stored choice, then English. Storage may be blocked. */
export function initialLang(): Lang {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
    if (isLang(fromUrl)) return fromUrl;
  } catch { /* no URL available */ }
  try {
    const stored = globalThis.localStorage?.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch { /* storage blocked */ }
  return DEFAULT_LANG;
}

let currentLang: Lang = DEFAULT_LANG;

/** Language for non-React helpers. Outside an `I18nProvider` this is English. */
export function getLang(): Lang {
  return currentLang;
}

function setCurrentLang(lang: Lang): void {
  currentLang = lang;
}

/** Test helper: back to the default language between tests. */
export function resetLangForTests(): void {
  setCurrentLang(DEFAULT_LANG);
}

/** Picks the value for `lang` (default: the current language). */
export function pick<T>(values: Localized<T>, lang: Lang = currentLang): T {
  return values[lang];
}

interface LangCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangCtx | null>(null);

export function I18nProvider({ children, lang: forcedLang }: { children: ReactNode; lang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const first = forcedLang ?? initialLang();
    setCurrentLang(first);
    return first;
  });
  const setLang = useCallback((next: Lang) => {
    setCurrentLang(next);
    setLangState(next);
  }, []);
  useEffect(() => {
    setCurrentLang(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch { /* storage blocked: the choice simply is not remembered */ }
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

const NO_PROVIDER: LangCtx = { lang: DEFAULT_LANG, setLang: () => {} };

export function useLang(): LangCtx {
  return useContext(LangContext) ?? NO_PROVIDER;
}

/** Strings of the current language; the component re-renders when the language changes. */
export function useStrings<T>(strings: Localized<T>): T {
  return strings[useLang().lang];
}
