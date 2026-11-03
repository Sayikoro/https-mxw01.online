/**
 * ============================================================================
 *  ФЛАГ «ПОДДЕРЖКА POS (BETA)» — экспериментальная функция.
 * ============================================================================
 *  По умолчанию POS-печать (USB: ESC/POS и TSPL) скрыта целиком: нет типа
 *  «POS-USB» в списке принтера, нет USB-настроек и POS-диагностики. Включается
 *  свитчем «Поддержка POS (Beta)» в Настройках → раздел «Экспериментально»
 *  (localStorage mxw01-pos-beta, "1" — включено).
 *
 *  Паттерн — внешний стор useSyncExternalStore (как тема в theme.ts и язык
 *  в i18n): без setState в эффекте, синхронизация между вкладками по storage.
 *  Чтение флага вне React — readPosEnabled() (например, guard транспорта
 *  в usb-printer-context при монтировании).
 * ============================================================================
 */
import { useSyncExternalStore } from "react";

export const POS_BETA_KEY = "mxw01-pos-beta";

/** Чтение флага без React (guard при монтировании usb-контекста) */
export function readPosEnabled(): boolean {
  try {
    return window.localStorage.getItem(POS_BETA_KEY) === "1";
  } catch {
    /* нет localStorage — POS выключен */
    return false;
  }
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent): void {
  if (!e.key || e.key === POS_BETA_KEY) notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): boolean {
  return readPosEnabled();
}

function getServerSnapshot(): boolean {
  /* SSR/гидратация: POS выключен — как и язык до монтирования ("ru") */
  return false;
}

export function setPosEnabled(b: boolean): void {
  try {
    window.localStorage.setItem(POS_BETA_KEY, b ? "1" : "0");
  } catch {
    /* переполнение localStorage — флаг живёт до перезагрузки */
  }
  notify();
}

export function usePosFlag(): {
  posEnabled: boolean;
  setPosEnabled: (b: boolean) => void;
} {
  const posEnabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { posEnabled, setPosEnabled };
}
