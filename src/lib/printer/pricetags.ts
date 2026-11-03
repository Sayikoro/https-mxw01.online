/**
 * Ценники: модель, отрисовка на холст и импорт CSV/таблицы.
 * Отрисовка идёт в логическом пространстве 384 px (ширина печатающей головки).
 * Макет ценника целиком задают СТРОКИ: поля товара попадают на печать только
 * через подстановки {name} / {price} / {old} / {sku} / {article}; строка {qr}
 * вставляет QR-код с содержимым поля QR (как вписано, без подстановок), блок
 * всегда центрируется.
 * Печать — только через драйвер `mxw01-thermal-printer`.
 */
import QRCode from "qrcode";
import { PRINTER_HEAD_WIDTH, BASE_DPI, TAPE_DPI } from "./types";
import type { Pricetag, PricetagStyle, TextAlignment } from "./types";
import { createId } from "./types";
import {
  SUPER_SAMPLE,
  createSupersampledCanvas,
  finalizePrintCanvas,
  ssPx,
} from "./canvas-quality";
import { renderBarcodeCanvas } from "./barcode";

/* ------------------------------------------------------------------ */
/* Значения по умолчанию                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_STYLE: PricetagStyle = {
  nameSize: 42,
  priceSize: 56,
  extraSize: 24,
  oldPriceSize: 26,
  nameAlign: "left",
  priceAlign: "left",
  extraAlign: "left",
  fontFamily: "sans-serif",
  nameBold: true,
  priceBold: true,
  borders: true,
  // Нативный масштаб ленты 55 мм: 384 px = 55 мм, 1 px = 1 точка печати —
  // рендер всегда в максимальном качестве (см. TAPE_DPI в types.ts).
  dpi: TAPE_DPI,
};

export function makeEmptyPricetag(): Pricetag {
  // Новый ценник стартует с вызовов {name} и {price} — поля товара сами по
  // себе не печатаются, попадают на ценник только через подстановки.
  return { id: createId(), name: "", price: "", oldPrice: "", qr: "", sku: "", barcode: "", extraLines: ["{name}", "{price}"] };
}

/* ------------------------------------------------------------------ */
/* Подстановки в строках ценника                                       */
/* ------------------------------------------------------------------ */

/**
 * В строках ценника доступны подстановки данных товара:
 *   {name} / {название}    → название товара
 *   {price} / {цена}       → цена
 *   {old} / {старая}       → старая цена
 *   {sku} / {article} / {артикул} → артикул
 *   {barcode} / {штрихкод} → штрихкод (ТЕКСТОМ; сам штрихкод рисуется блоком)
 * Регистр не важен; неизвестные подстановки остаются как есть.
 *
 * Отдельно от подстановок данных: строка, состоящая только из {qr}, — шорткод
 * БЛОКА QR-кода. Содержимое QR — ровно то, что вписано в поле QR товара
 * (без прогонки через подстановки: пользователь видит в QR ровно свой текст).
 */
const PLACEHOLDER_MAP: Record<
  string,
  "name" | "price" | "oldPrice" | "sku" | "barcode"
> = {
  name: "name",
  название: "name",
  price: "price",
  цена: "price",
  old: "oldPrice",
  oldprice: "oldPrice",
  старая: "oldPrice",
  sku: "sku",
  article: "sku",
  артикул: "sku",
  barcode: "barcode",
  штрихкод: "barcode",
};

/** Заменить подстановки вида {name} в строке данными товара */
export function applyPlaceholders(
  line: string,
  tag: Pick<Pricetag, "name" | "price" | "oldPrice" | "sku"> & {
    barcode?: string;
  }
): string {
  return line.replace(/\{([^{}]+)\}/g, (raw, keyRaw: string) => {
    const field = PLACEHOLDER_MAP[keyRaw.trim().toLowerCase()];
    if (!field) return raw;
    return (tag as Record<string, string | undefined>)[field] || "";
  });
}

/* ------------------------------------------------------------------ */
/* Миграция: посев подстановок в ценники старых версий                 */
/* ------------------------------------------------------------------ */

const ANY_PLACEHOLDER_RE =
  /\{(?:name|название|price|цена|old|oldprice|старая|sku|article|артикул|barcode|штрихкод)\}/i;

