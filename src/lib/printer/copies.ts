/**
 * ============================================================================
 *  КОПИИ И РАСКЛАДКА НА ЛЕНТЕ — слой приложения, драйвер не затрагивается.
 * ============================================================================
 *  Печать N копий без пропусков: копии собираются в ОДИН холст, который
 *  отправляется в printCanvas одним заданием — лента не протягивается между
 *  копиями, расход бумаги минимальный.
 *
 *  Два способа раскладки:
 *    • «stack» (столбик) — копии друг под другом; подходит всегда;
 *    • «row» (в ряд)     — копии рядом по горизонтали; доступно, только
 *      если копия УЖЕ narrower ленты (384 px), иначе в ряд не влезет.
 * ============================================================================
 */

/** Ширина печатающей головки — переиспользуем константу типов */
import { PRINTER_HEAD_WIDTH } from "./types";

export type CopiesLayout = "stack" | "row";

export interface CopiesSettings {
  /** Количество копий 1…COPIES_MAX */
  copies: number;
  /** Раскладка копий на ленте */
  layout: CopiesLayout;
  /** Промежуток между копиями, px */
  gap: number;
}

export const COPIES_MAX = 50;
export const COPIES_GAP_OPTIONS = [0, 8, 16, 24] as const;
export const DEFAULT_COPIES: CopiesSettings = { copies: 1, layout: "stack", gap: 8 };

export interface CopiesPlan {
  /** Копий по горизонтали в полном ряду */
  cols: number;
  /** Рядов по вертикали */
  rows: number;
  /** Размер итогового холста (ширина всегда = лента 384) */
  outW: number;
  outH: number;
}

/** Нормализовать количество копий */
export function clampCopies(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(COPIES_MAX, Math.round(n)));
}

/**
 * Чистая математика раскладки (тестируется без DOM).
 * Для «row» копия обязана быть уже ленты, иначе fallback на столбик.
 */
export function planCopies(
  srcW: number,
  srcH: number,
  copies: number,
  layout: CopiesLayout,
  gap: number,
  tapeWidth = PRINTER_HEAD_WIDTH
): CopiesPlan {
  const n = clampCopies(copies);
  const g = Math.max(0, Math.round(gap));
  if (layout === "row" && srcW > 0 && srcW < tapeWidth) {
    const cols = Math.max(1, Math.floor((tapeWidth + g) / (srcW + g)));
    const rows = Math.ceil(n / cols);
    return {
      cols,
      rows,
      outW: tapeWidth,
      outH: rows * srcH + (rows - 1) * g,
    };
  }
  return { cols: 1, rows: n, outW: tapeWidth, outH: n * srcH + (n - 1) * g };
}

/**
 * Собрать холст из N копий src на ленте (белый фон, копии по центру).
 * drawImage с выключенным сглаживанием: вход обычно строго бинарный —
 * пиксели копий не размываются.
 */
export function renderCopies(
  src: HTMLCanvasElement,
  settings: CopiesSettings,
  tapeWidth = PRINTER_HEAD_WIDTH
): HTMLCanvasElement {
  const n = clampCopies(settings.copies);
  const g = Math.max(0, Math.round(settings.gap));
  const plan = planCopies(src.width, src.height, n, settings.layout, g, tapeWidth);

  const canvas = document.createElement("canvas");
  canvas.width = plan.outW;
  canvas.height = Math.max(1, plan.outH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  for (let k = 0; k < n; k++) {
    let x: number;
    let y: number;
    if (plan.cols === 1) {
      // Столбик: копия по центру ленты по горизонтали
      x = Math.round((plan.outW - src.width) / 2);
      y = k * (src.height + g);
    } else {
      // В ряд: каждая строка копий центрируется отдельно (последняя может
      // быть неполной — центрируем её фактическую ширину)
      const row = Math.floor(k / plan.cols);
      const col = k % plan.cols;
      const rowCols =
        row === plan.rows - 1 ? n - plan.cols * (plan.rows - 1) : plan.cols;
      const rowW = rowCols * src.width + (rowCols - 1) * g;
      const x0 = Math.round((plan.outW - rowW) / 2);
      x = x0 + col * (src.width + g);
      y = row * (src.height + g);
    }
    ctx.drawImage(src, x, y);
  }
  return canvas;
}
