/**
 * Рендеринг страницы ленты на холст печати 384 px (текст + разделители).
 *
 * Единая точка отрисовки: интерактивный редактор и печать используют
 * ОДНИ И ТЕ ЖЕ измерения/координаты, поэтому превью = результат печати.
 *
 * Текст переносится по словам на ширину ленты (как в документе), эмодзи
 * печатаются как картинки: глиф растрируется в 4× разрешении, приводится
 * к серому и дизерится Флойдом–Стайнбергом (ditherGray "steinberg") —
 * тот же метод, что у картинок с автотоном. Без этого цветной эмодзи
 * после бинаризации превращается в сплошное чёрное пятно. Базовая линия
 * эмодзи совмещается с базовой линией текста — эмодзи стоит «вровень».
 *
 * Компоновка по страницам (поток, пагинация, «поверх текста») — в tape.ts;
 * картинки ленты рендерятся там же поверх этого холста. Сама отправка
 * на печать выполняется только через драйвер `mxw01-thermal-printer`
 * (см. printer-context.tsx) — здесь её нет.
 */
import { PRINTER_HEAD_WIDTH, isDivider, isImage, isPricetag, isRuler } from "./types";
import type { DividerItem, LabelItem, TextFieldItem, TextFrameStyle } from "./types";
import { drawPricetagItem } from "./tape-pricetag";
import { drawRulerItem } from "./tape-ruler";
import { toGray, ditherGray } from "./image-processing";
import {
  SUPER_SAMPLE,
  createSupersampledCanvas,
  finalizePrintCanvas,
  ssPx,
} from "./canvas-quality";

/** Межстрочный интервал */
export const LINE_HEIGHT_FACTOR = 1.25;

/* ------------------------------------------------------------------ */
/* Сегментация эмодзи (чистые функции — тестируются в bun)             */
/* ------------------------------------------------------------------ */

const RE_KEYCAP = /[\u20E3]/u;
const RE_FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;
const RE_PICT = /\p{Extended_Pictographic}/u;
const RE_EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const RE_MODIFIER = /\p{Emoji_Modifier}/u;

function isRegionalIndicator(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Разбить строку на графемные кластеры (Intl.Segmenter, где доступен;
 * фолбэк — ручная склейка ZWJ-последовательностей, модификаторов кожи,
 * селекторов вариаций, кейкапов и флагов).
 */
export function segmentClusters(text: string): string[] {
  const Seg = (
    Intl as unknown as { Segmenter?: typeof Intl.Segmenter }
  ).Segmenter;
  if (Seg) {
    const seg = new Seg("en", { granularity: "grapheme" });
    const out: string[] = [];
    for (const s of seg.segment(text)) out.push(s.segment);
    return out.length ? out : Array.from(text);
  }
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    let cur = chars[i];
    while (i + 1 < chars.length) {
      const nxt = chars[i + 1];
      const join =
        nxt === "\u200D" ||
        nxt === "\uFE0F" ||
        nxt === "\u20E3" ||
        cur === "\u200D" ||
        RE_MODIFIER.test(nxt) ||
        (isRegionalIndicator(cur) && isRegionalIndicator(nxt));
      if (!join) break;
      cur += nxt;
      i++;
    }
    out.push(cur);
  }
  return out;
}

/**
 * Кластер — эмодзи? Текстовые символы с Emoji=Yes, но без презентационной
 * формы (™, ©, ☺ без FE0F) остаются текстом — они печатаются чётче шрифтом.
 */
export function isEmojiCluster(cluster: string): boolean {
  if (!cluster) return false;
  if (RE_FLAG.test(cluster)) return true; // флаг из двух региональных индикаторов
  if (RE_KEYCAP.test(cluster)) return true; // кейкап 1️⃣ … #️⃣
  if (!RE_PICT.test(cluster)) return false;
  const cps = Array.from(cluster);
  if (cps.length > 1) return true; // ZWJ-последовательности, ★+FE0F, 👍🏽 и т.п.
  return RE_EMOJI_PRESENTATION.test(cps[0]) || cluster.includes("\uFE0F");
}

export interface TextRun {
  type: "text" | "emoji";
  value: string;
}

