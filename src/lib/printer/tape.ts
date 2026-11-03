/**
 * ============================================================================
 *  ЛЕНТА — движок новой концепции редактора (вместо свободного позиционирования).
 * ============================================================================
 *  Элементы (текст, разделители, картинки) идут ПОТОКОМ сверху вниз в порядке
 *  списка. Лента — бумага 58 мм (384 точки печати, 48 мм зоны печати),
 *  страница ограничена максимальной длиной печати 90 мм = 720 px. Контент,
 *  не влезающий в страницу, переносится на СЛЕДУЮЩУЮ (текст — построчно,
 *  как в документе).
 *
 *  Превью страницы = холст печати: тот же renderLabelToCanvas (текст —
 *  суперсэмплинг + бинаризация, эмодзи — полутон Байера), картинки —
 *  дизеринг алгоритмами драйвера. Поэтому в превью сразу виден дизеринг
 *  и ровно то, что уйдёт на бумагу (WYSIWYG).
 *
 *  Разделитель с флагом overlay («поверх текста») не занимает места в потоке
 *  и ложится на середину предыдущего блока — эффект зачёркивания; он идёт
 *  в массиве элементов ПОСЛЕ своего текста, поэтому печатается поверх.
 *
 *  Драйвер и printCanvas не затрагиваются: это слой компоновки и рендера.
 * ============================================================================
 */
import {
  PRINTER_HEAD_WIDTH,
  TAPE_PAGE_MAX_PX,
  isDivider,
  isImage,
  isPricetag,
  isPricetagList,
  isRuler,
  isTool,
} from "./types";
import type { ImageItem, LabelItem, TextFieldItem, ToolItem } from "./types";
import { measurePricetagItem, ptlistTagItems } from "./tape-pricetag";
import { rulerHeightPx } from "./tape-ruler";
import { toolItemChunks } from "./tape-tools";
import type { TapeI18n } from "./tape-tools";
import {
  LINE_HEIGHT_FACTOR,
  fieldLines,
  renderLabelToCanvas,
} from "./text-fields";
import { SUPER_SAMPLE } from "./canvas-quality";
import {
  applyImageSettings,
  drawScaledToCanvas,
} from "./image-processing";

/* ------------------------------------------------------------------ */
/* Константы компоновки                                                 */
/* ------------------------------------------------------------------ */

/** Отступ сверху страницы, px */
export const PAGE_PAD_TOP = 8;
/** Отступ снизу страницы, px */
export const PAGE_PAD_BOTTOM = 12;
/** Промежуток между элементами потока, px (не внутри элемента) */
export const PAGE_GAP = 8;
/** Минимальная высота страницы (чтобы крошечная этикетка не была полоской) */
export const PAGE_MIN_PX = 96;

/** Полезная высота страницы под контент (без нижнего отступа) */
export function pageUsableHeight(capacity = TAPE_PAGE_MAX_PX): number {
  return capacity - PAGE_PAD_BOTTOM;
}

/* ------------------------------------------------------------------ */
/* Строки потока и паковка по страницам (чистая математика — тестируется) */
/* ------------------------------------------------------------------ */

/** Атомарная строка потока: строка текста или цельный блок (разделитель/картинка) */
export interface TapeRowSpec {
  /** Индекс элемента в исходном списке */
  elementIndex: number;
  /** Индекс строки внутри элемента (у блока — 0) */
  lineIndex: number;
  /** Высота строки, px */
  height: number;
}

/** Размещённая строка */
export interface TapeRowPlaced {
  elementIndex: number;
  lineIndex: number;
  height: number;
  page: number;
  y: number;
}

/** Занятый элементом вертикальный диапазон на странице */
export interface TapeElementSegment {
  page: number;
  top: number;
  bottom: number;
}

export interface PackResult {
  rows: TapeRowPlaced[];
  /** Высота каждой страницы, px */
  pageHeights: number[];
  /** Занятые диапазоны по элементам (в порядке элементов) */
  elementSegments: TapeElementSegment[][];
}

export interface PackOptions {
  /** Высота страницы, px (по умолчанию — максимум печати 90 мм = 720 px) */
  capacity?: number;
  /** Фиксированная этикетка: страница РОВНО capacity (обрезается по длине ленты) */
  fixed?: boolean;
  padTop?: number;
  padBottom?: number;
  gap?: number;
  minPage?: number;
}

