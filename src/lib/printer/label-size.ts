/**
 * Высота этикетки (длина ленты по направлению печати).
 *
 * Режимы:
 *  • «Авто» — высота растёт под содержимое (как раньше);
 *  • «Фиксированная» — точная высота в миллиметрах под типовые этикетки
 *    (30 / 40 / 50 / 90 мм) или своё значение — печать занимает ровно
 *    заданную длину ленты.
 *
 * Настройка глобальная («Настройки» → «Этикетка»), хранится в localStorage.
 * Пересчёт мм → точки печати: головка 203 DPI — 8 точек/мм, 384 точки =
 * 48 мм зоны печати (мм = px / 203 × 25.4) → PX_PER_MM = 8 точки/мм и по
 * длине ленты тоже (90 мм = 720 px).
 *
 * React: внешний стор через useSyncExternalStore (тот же паттерн, что у
 * языка в i18n) — SSR/гидратация детерминированно «Авто», затем мгновенный
 * переход к сохранённому значению без setState в эффекте.
 */
import { useCallback, useSyncExternalStore } from "react";
import { PX_PER_MM } from "./types";

export type LabelHeightMode = "auto" | "fixed";

export interface LabelSizeState {
  mode: LabelHeightMode;
  /** Высота в миллиметрах для режима fixed */
  heightMm: number;
}

export const LABEL_MM_MIN = 20;
export const LABEL_MM_MAX = 500;
export const LABEL_MM_PRESETS = [30, 40, 50, 90];
export const DEFAULT_LABEL_SIZE: LabelSizeState = { mode: "auto", heightMm: 90 };

const LS_KEY = "mxw01-label-size";

/** мм → пиксели холста печати (1 px = 1 точка головки, 203 DPI = 8 точек/мм) */
export function mmToLabelPx(mm: number): number {
  return Math.max(1, Math.floor(mm * PX_PER_MM));
}

export function clampLabelMm(mm: number): number {
  const v = Math.round(Number(mm));
  if (!Number.isFinite(v)) return DEFAULT_LABEL_SIZE.heightMm;
  return Math.min(LABEL_MM_MAX, Math.max(LABEL_MM_MIN, v));
}

function readLS(): LabelSizeState {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<LabelSizeState>;
      if (p && (p.mode === "auto" || p.mode === "fixed")) {
        return { mode: p.mode, heightMm: clampLabelMm(Number(p.heightMm)) };
      }
    }
  } catch {
    /* битый JSON — дефолт */
  }
  return DEFAULT_LABEL_SIZE;
}

/* ------------------------------------------------------------------ */
/* Внешний стор (useSyncExternalStore)                                 */
/* ------------------------------------------------------------------ */

const labelListeners = new Set<() => void>();

/** Кеш снапшота: Object.is-стабильность между изменениями */
let snapshotCache: LabelSizeState | null = null;

function notifyLabelListeners(): void {
  for (const cb of labelListeners) cb();
}

function onStorage(e: StorageEvent): void {
  if (!e.key || e.key === LS_KEY) {
    snapshotCache = null;
    notifyLabelListeners();
  }
}

function subscribeLabelSize(cb: () => void): () => void {
  labelListeners.add(cb);
  window.addEventListener("storage", onStorage);
  return () => {
    labelListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getLabelSizeSnapshot(): LabelSizeState {
  if (!snapshotCache) snapshotCache = readLS();
  return snapshotCache;
}

function getLabelSizeServerSnapshot(): LabelSizeState {
  return DEFAULT_LABEL_SIZE;
}

export function writeLabelSize(s: LabelSizeState): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* переполнение localStorage — значение живёт до перезагрузки */
  }
  snapshotCache = { ...s };
  notifyLabelListeners();
}

/** Хук состояния высоты этикетки: шапка (настройки) и вкладки синхронны */
export function useLabelSize(): [LabelSizeState, (s: LabelSizeState) => void] {
  const state = useSyncExternalStore(
    subscribeLabelSize,
    getLabelSizeSnapshot,
    getLabelSizeServerSnapshot
  );
  const update = useCallback((s: LabelSizeState) => {
    writeLabelSize(s);
  }, []);
  return [state, update];
}

/** Фиксированная высота в px печати (или null в режиме «Авто») */
export function labelFixedHeightPx(s: LabelSizeState): number | null {
  return s.mode === "fixed" ? mmToLabelPx(s.heightMm) : null;
}
