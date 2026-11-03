/**
 * Ценник ленты: мост к рендереру вкладки «Ценник».
 *
 * Функционал и отрисовка ИДЕНТИЧНЫ вкладке «Ценник» (pricetags.ts →
 * renderPricetagToCanvas): макет целиком задают строки extraLines с
 * подстановками {name} {price} {old} {sku} {barcode}, поддерживаются QR,
 * штрихкод, артикул, перенос по словам, типографика (кегли названия/цены/
 * доп. строк/старой цены, шрифт, жирность, выравнивание) и рамка.
 *
 * Отличия только в посадке на ленту:
 *  • ценник — цельный блок НА ВСЮ ширину ленты (у вкладки та же ширина
 *    384 px, внутренние поля рендерера дают те же отступы, что у текста);
 *  • масштаб зафиксирован нативным (dpi = BASE_DPI → 1 px = 1 точка
 *    печати): на ленте размер задаётся кеглями, ползунок «Масштаб печати»
 *    вкладки не применяется;
 *  • при фиксированной длине этикетки (пресеты ленты в настройках) ценник,
 *    замыкающий страницу, растягивается до конца ленты — тем же механизмом
 *    minHeightPx, что и на вкладке: рамка занимает всю длину этикетки.
 *
 * Измерение выполняется тем же рендерером (высота по содержимому), поэтому
 * превью списка = результат печати (WYSIWYG). Результаты кэшируются по
 * содержимому элемента — раскладка ленты не перерисовывает ценник лишний раз.
 *
 * Драйвер и отправка печати не затрагиваются: блок попадает в общий холст
 * страницы через renderLabelToCanvas (text-fields.ts) и печатается как есть.
 */
import { PRINTER_HEAD_WIDTH, BASE_DPI, PTLIST_TAGS_MAX } from "./types";
import type {
  Pricetag,
  PricetagItem,
  PricetagListItem,
  PricetagListTag,
  PricetagStyle,
  TextAlignment,
} from "./types";
import { renderPricetagToCanvas } from "./pricetags";
import { ssPx } from "./canvas-quality";

/* ------------------------------------------------------------------ */
/* Геометрия посадки                                                    */
/* ------------------------------------------------------------------ */

/** Кегль названия = кегль цены × 0.55 (наследие компактной версии) */
const NAME_SIZE_K = 0.55;
/** Кегль старой цены = кегль цены × 0.42 */
const OLD_SIZE_K = 0.42;
/** Кегль доп. строк по умолчанию */
const EXTRA_SIZE_DEFAULT = 24;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Кегль названия из кегля цены (для старых ценников без явного кегля) */
export function pricetagNameSize(fontSize: number): number {
  return clamp(Math.round(fontSize * NAME_SIZE_K), 12, 96);
}

/** Кегль старой цены из кегля цены */
export function pricetagOldSize(fontSize: number): number {
  return clamp(Math.round(fontSize * OLD_SIZE_K), 10, 96);
}

/* ------------------------------------------------------------------ */
/* Модель элемента → модель вкладки «Ценник»                            */
/* ------------------------------------------------------------------ */

/** Подстановка старой цены в строке (для тумблера «Старая цена») */
export const OLD_LINE_RE = /\{(?:old|oldprice|старая)\}/i;
/** Подстановка цены в строке */
export const PRICE_LINE_RE = /\{(?:price|цена)\}/i;

/**
 * Товар ценника ленты в модель вкладки «Ценник». Пустой список строк —
 * наследие компактной версии: сеем подстановки из полей (как рисовались
 * раньше: название, под ним цена со старой).
 */
export function pricetagItemToTag(p: PricetagItem): Pricetag {
  let lines = (p.extraLines ?? []).map((l) => String(l ?? ""));
  if (!lines.length) {
    const seeded: string[] = [];
    if ((p.name ?? "").trim()) seeded.push("{name}");
    const price = (p.price ?? "").trim();
    const old = (p.oldPrice ?? "").trim();
    if (price && old) seeded.push("{price} {old}");
    else if (price) seeded.push("{price}");
    else if (old) seeded.push("{old}");
    lines = seeded;
  }
  return {
    id: p.id,
    name: p.name ?? "",
    price: p.price ?? "",
    oldPrice: p.oldPrice ?? "",
    sku: p.sku ?? "",
    qr: p.qr ?? "",
    barcode: p.barcode ?? "",
    extraLines: lines,
  };
}

/**
 * Стиль ценника ленты из полей элемента. Дефолты совпадают с вкладкой
 * («Границы» = рамка, шрифты и жирность — как в DEFAULT_STYLE pricetags.ts);
 * невычисленные кегли наследуются из кегля цены, как в компактной версии.
 */