/**
 * Ценники из версий, где название/цена рисовались автоматически, не содержат
 * подстановок в строках. Поля товара больше сами не печатаются — после
 * обновления такой ценник оказался бы пустым («пустое место» вместо данных).
 * Сеем явные вызовы в начало строк:
 *   • название → «{name}»;
 *   • цена и/или старая → «{price}», «{old}» или «{price} {old}» (как раньше
 *     рисовались рядом — старая мельче, зачёркнута);
 * существующие строки сохраняются. Ценники, где подстановка уже есть в любой
 * строке (в т.ч. намеренно оставленная единственная), не трогаются.
 */
export function seedPlaceholderLines(tags: Pricetag[]): Pricetag[] {
  return tags.map((t) => {
    if (t.extraLines.some((l) => ANY_PLACEHOLDER_RE.test(l))) return t;
    const name = t.name.trim();
    const price = t.price.trim();
    const oldPrice = t.oldPrice.trim();
    if (!name && !price && !oldPrice) return t;
    const seeded: string[] = [];
    if (name) seeded.push("{name}");
    if (price && oldPrice) seeded.push("{price} {old}");
    else if (price) seeded.push("{price}");
    else if (oldPrice) seeded.push("{old}");
    return { ...t, extraLines: [...seeded, ...t.extraLines] };
  });
}

/* ------------------------------------------------------------------ */
/* Модель макета: строка — единственный источник печатаемого текста.    */
/* Поля товара сами по себе НЕ рисуются — только через подстановки.     */
/* ------------------------------------------------------------------ */

/** Строка, состоящая только из {name}/{название} → шрифт названия */
const NAME_LINE_RE = /^\{(?:name|название)\}$/i;

/** Строка, состоящая только из {qr} → шорткод блока QR-кода */
const QR_LINE_RE = /^\{qr\}$/i;

/** Токен цены/старой цены внутри «ценовой» строки */
const PRICE_TOKEN_RE = /^\{(?:price|цена|old|oldprice|старая)\}$/i;

/**
 * Роль строки макета ценника:
 *  • «{name}»                          → блок названия (крупный шрифт);
 *  • «{price}», «{old}», «{price} {old}» → блок цены (крупный шрифт + «₽»);
 *  • всё остальное                     → обычная строка (мелкий шрифт).
 * Для «ценовой» строки дополнительно сообщает, ЧТО именно вызвано в строке —
 * печатается только вызванное (строка «{old}» не рисует цену и наоборот).
 */
export interface LineAnalysis {
  kind: "name" | "price" | "extra";
  /** В строке вызван {price} */
  wantsPrice: boolean;
  /** В строке вызван {old} */
  wantsOld: boolean;
}

const PRICE_ONLY_TOKEN_RE = /^\{(?:price|цена)\}$/i;
const OLD_ONLY_TOKEN_RE = /^\{(?:old|oldprice|старая)\}$/i;

export function analyzeLine(line: string): LineAnalysis {
  const t = line.trim();
  if (!t) return { kind: "extra", wantsPrice: false, wantsOld: false };
  if (NAME_LINE_RE.test(t)) return { kind: "name", wantsPrice: false, wantsOld: false };
  const tokens = t.split(/\s+/);
  if (tokens.length && tokens.every((tok) => PRICE_TOKEN_RE.test(tok))) {
    return {
      kind: "price",
      wantsPrice: tokens.some((tok) => PRICE_ONLY_TOKEN_RE.test(tok)),
      wantsOld: tokens.some((tok) => OLD_ONLY_TOKEN_RE.test(tok)),
    };
  }
  return { kind: "extra", wantsPrice: false, wantsOld: false };
}

/** Краткая роль строки (для тестов и внешних проверок) */
export function detectLineRole(line: string): "name" | "price" | "extra" {
  return analyzeLine(line).kind;
}

/** «5800» → «5800 ₽»; если валюта уже указана пользователем — не дублируем */
function withRuble(value: string): string {
  const t = value.trim();
  if (!t) return "";
  return /₽|руб/i.test(t) ? t : `${t} ₽`;
}

