/**
 * ============================================================================
 *  ОБРАБОТКА ИЗОБРАЖЕНИЙ для вкладки «Изображение» — слой приложения.
 * ============================================================================
 *  Пайплайн (полностью повторяет порядок обработки драйвера, но выполняется
 *  ДО печати, на стороне приложения — драйвер НЕ изменяется):
 *
 *    1. Люма: альфа смешивается с белым, яркость по BT.709 (как в драйвере);
 *    2. Тон: гамма-яркость (−100…+100) → контраст (−100…+100);
 *    3. Резкость: unsharp mask (0…100);
 *    4. Дизеринг: точные копии алгоритмов драйвера (steinberg/bayer/atkinson/
 *       none) → на выходе СТРОГО бинарный холст (0 или 255).
 *
 *  Печать выполняется вызовом printCanvas(canvas) БЕЗ параметров: драйверные
 *  дефолты (steinberg, brightness 128, intensity 93) на строго ч/б холсте
 *  дают тождество — на бумагу уходит ровно то, что видно в предпросмотре.
 * ============================================================================
 */

export type ImageDither = "steinberg" | "bayer" | "atkinson" | "none";

export interface ImageToneSettings {
  dither: ImageDither;
  /** Гамма-яркость −100…+100 (0 = без изменений) */
  brightness: number;
  /** Контраст −100…+100 (0 = без изменений) */
  contrast: number;
  /** Резкость 0…100 (0 = без изменений) */
  sharpen: number;
}

/* ------------------------------------------------------------------ */
/* 1. Люма (точная копия драйвера: альфа → белый, веса BT.709)         */
/* ------------------------------------------------------------------ */

/**
 * RGBA → массив яркостей (по одному байту на пиксель).
 * Альфа < 255: цвет смешивается с белым (как в драйвере), поэтому
 * прозрачный фон картинки печатается белым, а не чёрным.
 */
export function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const a = rgba[i + 3] / 255;
    let r = rgba[i];
    let g = rgba[i + 1];
    let b = rgba[i + 2];
    if (a < 1) {
      const w = 1 - a;
      r += (255 - r) * w;
      g += (255 - g) * w;
      b += (255 - b) * w;
    } else {
      r *= a;
      g *= a;
      b *= a;
    }
    out[j] = r * 0.2125 + g * 0.7154 + b * 0.0721;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Тон: гамма-яркость + контраст                                    */
/* ------------------------------------------------------------------ */

/**
 * Тоновая коррекция.
 *
 * Яркость — ГАММА (а не линейный сдвиг): f = 255·(f/255)^g, g = 2^(−b/50).
 *   b = −100 → g = 4 (сильно темнее), b = +100 → g = 0.25 (сильно светлее).
 * Главное свойство: чёрный (0) и белый (255) НЕ сдвигаются ни при каком
 * значении — белое поле этикетки не «грязнится».
 *
 * Контраст — растяжка вокруг 128: f = (f−128)·k + 128, k = (100+c)/100.
 */
