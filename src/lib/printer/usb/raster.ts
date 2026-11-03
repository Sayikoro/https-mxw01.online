/**
 * ============================================================================
 *  РАСТЕРИЗАЦИЯ БИНАРНОГО ХОЛСТА ДЛЯ USB-ПЕЧАТИ (v1.0.42) — чистые функции,
 *  без DOM и браузерных canvas-хелперов: детерминированный результат,
 *  покрывается юнит-тестами на bun.
 * ============================================================================
 *  Проблема: весь контент приложения (чек, текст, ценники, копии, лента)
 *  доходит до printCanvas УЖЕ СТРОГО ЧЁРНО-БЕЛЫМ (canvas-quality.ts:
 *  4× суперсэмплинг + бинаризация). Но printCanvas по умолчанию печатает
 *  с дизерингом Флойда—Стейнберга, а перед энкодером холст масштабируется
 *  под ширину этикетки/бумаги однократным drawImage СО СГЛАЖИВАНИЕМ:
 *    - TSPL: этикетка уже 48 мм → растр 384 px сжимается (напр. до 320);
 *    - ESC/POS: бумага 80 мм → растр растягивается 384 → 576.
 *  Сглаживание даёт СЕРЫЕ края букв, а дизеринг рассыпает серые края в
 *  шумные точки — печать выглядит нечёткой/лохматой («чеки как картинки»).
 *
 *  Решение: если источник строго бинарный —
 *    - уменьшение: box-усреднение по площади + жёсткий порог 128
 *      (как в факсах: серый край от усреднения сразу превращается в ч/б,
 *      рассыпаться нечему — край остаётся чётким);
 *    - увеличение: nearest-neighbor (без сглаживания) — растр остаётся
 *      строго бинарным, точки жёсткие;
 *    - 1:1 — растр уходит как есть.
 *  Дизеринг для бинарного источника отключается (ему нечего размывать).
 *  Полутоновые источники (фотографии с серыми пикселями) идут прежним
 *  путём: сглаживание + дизеринг драйвера/энкодера.
 * ============================================================================
 */

import type { RasterSource } from "./escpos";

/** Строгий вид результата: данные всегда Uint8ClampedArray (для TsplImage) */
export interface BinarySource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Порог бинаризации при box-уменьшении (чёрный = яркость < порога) */
export const BINARY_LUMA_THRESHOLD = 128;

/** Базовое разрешение сетки дизайна приложения (v1.0.43): весь контент
 * рисуется из расчёта 8 px/мм — это 203 dpi (точнее 203.2, округлённые
 * до «203» в спецификациях термоголовок MXW01 / Gprinter BP21). */
export const USB_BASE_DPI = 203;

/** Разрешение головки по умолчанию (MXW01, Gprinter BP21) */
export const USB_DEFAULT_DPI = USB_BASE_DPI;

/** Допустимый диапазон DPI (пресеты 203/300/600 — в «Настройках») */
export const USB_DPI_MIN = 100;
export const USB_DPI_MAX = 600;

/** Зажим DPI из настройки в допустимый диапазон, целыми */
export function clampUsbDpi(dpi: number): number {
  return Math.min(USB_DPI_MAX, Math.max(USB_DPI_MIN, Math.round(dpi)));
}

/** Точек на мм при разрешении головки dpi (203 → 8, 300 → ≈11.82, 600 → ≈23.65) */
export function dpiToDotsPerMm(dpi: number): number {
  const d = Math.min(2000, Math.max(1, dpi));
  return (8 * d) / USB_BASE_DPI;
}

/**
 * ============================================================================
 *  ПЛОТНОСТЬ POS-ВЕТКИ (v1.0.45) — считается ОТ ХАРАКТЕРИСТИК ПРИНТЕРА,
 *  а не от дизайн-сетки приложения. Печать по BLE (MXW01) продолжает
 *  считаться как раньше (холст 384 px = вся ширина головки) — правило
 *  ниже касается ТОЛЬКО USB/POS-транспорта (ESC/POS и TSPL).
 * ============================================================================
 *  Спецификация Gprinter BP21 (по данным пользователя):
 *    - разрешение (плотность): 203 dpi = 8 точек/мм;
 *    - максимальная ширина печати: 54 мм;
 *    - ширина в точках: 54 мм × (203 / 25.4) = 431.6 ≈ 432 точки.
 *  Головка физически не может напечатать шире 54 мм — всё, что правее,
 *  принтер отбрасывает. Поэтому POS-растр зажимается в headDots точек.
 */