/* ------------------------------------------------------------------ */
/* Измерение и отрисовка                                               */
/* ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    c.width = PRINTER_HEAD_WIDTH;
    c.height = 10;
    measureCtx = c.getContext("2d");
  }
  return measureCtx!;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function alignX(align: TextAlignment, blockWidth: number, contentWidth: number, pad: number): number {
  if (align === "center") return Math.round((contentWidth - blockWidth) / 2);
  if (align === "right") return contentWidth - pad - blockWidth;
  return pad;
}

export interface RenderedPricetag {
  height: number;
}

/**
 * Опции рендера ценника.
 * minHeightPx — фиксированная длина ленты (мм → точки через mmToLabelPx):
 * этикетка не короче заданной длины — короткий ценник добеляется белым до
 * точной длины этикетки, длиннее — ценник растёт под содержимое (ничего
 * не обрезается, что видно в превью). Не задана — высота по содержимому.
 */
export interface PricetagRenderOptions {
  /** number — фикс. минимум; null/undefined — авто (высота по содержимому) */
  minHeightPx?: number | null;
}

type TagBlock =
  | { kind: "name"; lines: string[] }
  | { kind: "price"; priceText: string; oldText: string }
  | { kind: "extra"; text: string }
  | { kind: "qr"; text: string }
  | { kind: "barcode"; canvas: HTMLCanvasElement };
/**
 * Отрисовать один ценник на холст. Возвращает высоту холста.
 *
 * Макет целиком задаётся строками extraLines — поля товара (название, цена,
 * старая цена) НЕ рисуются автоматически и попадают на ценник только через
 * подстановки {name} / {price} / {old} / {sku}:
 *   • строка «{name}»                          → шрифт названия (nameSize);
 *   • строка «{price}» / «{old}» / «{price} {old}» → шрифт цены (priceSize);
 *     печатается только вызванное в строке ({price} — цена, {old} — старая);
 *   • любая другая строка                      → обычный шрифт (extraSize).
 * Строка {qr} вставляет блок QR-кода в позиции строки; содержимое — ровно то,
 * что вписано в поле QR (без подстановок). Строки {qr} нет в макете — QR НЕ
 * печатается, даже если поле QR заполнено: автодобавления нет, только шорткод.
 * QR-код всегда центрируется по ширине этикетки. Штрихкод
 * (EAN-13/Code-128) — блоком после QR, если заполнено поле «Штрихкод».
 */
