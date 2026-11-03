/**
 * ============================================================================
 *  ESC/POS-ЭНКОДЕР ДЛЯ POS-ПРИНТЕРОВ (WebUSB) — чистые функции, без DOM.
 * ============================================================================
 *  - Вход: RGBA-пиксели холста печати (как у printCanvas, но мы НЕ трогаем
 *    сам printCanvas и BLE-драйвер MXW01 — это полностью отдельный путь);
 *  - выход: готовый поток байт ESC/POS для отправки в bulk-out канал;
 *  - растр печатается командой GS v 0 (raster bit image):
 *      1D 76 30 m xL xH yL yH [data]
 *    где xL/xH — байт на строку (xL + xH×256), yL/yH — число строк
 *    (yL + yH×256). Данные: старший бит первого байта = самая левая точка;
 *    1 = точка выжжена;
 *  - изображение уходит чанками по chunkRows строк — у клонов принтеров
 *    маленький приёмный буфер, один большой растр они не переваривают;
 *  - выравнивание — ВСЕГДА по левому краю (v1.0.38): ESC @ в начале потока
 *    сбрасывает выравнивание в левое, центрирование не включаем; опция
 *    center осталась для особых случаев (по умолчанию false);
 *  - опция invert (v1.0.38) — инверсия серого перед бинаризацией: если
 *    принтер печатает негатив (1 = белая точка вместо чёрной), включаем
 *    в настройках приложения.
 * ============================================================================
 */

export interface RasterSource {
  /** RGBA-байты, длина = width × height × 4 */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface EscposEncodeOptions {
  /** Строк на одну команду GS v 0 (по умолчанию 64 — безопасно для клонов) */
  chunkRows?: number;
  /** true — дизеринг Флойда—Стейнберга; false — жёсткий порог (threshold) */
  dither?: boolean;
  /** Порог ч/б 0…255 для dither=false (по умолчанию 150) */
  threshold?: number;
  /** Инициализация ESC @ в начале потока (по умолчанию true) */
  init?: boolean;
  /** Центрирование растра ESC a 1 … ESC a 0 (по умолчанию false — всегда левый край) */
  center?: boolean;
  /** Инверсия цветов канваса: серый → 255 − серый перед бинаризацией (по умолчанию false) */
  invert?: boolean;
  /** Чёткая печать (v1.0.41): гамма-усиление 1.5 до бинаризации — полутона
   *  темнеют, тонкие штрихи и края шрифта ловятся сплошными точками вместо
   *  светло-серого дизеринга (сам DPI головки фиксирован, чёткость растёт
   *  за счёт контраста). По умолчанию false */
  enhance?: boolean;
  /** Прогон строк (LF) после изображения (по умолчанию 3) */
  feedLines?: number;
  /** Отрезать чек GS V 0 в конце (по умолчанию false — не у всех есть резак) */
  cut?: boolean;
}

export const ESCPOS_ESC = 0x1b;
export const ESCPOS_GS = 0x1d;
export const ESCPOS_LF = 0x0a;

/** ESC @ — сброс/инициализация принтера */
export function escposInit(): Uint8Array {
  return new Uint8Array([ESCPOS_ESC, 0x40]);
}

/** ESC a n — выравнивание строки: 0 лево, 1 центр, 2 право */
export function escposAlign(n: 0 | 1 | 2): Uint8Array {
  return new Uint8Array([ESCPOS_ESC, 0x61, n]);
}

/** Заголовок GS v 0 (m=0, обычная плотность): bytesPerRow и rows — little-endian 16 бит */
export function escposRasterHeader(bytesPerRow: number, rows: number): Uint8Array {
  return new Uint8Array([
    ESCPOS_GS,
    0x76,
    0x30,
    0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    rows & 0xff,
    (rows >> 8) & 0xff,
  ]);
}

/** LF × n — прогон бумаги */
export function escposFeed(n: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, n));
  out.fill(ESCPOS_LF);
  return out;
}

/** GS V 0 — полный отрез чека (если у принтера есть авто-резак) */
export function escposCut(): Uint8Array {
  return new Uint8Array([ESCPOS_GS, 0x56, 0x00]);
}

/**
 * Яркость пикселя 0…255. RGBA композируется на белый фон (прозрачные места
 * этикетки не должны печататься как чёрные точки).
 */
function pixelLuminance(data: Uint8ClampedArray | Uint8Array, idx: number): number {
  const a = (data[idx + 3] ?? 255) / 255;
  const r = data[idx] * a + 255 * (1 - a);
  const g = data[idx + 1] * a + 255 * (1 - a);
  const b = data[idx + 2] * a + 255 * (1 - a);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Склеить несколько буферов в один (без изменения исходных) */
function concatBuffers(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Главная функция: RGBA → бинарные строки → поток ESC/POS.
 * Детерминирована (дизеринг без «змейки») — покрыта юнит-тестами на байты.
 */
export function encodeEscposRaster(
  src: RasterSource,
  opts: EscposEncodeOptions = {}
): Uint8Array {
  const chunkRows = Math.max(1, Math.floor(opts.chunkRows ?? 64));
  const useDither = opts.dither ?? true;
  const threshold = opts.threshold ?? 150;
  const { width, height } = src;
  if (width <= 0 || height <= 0) return new Uint8Array(0);
  const bytesPerRow = Math.ceil(width / 8);

  // 1) Серая матрица (float, ошибки дизеринга живут в ней же)
  const buf = new Float32Array(width * height);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = pixelLuminance(src.data, i * 4);
  }
  // 1a) Инверсия цветов (настройка «Инверсия канваса»): честный негатив
  //     уже скомпозитного серого — прозрачные места (белые) станут чёрными
  if (opts.invert) {
    for (let i = 0; i < buf.length; i++) buf[i] = 255 - buf[i];
  }
  // 1b) Чёткая печать (v1.0.41): серый → 255·(серый/255)^1.5 = 255·v·√v —
  //     края (0 и 255) неподвижны, середина уходит в тёмное; сверху ляжет
  //     бинаризация — шрифт и линии печатаются плотнее/чётче
  if (opts.enhance) {
    for (let i = 0; i < buf.length; i++) {
      const v = Math.min(1, Math.max(0, buf[i] / 255));
      buf[i] = 255 * v * Math.sqrt(v);
    }
  }

  // 2) Бинарные биты: Floyd–Steinberg (7/16, 3/16, 5/16, 1/16) или порог
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const black = useDither ? old < 128 : old < threshold;
      if (black) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      if (!useDither) continue;
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16;
        buf[i + width] += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1] += err / 16;
      }
    }
  }

  // 3) Сборка потока команд
  const parts: Uint8Array[] = [];
  if (opts.init !== false) parts.push(escposInit());
  const center = opts.center ?? false;
  if (center) parts.push(escposAlign(1));
  for (let y0 = 0; y0 < height; y0 += chunkRows) {
    const rows = Math.min(chunkRows, height - y0);
    parts.push(escposRasterHeader(bytesPerRow, rows));
    parts.push(bits.subarray(y0 * bytesPerRow, (y0 + rows) * bytesPerRow));
  }
  const feed = opts.feedLines ?? 3;
  if (feed > 0) parts.push(escposFeed(feed));
  if (opts.cut) parts.push(escposCut());
  if (center) parts.push(escposAlign(0));
  return concatBuffers(parts);
}