/** Разбить строку на подряд идущие фрагменты «текст | эмодзи» */
export function splitEmojiRuns(line: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const cluster of segmentClusters(line)) {
    const type: TextRun["type"] = isEmojiCluster(cluster) ? "emoji" : "text";
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.value += cluster;
    else runs.push({ type, value: cluster });
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/* Измерения                                                           */
/* ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = PRINTER_HEAD_WIDTH;
    canvas.height = 10;
    measureCtx = canvas.getContext("2d");
  }
  return measureCtx!;
}

/** Разбить текст поля на строки с переносом по словам (ширина ленты) */
export function fieldLines(
  field: Pick<
    TextFieldItem,
    "text" | "fontSize" | "bold" | "italic" | "fontFamily" | "upper"
  > & {
    x?: number;
  }
): string[] {
  const raw = field.text ?? "";
  if (!raw.length) return [];
  // ВЕРХНИЙ РЕГИСТР — до переноса: ширина заглавных отличается,
  // поэтому и перенос, и отрисовка работают с одной и той же строкой
  const text = field.upper ? raw.toUpperCase() : raw;
  const fontCss = fieldFontCss(field);
  const maxW = Math.max(48, PRINTER_HEAD_WIDTH - (field.x ?? 16) - 16);
  const out: string[] = [];
  for (const part of text.split("\n")) out.push(...wrapLine(part, fontCss, maxW));
  return out;
}

/**
 * Перенос одной строки по словам (жёсткий разрыв — для слов шире строки).
 * Пробелы по краям строк не переносятся — как в текстовых редакторах.
 */
function wrapLine(line: string, fontCss: string, maxWidth: number): string[] {
  if (!line) return [""];
  const ctx = getMeasureContext();
  ctx.font = fontCss;
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const out: string[] = [];
  let cur = "";
  for (const part of line.split(/(\s+)/)) {
    if (!part) continue;
    const cand = cur ? cur + part : part.trimStart();
    if (cand && ctx.measureText(cand).width > maxWidth && cur) {
      out.push(cur.trimEnd());
      cur = part.trimStart();
      // Слово шире строки — жёсткий разрыв по символам
      while (cur && ctx.measureText(cur).width > maxWidth && cur.length > 1) {
        let cut = cur.length - 1;
        while (cut > 1 && ctx.measureText(cur.slice(0, cut)).width > maxWidth) cut--;
        out.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      }
    } else {
      cur = cand;
    }
  }
  if (cur) out.push(cur.trimEnd());
  return out.length ? out : [""];
}

/** CSS-строка шрифта для canvas и для DOM-редактора — идентично */
export function fieldFontCss(
  field: Pick<TextFieldItem, "fontSize" | "bold" | "italic" | "fontFamily">
): string {
  return `${field.italic ? "italic " : ""}${field.bold ? "700" : "400"} ${field.fontSize}px ${field.fontFamily}`;
}

export interface MeasuredField {
  width: number;
  height: number;
  lineCount: number;
}

/**
 * Измерить блок текста поля (ширина самой длинной строки, высота всех строк).
 * Строки считаются ПОСЛЕ переноса по словам — как на печати.
 */
export function measureField(
  field: Pick<
    TextFieldItem,
    "text" | "fontSize" | "bold" | "italic" | "fontFamily" | "upper" | "lineHeight"
  > & {
    x?: number;
  }
): MeasuredField {
  const lines = fieldLines(field);
  if (!lines.length) {
    return { width: 0, height: 0, lineCount: 0 };
  }
  const ctx = getMeasureContext();
  ctx.font = fieldFontCss(field);
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line || " ").width;
    if (w > maxW) maxW = w;
  }
  return {
    width: Math.ceil(maxW),
    height: Math.ceil(
      lines.length * field.fontSize * (field.lineHeight ?? LINE_HEIGHT_FACTOR)
    ),
    lineCount: lines.length,
  };
}

/* ------------------------------------------------------------------ */
/* Разделители: геометрия + свои SVG                                   */
/* ------------------------------------------------------------------ */

/** Шаг зигзага, px (та же геометрия, что в DividerVisual) */
export const ZIGZAG_STEP = 6;

/** Высота встроенного разделителя из стиля и толщины */
export function builtinDividerHeight(style: DividerItem["style"], thickness: number): number {
  const t = Math.max(1, Math.min(6, Math.round(thickness) || 1));
  if (style === "double") return t * 2 + 3;
  if (style === "zigzag") return t * 2 + 4;
  return t + 1;
}