export function renderPricetagToCanvas(
  canvas: HTMLCanvasElement,
  tag: Pricetag,
  style: PricetagStyle,
  opts?: PricetagRenderOptions
): RenderedPricetag {
  const W = PRINTER_HEAD_WIDTH;
  const scale = style.dpi / BASE_DPI;
  const pad = Math.round(16 * scale);
  const gap = Math.round(10 * scale);

  // --- сборка блоков из строк ---
  const probe = getMeasureContext();
  const contentWidth = W - pad * 2;

  const nameSize = Math.round(style.nameSize * scale);
  const priceSize = Math.round(style.priceSize * scale);
  const extraSize = Math.round(style.extraSize * scale);
  const oldPriceSize = Math.round(style.oldPriceSize * scale);

  // Содержимое QR — ровно то, что вписано пользователем: без прогонки через
  // подстановки ({sku} в поле остаётся литералом «{sku}» в QR — как вписано,
  // так и кодируется).
  const qrText = (tag.qr ?? "").trim();

  const blocks: TagBlock[] = [];
  for (const rawLine of tag.extraLines) {
    const line = (rawLine ?? "").trim();
    if (!line) continue;
    // Шорткод {qr}: блок QR-кода в позиции строки (поле пусто — не печатаем)
    if (QR_LINE_RE.test(line)) {
      if (!qrText) continue;
      blocks.push({ kind: "qr", text: qrText });
      continue;
    }
    const role = analyzeLine(line);
    if (role.kind === "name") {
      const text = tag.name.trim();
      if (!text) continue; // поле пусто — блок не печатается
      probe.font = `${style.nameBold ? "700" : "400"} ${nameSize}px ${style.fontFamily}`;
      blocks.push({ kind: "name", lines: wrapText(probe, text, contentWidth) });
    } else if (role.kind === "price") {
      // Печатаем только то, что вызвано в строке: «{old}» без «{price}» —
      // только зачёркнутая старая цена, и наоборот.
      const priceText = role.wantsPrice ? withRuble(tag.price) : "";
      const oldText = role.wantsOld ? withRuble(tag.oldPrice) : "";
      if (!priceText && !oldText) continue;
      blocks.push({ kind: "price", priceText, oldText });
    } else {
      const text = applyPlaceholders(rawLine ?? "", tag);
      if (!text.trim()) continue; // подстановка оказалась пустой
      blocks.push({ kind: "extra", text });
    }
  }
  // Автодобавления QR НЕТ: блок QR попадает на ценник ТОЛЬКО явной строкой
  // {qr} в макете. Поле QR заполнено, а строки {qr} нет — QR не печатается.

  // Штрихкод — отдельный бинарный холст (целочисленные штрихи). Кладётся на
  // итоговый холст 1:1 ПОСЛЕ бинаризации — без передискретизации.
  const barcodeCanvas = tag.barcode?.trim()
    ? renderBarcodeCanvas(tag.barcode, { maxWidth: contentWidth })
    : null;
  if (barcodeCanvas) blocks.push({ kind: "barcode", canvas: barcodeCanvas });

  // --- предварительный расчёт высоты ---
  const blockHeights = blocks.map((b): number => {
    if (b.kind === "name") return b.lines.length * nameSize * 1.15;
    if (b.kind === "price") {
      const priceH = b.priceText ? priceSize * 1.1 : 0;
      const oldH = b.oldText ? oldPriceSize * 1.4 : 0;
      return Math.max(priceH, oldH);
    }
    if (b.kind === "extra") {
      probe.font = `400 ${extraSize}px ${style.fontFamily}`;
      return wrapText(probe, b.text, contentWidth).length * extraSize * 1.3;
    }
    // Штрихкод — фикс. высота в device-px (сканируемость важнее масштаба)
    if (b.kind === "barcode") return b.canvas.height;
    return Math.round(96 * scale); // qr
  });

  let contentH = blockHeights.reduce((a, b) => a + b, 0);
  contentH += Math.max(0, blocks.length - 1) * gap;

  let height = Math.ceil(contentH + pad * 2);
  if (style.borders) height += Math.round(8 * scale);
  height = Math.max(height, Math.round(60 * scale));

  // Фиксированная длина ленты: этикетка не короче заданной (короткий ценник
  // добеляется белым до точной длины этикетки — рамка, если включена,
  // растягивается на всю высоту автоматически). Длиннее — растёт, без обрезки.
  const minPx = Math.max(0, Math.floor(opts?.minHeightPx ?? 0));
  if (minPx > height) height = minPx;

  // --- отрисовка (в 4× разрешении для чёткого края букв; см. canvas-quality.ts) ---
  const { canvas: ss, ctx } = createSupersampledCanvas(W, height);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = pad;
  if (style.borders) y += Math.round(4 * scale);
  let barcodeY = 0;

  blocks.forEach((block, bi) => {
    if (block.kind === "name") {
      ctx.font = `${style.nameBold ? "700" : "400"} ${nameSize}px ${style.fontFamily}`;
      // Строки позиционируются от начала блока: сам блок сдвигает y ровно один
      // раз — в общем хвосте ниже. Раньше y двигался и в цикле строк, и через
      // blockHeights — блок занимал двойную высоту: между блоками возникали
      // пустые зоны («пустое место»), а низ ценника обрезался за холстом.
      block.lines.forEach((line, li) => {
        const w = ctx.measureText(line).width;
        ctx.fillText(
          line,
          ssPx(alignX(style.nameAlign, w, W, pad)),
          ssPx(y + li * nameSize * 1.15)
        );
      });
    } else if (block.kind === "price") {
      // Цена крупно, старая цена — мельче рядом, с зачёркиванием
      ctx.font = `${style.priceBold ? "700" : "400"} ${priceSize}px ${style.fontFamily}`;
      const priceW = block.priceText ? ctx.measureText(block.priceText).width : 0;
      ctx.font = `400 ${oldPriceSize}px ${style.fontFamily}`;
      const oldW = block.oldText ? ctx.measureText(block.oldText).width : 0;
      const rowW = priceW + (oldW ? oldW + Math.round(12 * scale) : 0);

      let x = alignX(style.priceAlign, rowW, W, pad);
      if (block.priceText) {
        ctx.font = `${style.priceBold ? "700" : "400"} ${priceSize}px ${style.fontFamily}`;
        ctx.fillText(block.priceText, ssPx(x), ssPx(y));
        x += priceW;
      }
      if (block.oldText) {
        const oldX = x + (block.priceText ? Math.round(12 * scale) : 0);
        ctx.font = `400 ${oldPriceSize}px ${style.fontFamily}`;
        const oldY = y + (block.priceText ? priceSize - oldPriceSize * 0.9 : 0);
        ctx.fillText(block.oldText, ssPx(oldX), ssPx(oldY));
        ctx.save();
        ctx.lineWidth = Math.max(2, Math.round(3 * scale));
        ctx.beginPath();
        ctx.moveTo(ssPx(oldX - 2), ssPx(oldY + oldPriceSize * 0.55));
        ctx.lineTo(ssPx(oldX + oldW + 2), ssPx(oldY + oldPriceSize * 0.55));
        ctx.stroke();
        ctx.restore();
      }
    } else if (block.kind === "extra") {
      ctx.font = `400 ${extraSize}px ${style.fontFamily}`;
      const wrapped = wrapText(ctx, block.text, contentWidth);
      // Аналогично блоку названия: от начала блока, без собственного сдвига y.
      wrapped.forEach((wl, li) => {
        const w = ctx.measureText(wl).width;
        ctx.fillText(
          wl,
          ssPx(alignX(style.extraAlign, w, W, pad)),
          ssPx(y + li * extraSize * 1.3)
        );
      });
    } else if (block.kind === "barcode") {
      // Позиция запоминается — сам холст кладётся после бинаризации (ниже)
      barcodeY = y;
    } else {
      // QR рисуется временно во внеэкранный холст в разрешении суперсэмплинга
      // (qrSize × 4), затем кладётся 1:1 в device-пиксели — без передискретизации.
      const qrSize = Math.round(96 * scale);
      const qrCanvas = document.createElement("canvas");
      QRCode.toCanvas(
        qrCanvas,
        block.text,
        { width: qrSize * SUPER_SAMPLE, margin: 0, errorCorrectionLevel: "M" }
      );
      // QR всегда по центру этикетки (как штрихкод), независимо от выравнивания строк
      const qrX = Math.round((W - qrSize) / 2);
      ctx.drawImage(qrCanvas, ssPx(qrX), ssPx(y), qrSize, qrSize);
    }
    // Единственный сдвиг y: блок занимает ровно рассчитанную высоту + зазор.
    y += blockHeights[bi] + gap;
  });

  // Границы
  if (style.borders) {
    ctx.lineWidth = Math.max(2, Math.round(3 * scale));
    ctx.strokeRect(
      Math.round(4 * scale),
      Math.round(4 * scale),
      W - Math.round(8 * scale),
      height - Math.round(8 * scale)
    );
  }

  // Сжатие до 1× (384 px) + жёсткая бинаризация — чёткий край без «волн»
  finalizePrintCanvas(canvas, ss);

  // Штрихкод: 1:1 в device-пикселях, после бинаризации — штрихи целочисленные
  if (barcodeCanvas && barcodeY > 0) {
    const fctx = canvas.getContext("2d");
    if (fctx) {
      fctx.imageSmoothingEnabled = false;
      fctx.drawImage(
        barcodeCanvas,
        Math.round((W - barcodeCanvas.width) / 2),
        barcodeY
      );
    }
  }

  return { height };
}