/**
 * Упаковать строки потока в страницы: перенос — когда строка не влезает
 * в полезную высоту текущей страницы. Одиночная строка выше всей страницы
 * (например, огромный SVG) получает свою страницу с мягким переливом.
 * Промежуток добавляется только МЕЖДУ элементами.
 */
export function packRows(
  specs: TapeRowSpec[],
  opts?: PackOptions
): PackResult {
  const capacity = Math.max(PAGE_MIN_PX, opts?.capacity ?? TAPE_PAGE_MAX_PX);
  const fixed = opts?.fixed ?? false;
  const padTop = opts?.padTop ?? PAGE_PAD_TOP;
  const padBottom = opts?.padBottom ?? PAGE_PAD_BOTTOM;
  const gap = opts?.gap ?? PAGE_GAP;
  const minPage = Math.min(opts?.minPage ?? PAGE_MIN_PX, capacity);
  const usable = Math.max(1, capacity - padBottom);

  const rows: TapeRowPlaced[] = [];
  const pageHeights: number[] = [];
  const segments: TapeElementSegment[][] = [];

  let page = 0;
  let cursor = padTop;
  let contentBottom = 0;
  let rowsOnPage = 0;
  let prevElement = -1;

  const flushPage = () => {
    const h = fixed ? capacity : Math.max(minPage, contentBottom + padBottom);
    pageHeights[page] = Math.max(pageHeights[page] ?? 0, Math.ceil(h));
  };

  for (const spec of specs) {
    const newElement = spec.elementIndex !== prevElement;
    if (rowsOnPage > 0 && newElement) cursor += gap;

    // Перенос на новую страницу: строка не влезает в текущую
    if (rowsOnPage > 0 && cursor + spec.height > usable) {
      flushPage();
      page += 1;
      cursor = padTop;
      contentBottom = 0;
      rowsOnPage = 0;
    }

    rows.push({ ...spec, page, y: cursor });
    cursor += spec.height;
    contentBottom = Math.max(contentBottom, cursor);
    rowsOnPage += 1;
    prevElement = spec.elementIndex;

    const seg = segments[spec.elementIndex] ?? (segments[spec.elementIndex] = []);
    const last = seg[seg.length - 1];
    if (last && last.page === page) {
      last.bottom = cursor;
    } else {
      seg.push({ page, top: cursor - spec.height, bottom: cursor });
    }
  }
  if (rowsOnPage > 0) flushPage();

  return { rows, pageHeights, elementSegments: segments };
}

/* ------------------------------------------------------------------ */
/* Измерение элементов → строки потока                                  */
/* ------------------------------------------------------------------ */

export interface MeasuredTape {
  specs: TapeRowSpec[];
  /** Строки текстовых элементов (для склейки фрагментов по страницам) */
  linesByElement: Map<number, string[]>;
  /** Индексы разделителей-оверлеев (не участвуют в паковке) */
  overlayDividers: number[];
}

/**
 * Разложить элементы списка на атомарные строки потока.
 *
 * opts.capacityPx — высота страницы, по которой нарезаются чанки
 * генераторов (фиксированная этикетка — её высота, авто — максимум 90 мм);
 * opts.i18n — перевод и локаль (подписи генераторов на печати).
 */