/* Кэш своих SVG-разделителей (data:URL → Image) */
const dividerImages = new Map<string, HTMLImageElement>();
const dividerFailed = new Set<string>();

function requestDividerImage(src: string, onSettled?: () => void): void {
  let img = dividerImages.get(src);
  if (!img) {
    img = new Image();
    img.onload = onSettled ?? null;
    img.onerror = () => {
      dividerFailed.add(src);
      onSettled?.();
    };
    img.src = src;
    dividerImages.set(src, img);
  } else if (img.complete) {
    onSettled?.();
  } else if (onSettled) {
    img.addEventListener("load", onSettled, { once: true });
    img.addEventListener("error", onSettled, { once: true });
  }
}

/** Прогреть кэш SVG-разделителей (превью перерисуется через onReady) */
export function preloadDividerImages(
  items: ReadonlyArray<object>,
  onReady?: () => void
): void {
  for (const it of items) {
    const svg = (it as { svg?: string }).svg;
    if (!svg || dividerFailed.has(svg) || dividerImages.has(svg)) continue;
    requestDividerImage(svg, () => onReady?.());
  }
}

/** Дождаться готовности всех SVG-разделителей (перед печатью) */
export function ensureDividerImages(items: ReadonlyArray<object>): Promise<void> {
  const list = items
    .map((it) => (it as { svg?: string }).svg)
    .filter((svg): svg is string => Boolean(svg));
  return Promise.all(
    list.map(
      (src) =>
        new Promise<void>((resolve) => {
          if (dividerFailed.has(src)) {
            resolve();
          } else {
            requestDividerImage(src, resolve);
          }
        })
    )
  ).then(() => undefined);
}

/**
 * Нарисовать разделитель в ЛОГИЧЕСКИХ координатах печати (контекст
 * масштабирован 4×). Геометрия зигзага/двойной линии совпадает с
 * DividerVisual — превью списка = результат печати.
 */