/**
 * Собрать «ленту» из всех ценников в один длинный холст для печати.
 * (Каждый ценник печатается друг под другом, как в оригинале.)
 */
export function renderPricetagTapeToCanvas(
  canvas: HTMLCanvasElement,
  tags: Pricetag[],
  style: PricetagStyle,
  opts?: PricetagRenderOptions
): number {
  const W = PRINTER_HEAD_WIDTH;
  const parts: HTMLCanvasElement[] = [];
  let totalH = 0;
  const tapeGap = Math.round(12 * (style.dpi / BASE_DPI));

  for (const tag of tags) {
    const c = document.createElement("canvas");
    const { height } = renderPricetagToCanvas(c, tag, style, opts);
    parts.push(c);
    totalH += height;
  }
  totalH += Math.max(0, parts.length - 1) * tapeGap;

  canvas.width = W;
  canvas.height = Math.max(totalH, 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, canvas.height);
  let y = 0;
  for (const part of parts) {
    ctx.drawImage(part, 0, y);
    y += part.height + tapeGap;
  }
  return canvas.height;
}

/* ------------------------------------------------------------------ */
/* Импорт CSV                                                          */
/* ------------------------------------------------------------------ */

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Разобрать строки таблицы товаров с известным разделителем.
 *
 * Поддерживаются два формата:
 *  1. С заголовком — колонки распознаются по именам (название, цена, старая
 *     цена, QR, штрихкод, артикул/sku; остальные колонки идут в доп. строки
 *     через «|»);
 *  2. Без заголовка — позиционный: [название; цена; старая цена; qr; доп.строки...]
 */