export function measureTapeItems(
  items: LabelItem[],
  opts?: { capacityPx?: number; i18n?: TapeI18n }
): MeasuredTape {
  const capacityPx = Math.max(1, opts?.capacityPx ?? TAPE_PAGE_MAX_PX);
  const specs: TapeRowSpec[] = [];
  const linesByElement = new Map<number, string[]>();
  const overlayDividers: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isDivider(item)) {
      if (item.overlay && specs.length > 0) {
        // «Поверх текста»: места не занимает, ложится на предыдущий блок
        overlayDividers.push(i);
        continue;
      }
      // Оверлей первым элементом не к чему крепить — печатает как обычный блок
      specs.push({ elementIndex: i, lineIndex: 0, height: Math.max(1, item.height) });
      continue;
    }
    if (isImage(item)) {
      specs.push({ elementIndex: i, lineIndex: 0, height: Math.max(1, item.height) });
      continue;
    }
    if (isRuler(item)) {
      // Линейка — цельный блок; высота = floor(мм × PX_PER_MM),
      // та же математика, что у фиксированной этикетки
      specs.push({
        elementIndex: i,
        lineIndex: 0,
        height: rulerHeightPx(item),
      });
      continue;
    }
    if (isPricetag(item)) {
      // Ценник — цельный блок (не разрезается между страницами);
      // пустой (нет названия и цен) не занимает места, как пустой текст
      const m = measurePricetagItem(item);
      if (m.height > 0) {
        specs.push({ elementIndex: i, lineIndex: 0, height: m.height });
      }
      continue;
    }
    if (isTool(item)) {
      // Генератор: канвас нарезается на чанки ≤ страницы — чанки идут
      // строками потока (lineIndex = индекс чанка), переносятся целиком
      const chunks = toolItemChunks(item, capacityPx, opts?.i18n);
      chunks.forEach((chunk, ci) => {
        if (chunk.height > 0) specs.push({ elementIndex: i, lineIndex: ci, height: chunk.height });
      });
      continue;
    }
    if (isPricetagList(item)) {
      // Список ценников: каждый ценник — цельный блок (как одиночный);
      // пустые теги не занимают места. lineIndex = номер тега в списке.
      const tags = ptlistTagItems(item);
      tags.forEach((tag, ti) => {
        const m = measurePricetagItem(tag);
        if (m.height > 0) specs.push({ elementIndex: i, lineIndex: ti, height: m.height });
      });
      continue;
    }
    // Текст: каждая строка — атомарная единица переноса между страницами
    const lines = fieldLines(item as TextFieldItem);
    linesByElement.set(i, lines);
    const lh = item.fontSize * LINE_HEIGHT_FACTOR;
    for (let li = 0; li < lines.length; li++) {
      specs.push({ elementIndex: i, lineIndex: li, height: lh });
    }
  }
  return { specs, linesByElement, overlayDividers };
}

/* ------------------------------------------------------------------ */
/* Сборка страниц: синтетические элементы с абсолютными координатами    */
/* ------------------------------------------------------------------ */

export interface TapePage {
  /** Номер страницы с нуля */
  index: number;
  /** Высота страницы, px (= высота холста печати) */
  height: number;
  /** Фиксированная этикетка (пресет длины): печать занимает ВСЮ высоту */
  fixed?: boolean;
  /** Элементы страницы с абсолютными координатами (порядок = z-порядок) */
  items: LabelItem[];
}

export interface TapeLayout {
  pages: TapePage[];
  rows: TapeRowPlaced[];
  elementSegments: TapeElementSegment[][];
}

export interface TapeLayoutOptions {
  /** Фиксированная высота страницы, px («Настройки» → «Этикетка»);
   *  undefined — авто: страницы растут под содержимым до 90 мм */
  fixedPageHeight?: number;
  /** Перевод и локаль — подписи генераторов на печати */
  i18n?: TapeI18n;
}

/**
 * Полная компоновка ленты: измерить элементы, упаковать по страницам
 * (фиксированная высота из настроек или максимум 90 мм), собрать для
 * каждой страницы список элементов с абсолютными координатами.
 * Текстовый элемент, попавший на несколько страниц, превращается во
 * фрагменты (по строкам) — каждая часть рендерится как отдельное поле.
 *
 * Фиксированная лента (пресеты высоты этикетки): ценник, замыкающий
 * страницу (ниже него на этой странице ничего нет), растягивается до
 * конца этикетки — рамка занимает всю длину ленты, как на вкладке
 * «Ценник» (minHeightPx). Ничего не сдвигается: растяжка всегда
 * заканчивается в пределах страницы (до полезной высоты).
 */
