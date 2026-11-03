/**
 * Счётчик израсходованной ленты.
 * После каждой успешной печати вызывающий код сообщает длину отправленного
 * изображения (мм = высота канваса / PX_PER_MM). Считается общий расход
 * (localStorage, «Настройки» → «Обслуживание») и расход текущей сессии
 * (в памяти). Драйвер печати не затрагивается — учёт ведёт сторона UI.
 * Паттерн — внешний стор useSyncExternalStore, как у label-size.
 */
import { useCallback, useSyncExternalStore } from "react";

const LS_KEY = "mxw01-tape-counter";

export interface TapeCounterState {
  totalMm: number;
}

const DEFAULT_STATE: TapeCounterState = { totalMm: 0 };

function readLS(): TapeCounterState {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<TapeCounterState>;
      if (p && typeof p.totalMm === "number" && Number.isFinite(p.totalMm) && p.totalMm >= 0) {
        return { totalMm: p.totalMm };
      }
    }
  } catch {
    /* битый JSON — начинаем с нуля */
  }
  return DEFAULT_STATE;
}

const listeners = new Set<() => void>();
let snapshotCache: TapeCounterState | null = null;

function notify(): void {
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent): void {
  if (!e.key || e.key === LS_KEY) {
    snapshotCache = null;
    notify();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): TapeCounterState {
  if (!snapshotCache) snapshotCache = readLS();
  return snapshotCache;
}

function getServerSnapshot(): TapeCounterState {
  return DEFAULT_STATE;
}

function write(s: TapeCounterState): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* переполнение localStorage — значение живёт до перезагрузки */
  }
  snapshotCache = s;
  notify();
}

/** Расход текущей сессии (в памяти, сбрасывается перезагрузкой страницы) */
let sessionMm = 0;

/** Отметить напечатанную длину (мм); вызывается после успешной печати */
export function notePrintedMm(mm: number): void {
  if (!(mm > 0) || !Number.isFinite(mm)) return;
  sessionMm += mm;
  const cur = getSnapshot();
  write({ totalMm: Math.round((cur.totalMm + mm) * 10) / 10 });
}

/** Сбросить общий и сессионный счётчик */
export function resetTapeCounter(): void {
  sessionMm = 0;
  write({ totalMm: 0 });
}

export function useTapeCounter(): TapeCounterState & { sessionMm: number } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...state, sessionMm };
}

/** Хук-хелпер: стабильная функция отметки печати */
export function useNotePrinted(): (mm: number) => void {
  return useCallback((mm: number) => notePrintedMm(mm), []);
}