export function grayWithTone(
  gray: Uint8ClampedArray,
  brightness: number,
  contrast: number
): Uint8ClampedArray {
  const gamma = Math.pow(2, -brightness / 50);
  const k = (100 + contrast) / 100;
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    let f = gray[i];
    if (gamma !== 1) f = 255 * Math.pow(f / 255, gamma);
    if (k !== 1) f = (f - 128) * k + 128;
    out[i] = f;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. Резкость: unsharp mask                                           */
/* ------------------------------------------------------------------ */

/**
 * Unsharp mask: out = f + k·(f − blur(f)), где blur — гауссово ядро 3×3,
 * аппроксимированное разделимыми проходами [1,2,1]/4 по осям (края — с
 * дублированием крайних пикселей). k = amount/100, amount 0…100.
 */
export function sharpenGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number
): Uint8ClampedArray {
  if (amount <= 0 || width < 3 || height < 3) return gray.slice();
  const k = amount / 100;

  // Горизонтальный проход [1,2,1]/4
  const blur = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const l = gray[row + (x > 0 ? x - 1 : 0)];
      const c = gray[row + x];
      const r = gray[row + (x < width - 1 ? x + 1 : width - 1)];
      blur[row + x] = (l + 2 * c + r) / 4;
    }
  }

  // Вертикальный проход + вычитание (unsharp)
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const row = y * width;
    const dn = (y < height - 1 ? y + 1 : height - 1) * width;
    for (let x = 0; x < width; x++) {
      const blurred = (blur[up + x] + 2 * blur[row + x] + blur[dn + x]) / 4;
      out[row + x] = gray[row + x] + k * (gray[row + x] - blurred);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. Автотон по гистограмме                                           */
/* ------------------------------------------------------------------ */

/**
 * Предложить яркость/контраст по гистограмме яркости:
 *   • lo/hi — 1-й и 99-й перцентили (устойчиво к выбросам);
 *   • контраст растягивает диапазон [lo, hi] (k = 255/(hi−lo), до 2.2×);
 *   • гамма-яркость ставит середину диапазона на 128.
 * Уже контрастное изображение → {0, 0} (кнопка «Авто» ничего не ломает).
 */
export function autoTone(gray: Uint8ClampedArray): {
  brightness: number;
  contrast: number;
} {
  const total = gray.length;
  if (!total) return { brightness: 0, contrast: 0 };

  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) hist[gray[i]]++;

  const percentile = (p: number): number => {
    const target = Math.max(1, Math.floor(total * p));
    let cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= target) return v;
    }
    return 255;
  };

  const lo = percentile(0.01);
  const hi = percentile(0.99);
  if (hi - lo < 8) return { brightness: 0, contrast: 0 };

  const k = Math.min(2.2, 255 / (hi - lo));
  const contrast = Math.min(100, Math.round((k - 1) * 100));

  // Середина диапазона после контраст-растяжки должна попасть в 128
  const mid = (lo + hi) / 2;
  const post = ((mid - 128) * k + 128) / 255;
  let brightness = 0;
  if (post > 0.02 && post < 0.98) {
    const gamma = Math.log(128 / 255) / Math.log(post);
    brightness = Math.max(-100, Math.min(100, Math.round(-50 * Math.log2(gamma))));
  }
  return { brightness, contrast };
}

/* ------------------------------------------------------------------ */
/* 5. Дизеринг — точные копии алгоритмов драйвера                      */
/* ------------------------------------------------------------------ */

/** Матрица Байера 8×8 драйвера */
export const BAYER8: readonly number[] = [
  0, 48, 12, 60, 3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56, 4, 52, 11, 59, 7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58, 6, 54, 9, 57, 5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
];

/** Коэффициент дизеринга Байера драйвера */
export const BAYER_FACTOR = 0.6;

/**
 * Дизеринг НА МЕСТЕ (как в драйвере — массив мутируется).
 * После вызова каждый пиксель — строго 0 или 255.
 */
export function ditherGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  method: ImageDither
): Uint8ClampedArray {
  const e = width;
  const r = height;

  if (method === "none") {
    // Жёсткий порог (копия драйверного threshold)
    for (let i = 0; i < gray.length; ++i) gray[i] = gray[i] > 128 ? 255 : 0;
    return gray;
  }

  if (method === "bayer") {
    let i = 0;
    for (let s = 0; s < r; ++s) {
      for (let n = 0; n < e; ++n) {
        const c = BAYER8[(s % 8) * 8 + (n % 8)];
        let o = gray[i];
        o = o + (c - 32) * BAYER_FACTOR;
        o = Math.max(0, Math.min(255, o));
        gray[i] = o > 128 ? 255 : 0;
        ++i;
      }
    }
    return gray;
  }

  if (method === "atkinson") {
    let i = 0;
    for (let s = 0; s < r; ++s) {
      for (let n = 0; n < e; ++n) {
        const c = gray[i];
        const o = c > 128 ? 255 : 0;
        const h = (c - o) >> 3;
        gray[i] = o;
        if (n < e - 1) gray[i + 1] += h;
        if (n < e - 2) gray[i + 2] += h;
        if (s < r - 1) {
          if (n > 0) gray[i + e - 1] += h;
          gray[i + e] += h;
          if (n < e - 1) gray[i + e + 1] += h;
        }
        if (s < r - 2) gray[i + 2 * e] += h;
        ++i;
      }
    }
    return gray;
  }

  // steinberg (Floyd–Steinberg) — метод по умолчанию
  let i = 0;
  for (let s = 0; s < r; ++s) {
    for (let n = 0; n < e; ++n) {
      const c = gray[i];
      const o = c > 128 ? 255 : 0;
      const h = c - o;
      gray[i] = o;
      if (n < e - 1) gray[i + 1] += (h * 7) / 16;
      if (s < r - 1) {
        if (n > 0) gray[i + e - 1] += (h * 3) / 16;
        gray[i + e] += (h * 5) / 16;
        if (n < e - 1) gray[i + e + 1] += h / 16;
      }
      ++i;
    }
  }
  return gray;
}