export function layoutTape(items: LabelItem[], opts?: TapeLayoutOptions): TapeLayout {
  // Фиксированная этикетка (пресет длины) или авто-страницы до 90 мм:
  // ёмкость нужна измерению ДО паковки — чанки генераторов нарезаются под неё
  const fixedPx0 =
    opts?.fixedPageHeight && opts.fixedPageHeight >= PAGE_MIN_PX
      ? Math.floor(opts.fixedPageHeight)
      : undefined;
  const { specs, linesByElement, overlayDividers } = measureTapeItems(items, {
    capacityPx: fixedPx0 ?? TAPE_PAGE_MAX_PX,
    ...(opts?.i18n ? { i18n: opts.i18n } : {}),
  });
  const fixedPx = fixedPx0;
  const pack = packRows(specs, {
    ...(fixedPx ? { capacity: fixedPx, fixed: true } : {}),
  });

  // Растяжка ценников до конца этикетки: elementIndex → высота px.
  // Кандидат — ценник (или последний тег списка ценников), чья строка
  // последняя на своей странице: ниже него пусто, свободное место до конца
  // ленты отдаётся ему (рамка дотягивается до низа). Ценники выше
  // страницы-переполнения не растягиваются — им некуда (контент уже длиннее).
  const ptStretch = new Map<number, { target: number; lineIndex: number }>();
  if (fixedPx) {
    // Рамка растянутого ценника доходит до САМОГО края бумаги —
    // холст печати в фикс-режиме равен полной заданной длине
    const lastRow = new Map<number, TapeRowPlaced>();
    // Строки идут по потоку — последняя занесённая на страницу = нижняя
    for (const row of pack.rows) lastRow.set(row.page, row);
    for (const row of lastRow.values()) {
      const src = items[row.elementIndex];
      if (isPricetag(src)) {
        const target = fixedPx - row.y;
        if (target > row.height) ptStretch.set(row.elementIndex, { target, lineIndex: 0 });
      } else if (isPricetagList(src)) {
        // Тянем только последний тег списка: если за ним на следующей
        // странице идут ещё теги — растяжка была бы неверной
        if (row.lineIndex !== src.tags.length - 1) continue;
        const target = fixedPx - row.y;
        if (target > row.height)
          ptStretch.set(row.elementIndex, { target, lineIndex: row.lineIndex });
      }
    }
    for (const [ei, st] of ptStretch) {
      const row = pack.rows.find((r) => r.elementIndex === ei && r.lineIndex === st.lineIndex);
      if (row) row.height = st.target;
      const segs = pack.elementSegments[ei];
      if (segs?.length) segs[segs.length - 1].bottom = segs[segs.length - 1].top + st.target;
    }
  }

  const pages: TapePage[] = pack.pageHeights.map((height, index) => ({
    index,
    height,
    ...(fixedPx ? { fixed: true } : {}),
    items: [],
  }));

  // Текстовые фрагменты + обычные блоки: идём по строкам в порядке потока
  let fragmentElement = -1;
  let fragmentPage = -1;
  let fragmentFirstLine = 0;
  let fragmentLastLine = -1;
  let fragmentTop = 0;

  const flushFragment = () => {
    if (fragmentElement < 0) return;
    const src = items[fragmentElement] as TextFieldItem;
    const lines = linesByElement.get(fragmentElement) ?? [];
    const text = lines.slice(fragmentFirstLine, fragmentLastLine + 1).join("\n");
    pages[fragmentPage].items.push({ ...src, text, y: fragmentTop });
    fragmentElement = -1;
    fragmentPage = -1;
    fragmentLastLine = -1;
  };

  for (const row of pack.rows) {
    const item = items[row.elementIndex];
    if (isPricetag(item)) {
      flushFragment();
      // Растянутый ценник несёт высоту в служебном поле — рендерер
      // (drawPricetagItem) добелит блок до конца этикетки с рамкой
      const st = ptStretch.get(row.elementIndex);
      pages[row.page].items.push(
        st !== undefined ? { ...item, y: row.y, stretchToPx: st.target } : { ...item, y: row.y }
      );
      continue;
    }
    if (isTool(item)) {
      flushFragment();
      // Чанк генератора: рисуется из кэша чанков (renderTapePage)
      pages[row.page].items.push({ ...item, y: row.y, chunk: row.lineIndex });
      continue;
    }
    if (isPricetagList(item)) {
      flushFragment();
      // Синтетический ценник тега: тот же рендерер, что у одиночного
      const tag = ptlistTagItems(item)[row.lineIndex];
      if (tag) {
        const st = ptStretch.get(row.elementIndex);
        pages[row.page].items.push({
          ...tag,
          y: row.y,
          ...(st && st.lineIndex === row.lineIndex ? { stretchToPx: st.target } : {}),
        });
      }
      continue;
    }
    if (isRuler(item)) {
      flushFragment();
      // На фиксированной этикетке линейка, начинающая страницу, печатается
      // от самого края бумаги: 0 = начало этикетки, а при длине линейки =
      // длине этикетки последнее деление совпадает с концом бумаги.
      // Высота НЕ меняется — шкала честная (1 мм = PX_PER_MM точек).
      const y = fixedPx && row.y === PAGE_PAD_TOP ? 0 : row.y;
      pages[row.page].items.push({ ...item, y });
      continue;
    }
    if (isDivider(item) || isImage(item)) {
      flushFragment();
      pages[row.page].items.push({ ...item, y: row.y });
      continue;
    }
    // Строка текста: продолжаем фрагмент или начинаем новый
    if (
      row.elementIndex === fragmentElement &&
      row.page === fragmentPage &&
      row.lineIndex === fragmentLastLine + 1
    ) {
      fragmentLastLine = row.lineIndex;
    } else {
      flushFragment();
      fragmentElement = row.elementIndex;
      fragmentPage = row.page;
      fragmentFirstLine = row.lineIndex;
      fragmentLastLine = row.lineIndex;
      fragmentTop = row.y;
    }
  }
  flushFragment();

  // Разделители «поверх текста»: середина предыдущего блока со строками
  for (const idx of overlayDividers) {
    const d = items[idx];
    if (!isDivider(d)) continue;
    const h = Math.max(1, d.height);
    // Цель — ближайший предыдущий элемент, у которого есть строки на ленте
    let target = -1;
    for (let t = idx - 1; t >= 0; t--) {
      if (pack.elementSegments[t]?.length) {
        target = t;
        break;
      }
    }
    if (target < 0) {
      // Крепить не к чему — печатает как обычный блок в потоке
      const solo = pack.rows.find((r) => r.elementIndex === idx);
      if (solo) pages[solo.page].items.push({ ...d, y: solo.y });
      continue;
    }
    const seg = pack.elementSegments[target][0];
    const pageH = pages[seg.page].height;
    // Зажимаем низ оверлея полезной высотой страницы — иначе холст печати
    // вырастет на несколько пикселей сверх page.height
    const y = Math.max(
      0,
      Math.min(seg.top + (seg.bottom - seg.top) / 2 - h / 2, pageH - PAGE_PAD_BOTTOM - h)
    );
    pages[seg.page].items.push({ ...d, y: Math.round(y) });
  }

  return { pages, rows: pack.rows, elementSegments: pack.elementSegments };
}