export function pricetagItemToStyle(p: PricetagItem): PricetagStyle {
  return {
    nameSize: p.nameSize ?? pricetagNameSize(p.fontSize),
    priceSize: p.fontSize,
    extraSize: p.extraSize ?? EXTRA_SIZE_DEFAULT,
    oldPriceSize: p.oldPriceSize ?? pricetagOldSize(p.fontSize),
    nameAlign: p.nameAlign ?? "left",
    priceAlign: p.priceAlign ?? "left",
    extraAlign: p.extraAlign ?? "left",
    fontFamily: p.fontFamily ?? "sans-serif",
    nameBold: p.nameBold ?? true,
    priceBold: p.priceBold ?? true,
    borders: !!p.frame,
    // Лента работает в нативных точках печати: 384 px = ширина головки,
    // scale = dpi/BASE_DPI = 1 — кегли задают размер 1:1 (см. pricetags.ts)
    dpi: BASE_DPI,
  };
}

/** Есть ли у ценника печатаемый источник (любое поле или непустая строка) */
function pricetagHasContent(p: PricetagItem): boolean {
  const tag = pricetagItemToTag(p);
  return Boolean(
    tag.name.trim() ||
      tag.price.trim() ||
      tag.oldPrice.trim() ||
      tag.sku.trim() ||
      tag.qr.trim() ||
      tag.barcode.trim() ||
      tag.extraLines.some((l) => l.trim())
  );
}

/* ------------------------------------------------------------------ */
/* Кэш: измерение + готовый холст ценника                               */
/* ------------------------------------------------------------------ */

interface CachedPricetag {
  width: number;
  height: number;
  /** Бинарный холст 384×height (результат renderPricetagToCanvas) */
  canvas: HTMLCanvasElement | null;
}

const cache = new Map<string, CachedPricetag>();

/** Ключ кэша — всё, что влияет на отрисовку ценника */
function cacheKey(p: PricetagItem): string {
  return JSON.stringify([
    p.name ?? "",
    p.price ?? "",
    p.oldPrice ?? "",
    p.sku ?? "",
    p.qr ?? "",
    p.barcode ?? "",
    p.extraLines ?? [],
    p.fontSize,
    !!p.frame,
    p.nameSize,
    p.extraSize,
    p.oldPriceSize,
    p.nameAlign,
    p.priceAlign,
    p.extraAlign,
    p.fontFamily,
    p.nameBold,
    p.priceBold,
    // Растяжка до конца этикетки меняет высоту холста — часть ключа
    p.stretchToPx ?? 0,
  ]);
}

/** Отрисовать ценник рендерером вкладки (с кэшем) — холст + высота */
function getCached(p: PricetagItem): CachedPricetag {
  const key = cacheKey(p);
  const hit = cache.get(key);
  if (hit) return hit;

  let entry: CachedPricetag;
  if (!pricetagHasContent(p)) {
    // Пустой ценник не занимает места — как пустое текстовое поле
    entry = { width: 0, height: 0, canvas: null };
  } else {
    const canvas = document.createElement("canvas");
    // Фиксированная лента: ценник дотягивается до конца этикетки — тот же
    // механизм, что на вкладке «Ценник» (рамка растягивается на всю длину,
    // контент остаётся сверху); 0/undefined — высота по содержимому
    const minPx = Math.max(0, Math.floor(p.stretchToPx ?? 0));
    const { height } = renderPricetagToCanvas(
      canvas,
      pricetagItemToTag(p),
      pricetagItemToStyle(p),
      minPx > 0 ? { minHeightPx: minPx } : undefined
    );
    entry = { width: PRINTER_HEAD_WIDTH, height, canvas };
  }
  if (cache.size > 60) cache.clear();
  cache.set(key, entry);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Измерение и отрисовка (API как раньше — tape.ts и text-fields.ts)    */
/* ------------------------------------------------------------------ */

export interface MeasuredPricetag {
  width: number;
  height: number;
}

/**
 * Измерить блок ценника: рендерер вкладки возвращает высоту по содержимому.
 * Ширина — вся лента (внутренние поля рендерера = отступы текста ленты).
 */
export function measurePricetagItem(p: PricetagItem): MeasuredPricetag {
  const c = getCached(p);
  return { width: c.width, height: c.height };
}

/**
 * Нарисовать ценник в ЛОГИЧЕСКИХ координатах печати (контекст страницы
 * масштабирован 4×). Ценник рендерится в собственный бинарный холст 1×
 * (тем же рендерером, что и на вкладке «Ценник») и кладётся на всю ширину
 * ленты: суперсэмплинг страницы кратен 4, растр ложится 1:1 без искажений.
 */
export function drawPricetagItem(ctx: CanvasRenderingContext2D, p: PricetagItem): void {
  const c = getCached(p);
  if (!c.canvas || c.height <= 0) return;
  ctx.save();
  // Растр уже бинарный — масштабирование ближайшим соседом даёт точные
  // блоки 4×4, после финализации страницы изображение совпадает 1:1
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c.canvas, 0, ssPx(p.y));
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Список ценников (ptlist): синтез и нормализация                      */
/* ------------------------------------------------------------------ */

const align = (v: unknown): TextAlignment | undefined =>
  v === "left" || v === "center" || v === "right" ? v : undefined;

/** Строка или конечное число → строка; остальное → пустая строка */
const s = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};

