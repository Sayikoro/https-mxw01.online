/**
 * ============================================================================
 *  КАЧЕСТВО ПЕЧАТИ: суперсэмплинг + бинаризация холста печати.
 * ============================================================================
 *  Проблема: fillText в canvas всегда рисует текст СО СГЛАЖИВАНИЕМ — по краям
 *  букв остаются СЕРЫЕ пиксели. Драйвер MXW01 перед печатью применяет дизеринг
 *  Флойда–Стайнберга, который превращает серые пиксели в рассыпанные чёрные
 *  точки → у букв на печати появляются «волнистые», рваные края.
 *
 *  Решение (только сторона рендеринга UI — драйвер НЕ изменяется):
 *    1. Макет рисуется в 4× разрешении (1536 px на ширину головки 384);
 *    2. Плавно сжимается до 384 px (последовательное сжатие вдвое, high quality);
 *    3. Жёстко бинаризуется: каждый пиксель — строго чёрный или белый.
 *
 *  В итоге драйвер получает изображение БЕЗ серых пикселей: ошибке дизеринга
 *  нечего распространять, и на печать уходит ровно то, что мы нарисовали —
 *  с чётким краем букв.
 * ============================================================================
 */

/** Коэффициент суперсэмплинга (4× → 1536 px на ширину головки 384) */
export const SUPER_SAMPLE = 4;

/** Порог бинаризации (0–255). 128 = пиксель края закрашен при покрытии ≥ 50% */
export const BINARIZE_THRESHOLD = 128;

/**
 * Создать пустой холст в разрешении суперсэмплинга с уже масштабированным
 * контекстом: рисовать можно в ЛОГИЧЕСКИХ координатах печати (384 × height).
 *
 * scale — коэффициент суперсэмплинга: печать и сохранение картинки всегда
 * 4× (SUPER_SAMPLE); «быстрое» превью может рисовать в 1× для слабых
 * телефонов (качество превью — отдельная настройка, на печать не влияет).
 */
export function createSupersampledCanvas(
  logicalWidth: number,
  logicalHeight: number,
  scale: number = SUPER_SAMPLE
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const s = Math.max(1, Math.min(SUPER_SAMPLE, scale));
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * s;
  canvas.height = Math.max(1, Math.ceil(logicalHeight * s));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось создать холст печати");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(s, s);
  return { canvas, ctx };
}

/**
 * Привязать координату к целому пикселю суперсэмплинга — исключает дробные
 * смещения, из-за которых строки текста получаются размытыми.
 */
export function ssPx(value: number): number {
  return Math.round(value * SUPER_SAMPLE) / SUPER_SAMPLE;
}

/**
 * Финализация печати: качественно сжать суперсэмплированный холст до
 * целевого размера и жёстко бинаризовать результат.
 *
 * scale — коэффициент, в котором рисован source (4× печать/сохранение,
 * 1× быстрое превью): от него считается целевой размер холста.
 */
export function finalizePrintCanvas(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  scale: number = SUPER_SAMPLE
): void {
  const s = Math.max(1, Math.min(SUPER_SAMPLE, scale));
  target.width = source.width / s;
  target.height = source.height / s;
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Последовательное сжатие вдвое (4× → 2× → 1×) даёт заметно более чистые
  // края, чем однократное drawImage с большим коэффициентом.
  let cur: HTMLCanvasElement = source;
  while (cur.width / 2 >= target.width && cur.width > target.width) {
    const half = document.createElement("canvas");
    half.width = Math.max(target.width, Math.floor(cur.width / 2));
    half.height = Math.max(target.height, Math.floor(cur.height / 2));
    const hctx = half.getContext("2d");
    if (!hctx) break;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  ctx.drawImage(cur, 0, 0, target.width, target.height);

  binarizeCanvas(target);
}

/**
 * Бинаризация: каждый пиксель → строго 0 или 255 по яркости (веса BT.709 —
 * те же, что использует драйвер). После этого у дизеринга драйвера нет
 * ошибки распространения → край букв на печати чёткий, без «волн».
 */
export function binarizeCanvas(
  canvas: HTMLCanvasElement,
  threshold = BINARIZE_THRESHOLD
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.2125 + d[i + 1] * 0.7154 + d[i + 2] * 0.0721;
    const v = lum < threshold ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
