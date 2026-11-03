/**
 * ============================================================================
 *  КАЧЕСТВО ПРЕВЬЮ: «Быстрое» (1×) / «Точное (4×)».
 * ============================================================================
 *  «Быстрое» рисует превью ленты в одинарном разрешении — для слабых
 *  телефонов (меньше пикселей и работы на каждый ввод символа). Печать и
 *  сохранение страницы картинкой ВСЕГДА идут в полном 4× — раскладка
 *  страниц от качества не зависит, меняется только чёткость экрана.
 *
 *  Выбор хранится в localStorage (mxw01-preview-quality). Паттерн —
 *  внешний стор useSyncExternalStore (как тема и длина этикетки).
 * ============================================================================
 */
import { useSyncExternalStore } from "react";

export const PREVIEW_QUALITY_KEY = "mxw01-preview-quality";

export type PreviewQuality = "fast" | "exact";

function readLS(): PreviewQuality {
  try {
    const raw = window.localStorage.getItem(PREVIEW_QUALITY_KEY);
    if (raw === "fast" || raw === "exact") return raw;
  } catch {
    /* нет localStorage — точное */
  }
  return "exact";
}

const listeners = new Set<() => void>();
let snapshotCache: PreviewQuality | null = null;

function notify(): void {
  for (const cb of listeners) cb();
}

function onStorage(e: StorageEvent): void {
  if (!e.key || e.key === PREVIEW_QUALITY_KEY) {
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

function getSnapshot(): PreviewQuality {
  if (snapshotCache === null) snapshotCache = readLS();
  return snapshotCache;
}

function getServerSnapshot(): PreviewQuality {
  return "exact";
}

function write(s: PreviewQuality): void {
  try {
    window.localStorage.setItem(PREVIEW_QUALITY_KEY, s);
  } catch {
    /* переполнение localStorage — качество живёт до перезагрузки */
  }
  snapshotCache = s;
  notify();
}

export function setPreviewQuality(s: PreviewQuality): void {
  write(s);
}

export function usePreviewQuality(): {
  quality: PreviewQuality;
  setPreviewQuality: (s: PreviewQuality) => void;
} {
  const quality = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { quality, setPreviewQuality };
}