/* ------------------------------------------------------------------ */
/* Вставка по точке броска: индекс элемента и позиция индикатора        */
/* ------------------------------------------------------------------ */

/**
 * Индекс вставки для точки (страница, offsetY): элемент вставляет ПЕРЕД
 * первым элементом, чья вертикальная середина на ленте находится ниже точки.
 * Возвращает количество элементов выше точки (= позиция в потоке).
 */
export function insertIndexAt(layout: TapeLayout, page: number, offsetY: number): number {
  let count = 0;
  for (let i = 0; i < layout.elementSegments.length; i++) {
    const segs = layout.elementSegments[i];
    if (!segs?.length) continue;
    const first = segs[0];
    const mid = (first.top + first.bottom) / 2;
    if (first.page < page || (first.page === page && mid <= offsetY)) count += 1;
  }
  return count;
}

/**
 * Y-координата индикатора вставки на странице: ближайшая граница строки
 * ниже точки броска (или низ контента страницы).
 */
export function indicatorYAt(layout: TapeLayout, page: number, offsetY: number): number {
  let best = -1;
  for (const row of layout.rows) {
    if (row.page !== page) continue;
    if (row.y >= offsetY - 2 && (best < 0 || row.y < best)) best = row.y;
  }
  if (best >= 0) return best;
  const pageH = layout.pages[page]?.height ?? TAPE_PAGE_MAX_PX;
  return Math.max(PAGE_PAD_TOP, pageH - PAGE_PAD_BOTTOM);
}

/* ------------------------------------------------------------------ */
/* Картинки ленты: декодирование + дизеринг с кэшем                     */
/* ------------------------------------------------------------------ */

const decodedImages = new Map<string, HTMLImageElement>();
const processedImages = new Map<string, HTMLCanvasElement>();
const failedImages = new Set<string>();

function imageKey(im: Pick<ImageItem, "src" | "dither" | "brightness" | "contrast">): string {
  return `${im.dither}|${im.brightness}|${im.contrast}|${im.src}`;
}

function requestDecodedImage(src: string, onSettled?: () => void): void {
  let img = decodedImages.get(src);
  if (!img) {
    img = new Image();
    img.onload = onSettled ?? null;
    img.onerror = () => {
      failedImages.add(src);
      onSettled?.();
    };
    img.src = src;
    decodedImages.set(src, img);
  } else if (img.complete) {
    onSettled?.();
  } else if (onSettled) {
    img.addEventListener("load", onSettled, { once: true });
    img.addEventListener("error", onSettled, { once: true });
  }
}

/**
 * Обработать картинку элемента: масштаб под ширину блока + тон + дизеринг
 * (те же алгоритмы, что у драйвера) → строго бинарный холст.
 * Возвращает null, пока файл не декодирован (или если он битый).
 */