/** Максимальная печатная ширина головки POS-принтера (Gprinter BP21), мм */
export const USB_POS_MAX_PRINT_MM = 54;

/** Ширина головки POS-принтера в точках: 54 мм × dpi / 25.4.
 *  203 dpi → 432 точки (ровно 54 мм × 8 точек/мм), 300 → 638, 600 → 1276.
 *  dpi зажимается clampUsbDpi (100…600), результат минимум 1. */
export function usbPosHeadDots(dpi: number): number {
  const d = clampUsbDpi(dpi);
  return Math.max(1, Math.round((USB_POS_MAX_PRINT_MM * d) / 25.4));
}

/**
 * Целевая ширина TSPL-растра (в точках головки) для холста, спроектированного
 * на базовой сетке 8 px/мм (384 px = 48 мм), при разрешении головки dpi.
 *
 * Контент масштабируется к физическому размеру, который он занимает на
 * этикетке: точек_головки = мм · dotsPerMm(dpi). Апскейл сверх ширины
 * этикетки не делается (как и в v1.0.40), ужимание — только по ширине.
 *
 * При 203 dpi математика ПОБИТНО идентична прежней: labelPxW = labelW·8,
 * scale = min(1, labelPxW / canvas.width), target = floor(canvas.width·scale).
 */
export function tsplTargetWidth(
  canvasWidth: number,
  labelWidthMm: number,
  dpi: number
): { target: number; labelPxW: number; dotsPerMm: number } {
  const dotsPerMm = dpiToDotsPerMm(dpi);
  const labelPxW = Math.max(1, Math.round(labelWidthMm * dotsPerMm));
  const contentDots = canvasWidth * (dotsPerMm / 8);
  const scale = Math.min(1, labelPxW / contentDots);
  const target = Math.max(1, Math.floor(contentDots * scale));
  return { target, labelPxW, dotsPerMm };
}

/** Вес яркости BT.601 — те же, что в энкодерах ESC/POS и TSPL */
function luma601(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Обрезка полностью пустых рядов сверху и снизу растра (v1.0.46).
 *
 * Зачем: белый фон холста (поля картинки, «хвост» фиксированной этикетки)
 * уходит в печать как есть — с DIRECTION 1 пустой верх растра физических
 * миллиметров ленты протягивается ДО содержимого («принтер выплёвывает
 * ленту и только потом печатает»). Ряд пуст, если в нём НЕТ ни одного
 * «чернильного» пикселя (яркость < BINARY_LUMA_THRESHOLD — тот же порог,
 * что в бинаризации/дизеринге энкодеров).
 *
 * Только для СТРОГО бинарных источников: полутоновые светлые области
 * (серый 150–250) дизерингом всё же печатаются точками — обрезать их
 * нельзя, поэтому вызывать нужно только после isBinaryRgba = true.
 * Полностью пустой растр возвращается без изменений (нулевую высоту
 * энкодер не примет); без пустых полей — тоже как есть.
 */
export function trimBlankRows(src: RasterSource): BinarySource {
  const { width: w, height: h, data } = src;
  if (w <= 0 || h <= 0) {
    return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  }
  const rowHasInk = (y: number): boolean => {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const p = row + x * 4;
      const a = data[p + 3] / 255;
      const r = data[p] * a + 255 * (1 - a);
      const g = data[p + 1] * a + 255 * (1 - a);
      const b = data[p + 2] * a + 255 * (1 - a);
      if (luma601(r, g, b) < BINARY_LUMA_THRESHOLD) return true;
    }
    return false;
  };
  let top = 0;
  while (top < h && !rowHasInk(top)) top++;
  if (top === h) return { data: data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data), width: w, height: h };
  let bottom = h - 1;
  while (bottom > top && !rowHasInk(bottom)) bottom--;
  const newH = bottom - top + 1;
  if (newH === h) {
    return { data: data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data), width: w, height: h };
  }
  const out = new Uint8ClampedArray(w * newH * 4);
  out.set(
    (data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data)).subarray(top * w * 4, (bottom + 1) * w * 4)
  );
  return { data: out, width: w, height: newH };
}

