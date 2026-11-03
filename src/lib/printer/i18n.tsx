"use client";
/**
 * ============================================================================
 *  I18N — два языка (русский / английский).
 * ============================================================================
 *  • Язык выбирается автоматически по языку системы (navigator.languages:
 *    префикс "ru" → русский, иначе английский);
 *  • выбор можно поменять в «Настройках» (шестерёнка в шапке) — выбор
 *    сохраняется в localStorage (ключ mxw01-lang) и имеет приоритет;
 *  • t("ключ", {vars}) — словарь с интерполяцией {var}; словари лежат
 *    в ОТДЕЛЬНОЙ ПАПКЕ src/locales (ru.ts и en.ts) — текст не в коде;
 *  • текст вставляется в компоненты ЧЕРЕЗ ПРОПСЫ: страница получает
 *    { t, lang } из useI18n() и передаёт их вниз (t — пропс-переводчик);
 *  • plural(lang, n, ruForms, enForms) — формы множественного числа.
 *
 *  SSR/hydration: до монтирования всегда "ru" (детерминаированный рендер),
 *  реальный язык подставляется в useEffect — без рассинхрона гидратации.
 * ============================================================================
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { ru } from "@/locales/ru";
import { en } from "@/locales/en";

export type Lang = "ru" | "en";

const LANG_KEY = "mxw01-lang";

/** Определить язык системы: "ru*" → русский, иначе английский */
function detectLang(): Lang {
  if (typeof navigator === "undefined") return "ru";
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language ?? "",
  ];
  for (const raw of candidates) {
    if ((raw ?? "").toLowerCase().startsWith("ru")) return "ru";
  }
  return "en";
}

/* ------------------------------------------------------------------ */
/* Словари: импорт из отдельной папки локализации (src/locales)        */
/* ------------------------------------------------------------------ */

const DICTS: Record<Lang, Record<string, string>> = { ru, en };

/* ------------------------------------------------------------------ */
/* Контекст                                                            */
/* ------------------------------------------------------------------ */

export type Translator = (
  key: string,
  vars?: Record<string, string | number>
) => string;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translator;
}

const I18nContext = createContext<I18nValue | null>(null);

/* Внешний «стор» языка: localStorage + события storage (другие вкладки) */
const langListeners = new Set<() => void>();

function subscribeLang(cb: () => void): () => void {
  langListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    langListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getLangSnapshot(): Lang {
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    /* нет доступа к localStorage — определяем по системе */
  }
  return detectLang();
}

function getLangServerSnapshot(): Lang {
  return "ru";
}

function notifyLangListeners(): void {
  for (const cb of langListeners) cb();
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // useSyncExternalStore: SSR/гидратация — "ru", затем мгновенный переход
  // к сохранённому/системному языку без рассинхрона и без setState в эффекте
  const lang = useSyncExternalStore(
    subscribeLang,
    getLangSnapshot,
    getLangServerSnapshot
  );

  // <html lang="…"> — синхронизация с внешней системой (DOM), не setState
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* переполнение localStorage — выбор живёт до перезагрузки */
    }
    notifyLangListeners();
  }, []);

  const t = useCallback<Translator>(
    (key, vars) => {
      let s = DICTS[lang][key] ?? ru[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.split(`{${k}}`).join(String(v));
        }
      }
      return s;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/**
 * Формы множественного числа: ru — [один, два-четыре, много],
 * en — [один, остальные]. Пример: plural(lang, n, ["ценник","ценника","ценников"], ["label","labels"]).
 */
export function plural(
  lang: Lang,
  n: number,
  ru: [string, string, string],
  en: [string, string]
): string {
  if (lang === "en") return n === 1 ? en[0] : en[1];
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return ru[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return ru[1];
  return ru[2];
}
