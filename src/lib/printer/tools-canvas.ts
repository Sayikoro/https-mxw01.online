/**
 * Канвас-база инструментов: композиция ленты из фрагментов (pieces),
 * перенос строк, пунктирные линии, нарезка длинной ленты на страницы ≤ 90 мм.
 * Рисование идёт в 4× суперсэмплинге (canvas-quality.ts) с финальной
 * бинаризацией — печать строго ч/б, «печать = превью», драйвер не изменяется.
 * - чистая геометрия без React; данные инструментов — в tools-data.ts,
 *   рендереры конкретных инструментов — в tools-render.ts -
 */
import { PRINTER_HEAD_WIDTH, TAPE_PAGE_MAX_PX } from "./types";
import { createSupersampledCanvas, finalizePrintCanvas } from "./canvas-quality";

/** Ширина ленты печати (px головки) */
export const TOOL_WIDTH = PRINTER_HEAD_WIDTH;
/** Базовый шрифт инструментов (как в ценниках — системный sans-serif) */
export const TOOL_FONT = "sans-serif";
/** Боковые поля макета */
export const TOOL_MARGIN_X = 14;
/** Цвет печати — всегда чёрный (белое не печатается физически) */
export const TOOL_INK = "#000000";

/* ------------------------------------------------------------------ */
/* Измерение и перенос строк                                           */
/* ------------------------------------------------------------------ */

let measureCtxRef: CanvasRenderingContext2D | null = null;

/** Общий контекст измерения текста (вне DOM, 1×) */
export function measureCtx(): CanvasRenderingContext2D {
  if (!measureCtxRef) {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    measureCtxRef = c.getContext("2d") as CanvasRenderingContext2D;
  }
  return measureCtxRef;
}

/**
 * Перенос текста по ширине: уважает явные \n, длинные слова рубит по буквам.
 * Контекст должен уже иметь нужный font.
 */
export function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      // пустая строка абзаца — явный перевод строки
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Усечь строку до ширины с многоточием (для однострочных подписей) */
export function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

/* ------------------------------------------------------------------ */
/* Композиция ленты из фрагментов                                      */
/* ------------------------------------------------------------------ */

export interface ToolPiece {
  /** Высота фрагмента в логических px */
  height: number;
  /** Нарисовать фрагмент с верхним левым углом в (x, y); w — ширина ленты */
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => void;
}

export interface ToolComposeResult {
  /** Готовый бинарный канвас 384×H */
  canvas: HTMLCanvasElement;
  /** Нижние границы фрагментов (накопленным итогом) — предпочтительные места разрыва страниц */
  boundaries: number[];
}

/** Собрать ленту из фрагментов: суперсэмплинг → финализация → бинаризация */
export function composeToolCanvas(pieces: ToolPiece[]): ToolComposeResult {
  const total = pieces.reduce((s, p) => s + Math.max(0, p.height), 0);
  const { canvas: ss, ctx } = createSupersampledCanvas(TOOL_WIDTH, Math.max(1, total));
  // Белый фон обязателен: бинаризация превращает прозрачные пиксели в чёрные
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TOOL_WIDTH, Math.max(1, total));
  ctx.fillStyle = TOOL_INK;
  ctx.strokeStyle = TOOL_INK;
  let y = 0;
  const boundaries: number[] = [];
  for (const p of pieces) {
    if (p.height > 0) p.draw(ctx, 0, y, TOOL_WIDTH);
    y += p.height;
    boundaries.push(y);
  }
  const out = document.createElement("canvas");
  finalizePrintCanvas(out, ss);
  return { canvas: out, boundaries };
}

/* ------------------------------------------------------------------ */
/* Нарезка длинной ленты на страницы                                   */
/* ------------------------------------------------------------------ */

/**
 * Нарезать канвас на страницы ≤ maxPx. Разрывы — по границам фрагментов
 * (boundaries), чтобы не резать строку/этикетку посередине; фрагмент длиннее
 * maxPx режется принудительно. Страница ≤ maxPx возвращается как есть.
 */
export function chunkCanvasByHeight(
  canvas: HTMLCanvasElement,
  maxPx: number = TAPE_PAGE_MAX_PX,
  boundaries: number[] = []
): HTMLCanvasElement[] {
  if (canvas.height <= maxPx) return [canvas];

  const points = Array.from(new Set([0, ...boundaries.filter((b) => b > 0 && b < canvas.height), canvas.height])).sort(
    (a, b) => a - b
  );

  const makePage = (from: number, to: number): HTMLCanvasElement => {
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = to - from;
    const pctx = page.getContext("2d");
    if (pctx) pctx.drawImage(canvas, 0, -from);
    return page;
  };

  const pages: HTMLCanvasElement[] = [];
  let start = points[0];
  while (start < canvas.height) {
    // наибольшая точка, влезающая в страницу целиком
    let best = -1;
    for (const p of points) {
      if (p > start && p <= start + maxPx) best = p;
    }
    if (best <= start) best = start + maxPx; // фрагмент длиннее страницы — жёсткий рез
    pages.push(makePage(start, Math.min(best, canvas.height)));
    start = best;
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* Мелкие примитивы рисования                                          */
/* ------------------------------------------------------------------ */

/** Пунктирная линия (разделитель в чеке) */
export function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  x1: number,
  x2: number,
  dash = 3,
  gap = 3,
  lineWidth = 1
): void {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([dash, gap]);
  ctx.lineWidth = lineWidth;
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

/** Пунктир из точек (лидер в строках чека) */
export function drawDottedLeader(
  ctx: CanvasRenderingContext2D,
  y: number,
  x1: number,
  x2: number,
  step = 5,
  radius = 0.9
): void {
  ctx.save();
  ctx.fillStyle = TOOL_INK;
  for (let x = x1; x < x2; x += step) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Рамка этикетки со скруглением */
export function drawRoundedFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 10,
  lineWidth = 1.5
): void {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.roundRect(x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth, radius);
  ctx.stroke();
  ctx.restore();
}

/** Нарисовать чекбокс: пустой или отмеченный галочкой */
export function drawCheckbox(ctx: CanvasRenderingContext2D, x: number, y: number, size = 12, checked = false): void {
  ctx.save();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 2.5);
  ctx.stroke();
  if (checked) {
    ctx.beginPath();
    const p = size * 0.22;
    ctx.moveTo(x + p, y + size * 0.55);
    ctx.lineTo(x + size * 0.42, y + size - p);
    ctx.lineTo(x + size - p, y + p);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}