export function processTapeImage(im: ImageItem): HTMLCanvasElement | null {
  const key = imageKey(im);
  const cached = processedImages.get(key);
  if (cached) return cached;
  if (failedImages.has(im.src)) return null;

  const img = decodedImages.get(im.src);
  if (!img || !img.complete || !img.naturalWidth) return null;

  const scaled = drawScaledToCanvas(img, Math.max(1, im.width));
  const out = document.createElement("canvas");
  applyImageSettings(scaled, out, {
    dither: im.dither,
    brightness: im.brightness,
    contrast: im.contrast,
    sharpen: 0,
  });
  processedImages.set(key, out);
  return out;
}

/** Прогреть кэш картинок ленты (превью перерисуется через onReady) */
export function preloadTapeImages(items: LabelItem[], onReady?: () => void): void {
  for (const it of items) {
    if (!isImage(it)) continue;
    const key = imageKey(it);
    if (processedImages.has(key) || failedImages.has(it.src)) continue;
    requestDecodedImage(it.src, () => {
      processTapeImage(it);
      onReady?.();
    });
  }
}

/** Дождаться готовности всех картинок ленты (перед печатью) */
export function ensureTapeImages(items: LabelItem[]): Promise<void> {
  const list = items.filter(isImage);
  return Promise.all(
    list.map(
      (im) =>
        new Promise<void>((resolve) => {
          const run = () => {
            processTapeImage(im);
            resolve();
          };
          const img = decodedImages.get(im.src);
          if (processedImages.has(imageKey(im)) || failedImages.has(im.src)) {
            resolve();
          } else if (img && img.complete) {
            run();
          } else {
            requestDecodedImage(im.src, run);
          }
        })
    )
  ).then(() => undefined);
}

/**
 * Вписать натуральные размеры картинки в блок ленты 384 × 720
 * (сохранение пропорций; маленькие картинки не растягиваются).
 */
export function fitImageSize(
  naturalW: number,
  naturalH: number,
  maxW = PRINTER_HEAD_WIDTH,
  maxH = TAPE_PAGE_MAX_PX
): { width: number; height: number } {
  const w = Math.max(1, naturalW);
  const h = Math.max(1, naturalH);
  const scale = Math.min(1, maxW / w, maxH / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/* ------------------------------------------------------------------ */
/* Рендер страницы ленты (превью = холст печати)                        */
/* ------------------------------------------------------------------ */

/**
 * Отрисовать страницу ленты на холсте 384 × page.height:
 * текст/разделители/ценники — через renderLabelToCanvas (суперсэмплинг +
 * бинаризация + полутон эмодзи), картинки и чанки генераторов — бинарные
 * растры поверх без сглаживания.
 *
 * Высота холста: авто-режим — от верха до контента (нижний отступ в печать
 * не уходит); ФИКСИРОВАННАЯ этикетка — вся заданная длина (пресет 30 мм =
 * 240 точек бумаги, иначе печать выходила короче заявленного на отступ).
 * i18n нужен для чанков генераторов (подписи на печати, кэш по содержимому).
 * Возвращает фактическую высоту холста.
 */
export function renderTapePage(
  canvas: HTMLCanvasElement,
  page: TapePage,
  i18n?: TapeI18n,
  scale: number = SUPER_SAMPLE
): number {
  const flat: LabelItem[] = [];
  const images: ImageItem[] = [];
  const tools: ToolItem[] = [];
  for (const it of page.items) {
    if (isImage(it)) images.push(it);
    else if (isTool(it)) tools.push(it);
    else flat.push(it);
  }

  const canvasHeight = page.fixed
    ? page.height
    : Math.max(1, page.height - PAGE_PAD_BOTTOM);
  const height = renderLabelToCanvas(canvas, flat, canvasHeight, scale);

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    if (images.length) {
      for (const im of images) {
        const proc = processTapeImage(im);
        if (proc) ctx.drawImage(proc, im.x, im.y);
      }
    }
    if (tools.length) {
      // maxPx должен совпадать с ёмкостью при раскладке — иначе индексы
      // чанков не сойдутся: фикс-режим — высота страницы, авто — 90 мм
      const maxPx = page.fixed ? page.height : TAPE_PAGE_MAX_PX;
      for (const tool of tools) {
        const chunk = toolItemChunks(tool, maxPx, i18n)[tool.chunk ?? 0];
        if (chunk) ctx.drawImage(chunk, tool.x, tool.y);
      }
    }
  }
  return height;
}