/** Клэмп с fallback: NaN/нечисла → значение по умолчанию */
const clampF = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};

/** Починить один тег списка (строки макета — максимум 24) */
export function normalizePricetagListTag(raw: unknown): PricetagListTag {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lines = Array.isArray(o.extraLines)
    ? o.extraLines.map((l) => s(l ?? "")).slice(0, 24)
    : [];
  return {
    name: s(o.name),
    price: s(o.price),
    oldPrice: s(o.oldPrice),
    sku: s(o.sku),
    qr: s(o.qr),
    barcode: s(o.barcode),
    extraLines: lines,
  };
}

/**
 * Ценники списка → модели вкладки «Ценник» (PricetagItem). Типографика
 * общая, у каждого синтетического ценника свой id `item#i` — рендерер
 * и кэш работают без изменений (ключ кэша — содержимое, не id).
 */
export function ptlistTagItems(item: PricetagListItem): PricetagItem[] {
  return item.tags.map((tag, i) => ({
    id: `${item.id}#${i}`,
    kind: "pricetag" as const,
    x: item.x,
    y: 0,
    name: tag.name,
    price: tag.price,
    oldPrice: tag.oldPrice,
    sku: tag.sku,
    qr: tag.qr,
    barcode: tag.barcode,
    extraLines: tag.extraLines,
    fontSize: item.fontSize,
    frame: item.frame,
    nameSize: item.nameSize,
    extraSize: item.extraSize,
    oldPriceSize: item.oldPriceSize,
    nameAlign: item.nameAlign,
    priceAlign: item.priceAlign,
    extraAlign: item.extraAlign,
    fontFamily: item.fontFamily,
    nameBold: item.nameBold,
    priceBold: item.priceBold,
  }));
}

/** Дефолтный тег нового ценника в списке (как makeNewPricetag раньше) */
export function makePricetagListTag(name: string, price: string): PricetagListTag {
  return {
    name,
    price,
    oldPrice: "",
    sku: "",
    qr: "",
    barcode: "",
    extraLines: ["{name}", "{price}"],
  };
}

/**
 * Миграция старого одиночного ценника ленты (kind "pricetag") в список:
 * поля товара уходят в единственный тег, типографика — на уровень списка.
 * Логика посева подстановок в пустые строки — как рисовались раньше.
 */
export function ptlistFromLegacyPricetag(raw: Record<string, unknown>, id: string): PricetagListItem {
  const name = s(raw.name);
  const price = s(raw.price);
  const oldPrice = s(raw.oldPrice);
  const rawLines = Array.isArray(raw.extraLines)
    ? raw.extraLines.map((l) => s(l ?? "")).slice(0, 24)
    : [];
  let extraLines = rawLines;
  if (!extraLines.length) {
    const seeded: string[] = [];
    if (name.trim()) seeded.push("{name}");
    if (price && oldPrice) seeded.push("{price} {old}");
    else if (price) seeded.push("{price}");
    else if (oldPrice) seeded.push("{old}");
    extraLines = seeded;
  }
  const fontSize = clamp(Number(raw.fontSize) || 48, 16, 96);
  return {
    id,
    kind: "ptlist",
    x: clampF(raw.x, 0, PRINTER_HEAD_WIDTH - 48, 16),
    y: 0,
    tags: [
      {
        name,
        price,
        oldPrice,
        sku: s(raw.sku),
        qr: s(raw.qr),
        barcode: s(raw.barcode),
        extraLines,
      },
    ],
    fontSize,
    frame: Boolean(raw.frame),
    nameSize: raw.nameSize == null ? undefined : clampF(raw.nameSize, 12, 96, pricetagNameSize(fontSize)),
    extraSize: raw.extraSize == null ? undefined : clampF(raw.extraSize, 8, 72, 24),
    oldPriceSize:
      raw.oldPriceSize == null ? undefined : clampF(raw.oldPriceSize, 10, 96, pricetagOldSize(fontSize)),
    nameAlign: align(raw.nameAlign),
    priceAlign: align(raw.priceAlign),
    extraAlign: align(raw.extraAlign),
    fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily : undefined,
    nameBold: typeof raw.nameBold === "boolean" ? raw.nameBold : undefined,
    priceBold: typeof raw.priceBold === "boolean" ? raw.priceBold : undefined,
  };
}

/** Нормализовать список ценников целиком (лимит PTLIST_TAGS_MAX) */
export function normalizePricetagListItemTags(raw: unknown): PricetagListTag[] {
  const arr = Array.isArray(raw) ? raw.slice(0, PTLIST_TAGS_MAX) : [];
  return arr.map(normalizePricetagListTag);
}
