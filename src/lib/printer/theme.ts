/**
 * ============================================================================
 *  ТЕМА ОФОРМЛЕНИЯ: светлая / тёмная / системная.
 * ============================================================================
 *  Тёмная гамма давно поддержана вёрсткой (классы dark:) — переключатель
 *  ставит класс dark на <html>. Выбор хранится в браузере
 *  (localStorage mxw01-theme); «Системная» следит за темой ОС
 *  (matchMedia change). До первой отрисовки тему ставит инлайн-скрипт
 *  в layout.tsx — без вспышки светлой темы на тёмной.
 *
 *  Паттерн — внешний стор useSyncExternalStore (как язык в i18n и длина
 *  этикетки в label-size): без setState в эффекте.
 * ============================================================================
 */
import { useSyncExternalStore } from "react";

export const THEME_KEY = "mxw01-theme";

export type ThemeSetting = "light" | "dark" | "system";
export const THEME_SETTINGS: readonly ThemeSetting[] = ["light", "dark", "system"];

function readLS(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* нет localStorage — системная */
  }
  return "system";
}

function readSystemDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

const listeners = new Set<() => void>();
let snapshotCache: ThemeSetting | null = null;

function notify(): void {
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent): void {
  if (!e.key || e.key === THEME_KEY) {
    snapshotCache = null;
    applyTheme(getSnapshot());
    notify();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", onStorage);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", onSystemChange);
  };
}

function onSystemChange(): void {
  if (getSnapshot() === "system") applyTheme("system");
}

function getSnapshot(): ThemeSetting {
  if (snapshotCache === null) snapshotCache = readLS();
  return snapshotCache;
}

function getServerSnapshot(): ThemeSetting {
  return "system";
}

/** Ставит/снимает класс dark на <html> по настройке и теме ОС */
export function applyTheme(setting: ThemeSetting): void {
  if (typeof document === "undefined") return;
  const dark = setting === "dark" || (setting === "system" && readSystemDark());
  document.documentElement.classList.toggle("dark", dark);
}

function write(s: ThemeSetting): void {
  try {
    window.localStorage.setItem(THEME_KEY, s);
  } catch {
    /* переполнение localStorage — тема живёт до перезагрузки */
  }
  snapshotCache = s;
  applyTheme(s);
  notify();
}

export function setTheme(s: ThemeSetting): void {
  write(s);
}

export function useTheme(): {
  theme: ThemeSetting;
  setTheme: (s: ThemeSetting) => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { theme, setTheme };
}