/**
 * Строго ли бинарный RGBA-растр (каждый пиксель непрозрачный и чёрный/
 * белый: яркость ровно 0 или 255)? Ранний выход на первом сером пикселе.
 * Альфа < 255 считается не-бинарной (композит с белым даст серый).
 */
export function isBinaryRgba(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] !== 255) return false;
    const l = luma601(data[p], data[p + 1], data[p + 2]);
    if (l !== 0 && l !== 255) return false;
  }
  return true;
}

/**
 * Ресемпл бинарного растра под ширину dstW (высота — пропорционально,
 * округление как в прежнем rasterize: round(h · dstW / w)).
 *   dstW === w          → растр возвращается как есть (без копии);
 *   dstW > w (увелич.)  → nearest-neighbor: пиксели остаются 0/255;
 *   dstW < w (уменьш.)  → box-усреднение + порог 128 → снова 0/255.
 * Альфа композитится на белый (как в энкодерах); результат всегда
 * непрозрачный RGBA строго 0/255.
 */
export function resampleBinary(src: RasterSource, dstW: number): BinarySource {
  const { width: w, height: h } = src;
  if (w <= 0 || h <= 0 || dstW <= 0) {
    return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  }
  const dstH = Math.max(1, Math.round((h * dstW) / w));
  if (dstW === w && dstH === h) {
    // 1:1 — растр возвращается как есть (энкодеры только читают data)
    return src as BinarySource;
  }

  const out = new Uint8ClampedArray(dstW * dstH * 4);

  if (dstW > w) {
    // --- Увеличение: nearest-neighbor, значения остаются ровно 0/255 ---
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(h - 1, Math.floor((y + 0.5) * (h / dstH)));
      const srcRow = sy * w * 4;
      const dstRow = y * dstW * 4;
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(w - 1, Math.floor((x + 0.5) * (w / dstW)));
        const sp = srcRow + sx * 4;
        const dp = dstRow + x * 4;
        out[dp] = src.data[sp];
        out[dp + 1] = src.data[sp + 1];
        out[dp + 2] = src.data[sp + 2];
        out[dp + 3] = 255;
      }
    }
    return { data: out, width: dstW, height: dstH };
  }

  // --- Уменьшение: площадное усреднение (дробное покрытие, как у area-
  //     ресемплинга) + порог. Дробные веса важны: пиксельный box при
  //     сжатии 384→320 раздувает линию 1 px в две полупокрытые точки,
  //     площадное покрытие оставляет ровно одну чистую точку ---
  const xa = new Float64Array(dstW);
  const xb = new Float64Array(dstW);
  for (let x = 0; x < dstW; x++) {
    xa[x] = (x * w) / dstW;
    xb[x] = ((x + 1) * w) / dstW;
  }
  for (let y = 0; y < dstH; y++) {
    const ya = (y * h) / dstH;
    const yb = ((y + 1) * h) / dstH;
    for (let x = 0; x < dstW; x++) {
      const sy0 = Math.max(0, Math.floor(ya));
      const sy1 = Math.min(h, Math.ceil(yb));
      const sx0 = Math.max(0, Math.floor(xa[x]));
      const sx1 = Math.min(w, Math.ceil(xb[x]));
      let sum = 0;
      let wsum = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const oy = Math.min(yb, sy + 1) - Math.max(ya, sy);
        if (oy <= 0) continue;
        const row = sy * w * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          const ox = Math.min(xb[x], sx + 1) - Math.max(xa[x], sx);
          if (ox <= 0) continue;
          const wgt = ox * oy;
          const p = row + sx * 4;
          const a = src.data[p + 3] / 255;
          const r = src.data[p] * a + 255 * (1 - a);
          const g = src.data[p + 1] * a + 255 * (1 - a);
          const b = src.data[p + 2] * a + 255 * (1 - a);
          sum += luma601(r, g, b) * wgt;
          wsum += wgt;
        }
      }
      const avg = wsum > 0 ? sum / wsum : 255;
      const dp = (y * dstW + x) * 4;
      const v = avg < BINARY_LUMA_THRESHOLD ? 0 : 255;
      out[dp] = v;
      out[dp + 1] = v;
      out[dp + 2] = v;
      out[dp + 3] = 255;
    }
  }
  return { data: out, width: dstW, height: dstH };
}