function parsePricetagRows(rows: string[], delimiter: string): Pricetag[] {
  const headerLike = /(назван|name|товар|цена|price|артикул|sku|qr|штрихкод|barcode)/i;
  // --- распознавание заголовка и карта колонок ---
  // Заголовок — если есть ключевые слова И нет чисто числовых ячеек
  // (иначе строка данных вида «Товар X;100;…» ложно принимается за заголовок).
  const firstCells = parseCsvLine(rows[0], delimiter);
  const hasHeader =
    firstCells.some((c) => headerLike.test(c)) &&
    !firstCells.some((c) => /^\d+([.,]\d+)?$/.test(c.trim()));
  let map: {
    name: number;
    price: number;
    old: number;
    qr: number;
    barcode: number;
    sku: number;
  } | null = null;
  if (hasHeader) {
    const findIdx = (re: RegExp): number => firstCells.findIndex((c) => re.test(c));
    map = {
      name: findIdx(/назван|товар|name/i),
      // «Старая цена» тоже содержит «цена» — исключаем её здесь
      price: firstCells.findIndex((c) => /цена|price/i.test(c) && !/стар/i.test(c)),
      old: findIdx(/стар|old/i),
      qr: findIdx(/qr/i),
      barcode: findIdx(/штрихкод|штрих|barcode|ean/i),
      sku: findIdx(/артикул|^арт$|sku|article/i),
    };
  }

  const result: Pricetag[] = [];
  for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
    const cells = parseCsvLine(rows[i], delimiter);
    if (!cells.length || cells.every((c) => !c)) continue;

    let name: string;
    let price: string;
    let oldPrice: string;
    let qr: string;
    let barcode = "";
    let sku = "";
    let extraCells: string[];
    if (map) {
      const at = (idx: number): string => (idx >= 0 ? cells[idx] ?? "" : "");
      name = at(map.name);
      price = at(map.price);
      oldPrice = at(map.old);
      qr = at(map.qr);
      barcode = at(map.barcode);
      sku = at(map.sku);
      const used = new Set(
        [map.name, map.price, map.old, map.qr, map.barcode, map.sku].filter(
          (n) => n >= 0
        )
      );
      extraCells = cells.filter((_, j) => !used.has(j));
    } else {
      name = cells[0] ?? "";
      price = cells[1] ?? "";
      oldPrice = cells[2] ?? "";
      qr = cells[3] ?? "";
      extraCells = cells.slice(4);
    }

    const extras = extraCells
      .flatMap((c) => c.split("|"))
      .map((s) => s.trim())
      .filter(Boolean);
    let extraLines = [...extras, "", "", ""].slice(0, Math.max(3, extras.length));
    // Если строк нет вовсе — сеем вызовы {name} и {price}, иначе ценник
    // останется пустым: поля товара сами по себе не печатаются.
    if (!extras.length && (name.trim() || price.trim())) {
      extraLines = ["{name}", "{price}", ""];
    }
    result.push({
      id: createId(),
      name,
      price,
      oldPrice,
      qr,
      sku,
      barcode,
      extraLines,
    });
  }
  return result;
}

/**
 * Импорт CSV. Разделитель первого приоритета — «;» (как в Excel-локали),
 * затем «,» и таб.
 */
export function importPricetagsFromCsv(text: string): Pricetag[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (!rows.length) return [];
  let delimiter = ";";
  for (const d of [";", ",", "\t"]) {
    if (rows[0].includes(d)) {
      delimiter = d;
      break;
    }
  }
  return parsePricetagRows(rows, delimiter);
}

/**
 * Импорт вставки из Excel / Google Sheets: ячейки разделяются ТАБОМ
 * (приоритет), затем «;» и «,». Логика распознавания колонок — та же,
 * что у CSV-импорта.
 */
export function importPricetagsFromTable(text: string): Pricetag[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (!rows.length) return [];
  let delimiter = "\t";
  for (const d of ["\t", ";", ","]) {
    if (rows[0].includes(d)) {
      delimiter = d;
      break;
    }
  }
  return parsePricetagRows(rows, delimiter);
}