function drawDivider(ctx: CanvasRenderingContext2D, d: DividerItem): void {
  const t = Math.max(1, Math.min(6, d.thickness));
  const h = Math.max(1, d.height);
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = t;

  if (d.svg) {
    const img = dividerImages.get(d.svg);
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, d.x, d.y, d.width, h);
    } else {
      // SVG ещё грузится — плейсхолдер-линия (перерисуется через onReady)
      ctx.fillRect(d.x, d.y + h / 2 - t / 2, d.width, t);
    }
    ctx.restore();
    return;
  }

  if (d.style === "double") {
    ctx.fillRect(d.x, d.y, d.width, t);
    ctx.fillRect(d.x, d.y + h - t, d.width, t);
  } else if (d.style === "zigzag") {
    const amp = Math.max(1, (h - t) / 2);
    const mid = h / 2;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y + mid);
    let up = true;
    for (let px = ZIGZAG_STEP; px < d.width; px += ZIGZAG_STEP) {
      ctx.lineTo(d.x + px, d.y + (up ? mid - amp : mid + amp));
      up = !up;
    }
    ctx.lineTo(d.x + d.width, d.y + mid);
    ctx.stroke();
  } else if (d.style === "dashed" || d.style === "dotted") {
    const mid = h / 2;
    ctx.beginPath();
    if (d.style === "dashed") {
      ctx.setLineDash([8, 5]);
      ctx.moveTo(d.x, d.y + mid);
      ctx.lineTo(d.x + d.width, d.y + mid);
    } else {
      // Точки: круглые «капли» по линии
      ctx.lineCap = "round";
      ctx.setLineDash([0.01, t * 2.2]);
      ctx.moveTo(d.x, d.y + mid);
      ctx.lineTo(d.x + d.width, d.y + mid);
    }
    ctx.stroke();
  } else {
    // solid
    ctx.fillRect(d.x, d.y, d.width, Math.min(t, h));
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Отрисовка страницы ленты (текст + разделители)                      */
/* ------------------------------------------------------------------ */

/**
 * Рамка вокруг фактической ширины строк текстового блока (v1.0.30).
 * Обводка идёт по НАРИСОВАННОЙ ширине (текст + эмодзи), не по всей ширине
 * ленты; при переносе блока на другую страницу каждая часть получает свою
 * рамку (фрагменты страниц несут то же поле frame).
 */
function drawTextFrame(
  ctx: CanvasRenderingContext2D,
  style: TextFrameStyle,
  x: number,
  topY: number,
  width: number,
  height: number
): void {
  const pad = Math.max(3, Math.round(width / 40) + 2);
  const rx = ssPx(x - pad);
  const ry = ssPx(topY - pad);
  const rw = ssPx(width + pad * 2);
  const rh = ssPx(height + pad * 2);
  const lw = 1.5;
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  if (style === "solid") {
    ctx.strokeRect(rx, ry, rw, rh);
  } else if (style === "dashed") {
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(rx, ry, rw, rh);
  } else if (style === "dotted") {
    ctx.setLineDash([0.01, lw * 3.2]);
    ctx.strokeRect(rx, ry, rw, rh);
  } else {
    // Двойная: внешняя и внутренняя линии с зазором 2 px
    ctx.strokeRect(rx, ry, rw, rh);
    const gap = 3;
    ctx.strokeRect(rx + gap, ry + gap, rw - gap * 2, rh - gap * 2);
  }
  ctx.restore();
}

/** Отрисовать один текстовый элемент: строки с переносом + эмодзи-полутон */
function drawTextField(
  ctx: CanvasRenderingContext2D,
  field: TextFieldItem
): void {
  const lines = fieldLines(field);
  if (!lines.length) return;
  const fontCss = fieldFontCss(field);
  ctx.font = fontCss;
  ctx.textAlign = "left";
  const baseAscent = fontAscentPx(ctx, fontCss, field.fontSize);
  const decorated = field.underline || field.strike;
  // Толщина линии подчёркивания/зачёркивания: ~1/16 кегля, минимум 1 px
  const decoW = Math.max(1, Math.round(field.fontSize / 16));
  let lineY = field.y;
  // Габариты блока для рамки: ширина самой широкой строки + высота строк
  let frameWidth = 0;
  const frameTop = lineY;
  let frameBottom = lineY;
  for (const line of lines) {
    const runs = splitEmojiRuns(line);
    let lineW: number;
    if (runs.length === 1 && runs[0].type === "text") {
      ctx.fillStyle = "#000000";
      ctx.fillText(line, ssPx(field.x), ssPx(lineY));
      lineW = ctx.measureText(line).width;
    } else {
      let x = field.x;
      for (const run of runs) {
        if (run.type === "text") {
          ctx.fillStyle = "#000000";
          ctx.fillText(run.value, ssPx(x), ssPx(lineY));
          x += ctx.measureText(run.value).width;
        } else {
          for (const cluster of segmentClusters(run.value)) {
            const glyph = renderEmojiGlyph(cluster, fontCss);
            if (glyph) {
              blitEmoji(ctx, glyph, x, lineY + baseAscent);
              x += glyph.w;
            } else {
              // нет метрик/канваса — рисуем как обычный текст
              ctx.fillStyle = "#000000";
              ctx.fillText(cluster, ssPx(x), ssPx(lineY));
              x += ctx.measureText(cluster).width;
            }
          }
        }
      }
      lineW = x - field.x;
    }
    if (lineW > frameWidth) frameWidth = lineW;
    frameBottom = lineY + field.fontSize * (field.lineHeight ?? LINE_HEIGHT_FACTOR);
    // Подчёркивание/зачёркивание — линия по ширине нарисованной строки
    // (текст + эмодзи). Рисуется в тех же логических координатах, что и
    // текст, поэтому в превью и на печати выглядит одинаково.
    if (decorated && lineW > 0) {
      ctx.fillStyle = "#000000";
      if (field.strike) {
        // Середина зоны строчных: базовая линия минус ~четверть кегля
        const y = lineY + baseAscent - field.fontSize * 0.25 - decoW / 2;
        ctx.fillRect(ssPx(field.x), ssPx(y), ssPx(lineW), ssPx(decoW));
      }
      if (field.underline) {
        // Чуть ниже базовой линии
        const y = lineY + baseAscent + Math.max(1, field.fontSize * 0.06);
        ctx.fillRect(ssPx(field.x), ssPx(y), ssPx(lineW), ssPx(decoW));
      }
    }
    lineY += field.fontSize * (field.lineHeight ?? LINE_HEIGHT_FACTOR);
  }
  // Рамка — после строк, вокруг фактической ширины блока
  if (field.frame && frameWidth > 0) {
    drawTextFrame(ctx, field.frame, field.x, frameTop, frameWidth, frameBottom - frameTop);
  }
}

/**
 * Отрисовать страницу ленты на холсте печати (чёрное на белом, 1:1).
 * Рендеринг идёт в 4× разрешении с финальной бинаризацией — иначе
 * сглаженные края букв после дизеринга драйвера дают «волны».
 *
 * items — элементы СТРАНИЦЫ с абсолютными координатами y (порядок массива =
 * z-порядок: разделитель «поверх текста» идёт после своего текста и потому
 * печатается поверх). height — точная высота страницы в px. Картинки ленты
 * дорисовываются поверх в tape.ts (renderTapePage). scale — коэффициент
 * суперсэмплинга: 4× по умолчанию (печать/сохранение), 1× — быстрое превью.
 * Возвращает высоту холста.
 */
export function renderLabelToCanvas(
  canvas: HTMLCanvasElement,
  items: LabelItem[],
  height: number,
  scale: number = SUPER_SAMPLE
): number {
  const h = Math.max(1, Math.ceil(height));
  const { canvas: ss, ctx } = createSupersampledCanvas(PRINTER_HEAD_WIDTH, h, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PRINTER_HEAD_WIDTH, h);
  ctx.textBaseline = "top";

  for (const item of items) {
    if (isDivider(item)) {
      drawDivider(ctx, item);
    } else if (isPricetag(item)) {
      drawPricetagItem(ctx, item);
    } else if (isRuler(item)) {
      drawRulerItem(ctx, item);
    } else if (!isImage(item)) {
      // Генераторы и списки ценников сюда не доходят: чанки инструментов
      // рисуются в renderTapePage, списки распадаются на PricetagItem
      drawTextField(ctx, item as TextFieldItem);
    }
  }

  finalizePrintCanvas(canvas, ss, scale);
  return h;
}

/* ------------------------------------------------------------------ */
/* Эмодзи: растеризация + дизеринг Флойда–Стайнберга                   */
/* ------------------------------------------------------------------ */

interface EmojiGlyph {
  /** ширина символа (advance), px печати */
  w: number;
  /** размер растра вместе с рамкой EMOJI_PAD */
  cw: number;
  ch: number;
  /** чернила над базовой линией, px печати */
  ascent: number;
  /** бинарный растр после дизеринга: 0 = чернила, 255 = бумага */
  bits: Uint8ClampedArray;
}

/** Запас вокруг чернил глифа, px печати (сглаженные края не обрезаются) */
const EMOJI_PAD = 2;
/** Разрешение растеризации эмодзи (4× как суперсэмплинг текста) */
const EMOJI_SS = 4;
/** Метод дизеринга эмодзи — тот же, что у картинок по умолчанию */
const EMOJI_DITHER = "steinberg";

const emojiCache = new Map<string, EmojiGlyph | null>();

/**
 * Растеризовать эмодзи и продизерить его Флойдом–Стайнбергом:
 * цветной глиф (4×) → плавное сжатие до 1× (пиксель = точка печати) →
 * серое (BT.709, альфа на белый) → ditherGray("steinberg") → 0/255.
 */
function renderEmojiGlyph(cluster: string, fontCss: string): EmojiGlyph | null {
  const key = `${fontCss}|${cluster}`;
  if (emojiCache.has(key)) return emojiCache.get(key) ?? null;

  let glyph: EmojiGlyph | null = null;
  try {
    const probe = document.createElement("canvas").getContext("2d");
    if (probe) {
      probe.font = fontCss;
      probe.textBaseline = "alphabetic";
      const m = probe.measureText(cluster);
      const ascent = (m as TextMetrics).actualBoundingBoxAscent;
      const descent = (m as TextMetrics).actualBoundingBoxDescent;
      if (m.width > 0 && Number.isFinite(ascent) && Number.isFinite(descent)) {
        const a = Math.max(1, Math.ceil(ascent));
        const d = Math.max(0, Math.ceil(descent));
        const cw = Math.ceil(m.width) + EMOJI_PAD * 2;
        const ch = a + d + EMOJI_PAD * 2;

        // 1. цветной глиф в 4× разрешении
        const hi = document.createElement("canvas");
        hi.width = cw * EMOJI_SS;
        hi.height = ch * EMOJI_SS;
        const hctx = hi.getContext("2d");
        if (hctx) {
          hctx.imageSmoothingEnabled = true;
          hctx.imageSmoothingQuality = "high";
          hctx.scale(EMOJI_SS, EMOJI_SS);
          hctx.font = fontCss;
          hctx.textBaseline = "alphabetic";
          hctx.fillStyle = "#000000"; // монохромные фолбэки — чёрным
          hctx.fillText(cluster, EMOJI_PAD, EMOJI_PAD + ascent);

          // 2. плавное сжатие до размера печати (1 px = 1 точка)
          const lo = document.createElement("canvas");
          lo.width = cw;
          lo.height = ch;
          const lctx = lo.getContext("2d");
          if (lctx) {
            lctx.imageSmoothingEnabled = true;
            lctx.imageSmoothingQuality = "high";
            // весь растр 4× сжимается в холст 1× (пиксель = точка печати)
            lctx.drawImage(hi, 0, 0, cw, ch);
            const img = lctx.getImageData(0, 0, cw, ch);
            const gray = toGray(img.data);
            ditherGray(gray, cw, ch, EMOJI_DITHER);
            glyph = { w: m.width, cw, ch, ascent: a, bits: gray };
          }
        }
      }
    }
  } catch {
    glyph = null;
  }

  if (emojiCache.size > 400) emojiCache.clear();
  emojiCache.set(key, glyph);
  return glyph;
}

/**
 * Перенести продизеренные точки эмодзи на холст печати.
 * Рисуются ТОЛЬКО чёрные пиксели — белое не затирает соседние буквы.
 * Контекст холста масштабирован 4× (суперсэмплинг), поэтому каждый
 * логический px 1×1 ложится ровно в блок 4×4 и после финализации
 * попадает в свою точку печати.
 */
function blitEmoji(
  ctx: CanvasRenderingContext2D,
  glyph: EmojiGlyph,
  xLogical: number,
  baselineLogical: number
): void {
  const cellX = Math.round(xLogical) - EMOJI_PAD;
  const cellY = Math.round(baselineLogical) - glyph.ascent - EMOJI_PAD;
  ctx.fillStyle = "#000000";
  for (let py = 0; py < glyph.ch; py++) {
    const row = py * glyph.cw;
    for (let px = 0; px < glyph.cw; px++) {
      if (glyph.bits[row + px] === 0) {
        ctx.fillRect(cellX + px, cellY + py, 1, 1);
      }
    }
  }
}

/**
 * Расстояние от «верха» (textBaseline="top") до базовой линии шрифта.
 * Основной путь — fontBoundingBoxAscent, измеряется ОБЯЗАТЕЛЬНО с baseline
 * «alphabetic»: часть сборок Chromium (например, headless с fontconfig-шрифтами)
 * при textBaseline="top" возвращает мусорное значение (4 px вместо 29),
 * из-за чего эмодзи и линии форматирования съезжают к верху строки.
 * Фолбэк — два замера заглавной «H» от разных базовых линий.
 */
function fontAscentPx(
  ctx: CanvasRenderingContext2D,
  fontCss: string,
  fontSize: number
): number {
  ctx.font = fontCss;
  const prev = ctx.textBaseline;
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("Hg");
  const fba = (m as TextMetrics).fontBoundingBoxAscent;
  let result: number | null = null;
  if (Number.isFinite(fba) && fba > 0) {
    result = fba;
  } else {
    const capA = Number(ctx.measureText("H").actualBoundingBoxAscent) || 0;
    ctx.textBaseline = "top";
    const topA = Number(ctx.measureText("H").actualBoundingBoxAscent) || 0;
    const est = capA - topA; // topA отрицательный: чернила ниже «верха»
    if (Number.isFinite(est) && est > 0) result = est;
  }
  ctx.textBaseline = prev;
  return result ?? fontSize * 0.88;
}

/* ------------------------------------------------------------------ */
/* Эмодзи: растеризация + дизеринг Флойда–Стайнберга                   */
/* ------------------------------------------------------------------ */