/* ------------------------------------------------------------------ */
/* 6. Применение настроек к холстам                                    */
/* ------------------------------------------------------------------ */

/**
 * Обработать source и положить результат в target (target получает размеры
 * source). Выход строго бинарный: 0 или 255 в каждом пикселе.
 */
export function applyImageSettings(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  settings: ImageToneSettings
): void {
  const sctx = source.getContext("2d");
  if (!sctx) return;
  const img = sctx.getImageData(0, 0, source.width, source.height);

  let gray = toGray(img.data);
  gray = grayWithTone(gray, settings.brightness, settings.contrast);
  gray = sharpenGray(gray, source.width, source.height, settings.sharpen);
  ditherGray(gray, source.width, source.height, settings.dither);

  target.width = source.width;
  target.height = source.height;
  const tctx = target.getContext("2d");
  if (!tctx) return;
  const out = tctx.createImageData(source.width, source.height);
  for (let j = 0, p = 0; j < gray.length; j++, p += 4) {
    out.data[p] = gray[j];
    out.data[p + 1] = gray[j];
    out.data[p + 2] = gray[j];
    out.data[p + 3] = 255;
  }
  tctx.putImageData(out, 0, 0);
}

/**
 * Прогрессивный даунскейл картинки к ширине ленты (384 px): пока картинка
 * широкая, сжимаем вдвое (качественно), затем финальный проход с high
 * quality. Мелкие картинки НЕ растягиваются (пиксель-арт остаётся чётким).
 * Рисует на белый фон (прозрачность → белый).
 */
export function drawScaledToCanvas(
  img: HTMLImageElement,
  tapeWidth = 384
): HTMLCanvasElement {
  let cur: HTMLCanvasElement = document.createElement("canvas");
  cur.width = img.naturalWidth || img.width;
  cur.height = img.naturalHeight || img.height;
  let cctx = cur.getContext("2d")!;
  cctx.drawImage(img, 0, 0);

  // Промежуточные halves: пока ширина больше удвоенной целевой
  while (cur.width > tapeWidth * 2) {
    const half = document.createElement("canvas");
    half.width = Math.max(tapeWidth, Math.floor(cur.width / 2));
    half.height = Math.max(1, Math.floor(cur.height / 2));
    const hctx = half.getContext("2d")!;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.fillStyle = "#ffffff";
    hctx.fillRect(0, 0, half.width, half.height);
    hctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }

  const targetW = Math.min(tapeWidth, cur.width);
  const scale = targetW / cur.width;
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = Math.max(1, Math.round(cur.height * scale));
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

/**
 * Масштабировать готовый холст до заданной ширины (v1.0.44, вкладка
 * «Изображение»): ширина контента = доля от ширины печати, высота —
 * пропорционально. 1:1 — холст возвращается как есть (без копии).
 * Увеличение и уменьшение — со сглаживанием (high): источник ДО тона и
 * дизеринга, поэтому точки не размываются — дизеринг выполняется уже
 * на финальном размере. Рисует на белый фон.
 */
export function scaleCanvasToWidth(
  src: HTMLCanvasElement,
  targetW: number
): HTMLCanvasElement {
  const w = Math.max(1, targetW);
  if (src.width === w) return src;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = Math.max(1, Math.round((src.height * w) / src.width));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}
