/**
 * ============================================================================
 *  TSPL-ЭНКОДЕР (этикеточные принтеры: Gprinter BP21, TSC, Xprinter XP-TT и
 *  др.) — второй язык команд для WebUSB-транспорта помимо ESC/POS.
 * ============================================================================
 *  Зачем: этикеточные и чековые принтеры внешне похожи (USB, термопечать),
 *  но «говорят» на разных языках. ESC/POS-растр (GS v 0) этикеточный принтер
 *  молча выбрасывает — нужна обёртка TSPL: SIZE/GAP/DIRECTION/CLS + BITMAP +
 *  PRINT. Печать идёт 1-битным растром (порог или дизеринг Флойда—Стейнберга,
 *  1 = чёрная точка, старший бит первым). Кириллица не требует кодовой
 *  страницы — картинка уже растровая.
 *
 *  Формат BITMAP (TSPL2): BITMAP x,y,width,height,mode,[данные]
 *    — width в БАЙТАХ (8 точек на байт), height в строках-точках,
 *    mode 0 = OVERWRITE, данные — бинарный поток length*width байт,
 *    после него CRLF. Команды — ASCII + CRLF.
 * ============================================================================
 */

export interface TsplImage {
  /** RGBA-данные (уже отмасштабированные до ширины печати) */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface TsplEncodeOptions {
  /** Ширина этикетки, мм (203 dpi → 8 точек/мм) */
  labelWidthMm: number;
  /** Высота этикетки, мм */
  labelHeightMm: number;
  /** Зазор между этикетками, мм */
  gapMm: number;
  /** Дизеринг Флойда—Стейнберга (иначе порог 50%) */
  dither?: boolean;
  /** Скорость печати 1…6 (по умолчанию 4 — рабочее значение BP21) */
  speed?: number;
  /** Плотность (яркость) 0…15 (по умолчанию 8 — рабочее значение BP21) */
  density?: number;
  /** Инверсия цветов канваса: серый → 255 − серый перед бинаризацией (по умолчанию false) */
  invert?: boolean;
  /** Авто-длина этикетки (v1.0.40): высота SIZE растёт под содержимое —
   *  max(настройка, ceil(rows / dotsPerMm)); картинка по высоте не ужимается.
   *  По умолчанию false — прежнее поведение (исключение при переполнении). */
  autoHeight?: boolean;
  /** Чёткая печать (v1.0.41): гамма-усиление 1.5 до бинаризации —
   *  полутона темнеют, штрихи печатаются сплошными точками. По умолчанию false */
  enhance?: boolean;
  /** Точек на мм головки (v1.0.43): 203 dpi → 8, 300 dpi → ≈11.82.
   *  По умолчанию 8 — прежнее поведение (203 dpi ≈ 8 точек/мм) */
  dotsPerMm?: number;
  /** Непрерывная лента (v1.0.46): без поиска зазора — GAP 0 mm,0 mm (принтер
   *  печатает сразу, не протягивая ленту в поисках разрыва), высота SIZE —
   *  ровно содержимое (ceil(rows / dotsPerMm)), минимум labelHeightMm
   *  не применяется: рулонной ленте некуда «дотягивать» этикетку.
   *  По умолчанию false — прежнее поведение (этикетки с зазором) */
  continuous?: boolean;
}

/** Разумный потолок авто-высоты этикетки, мм — защита от мусорных холстов */
export const TSPL_AUTO_HEIGHT_MAX_MM = 2000;

/** Ограничения размеров этикетки (мм) — защита от опечаток в полях ввода */
export const TSPL_LIMITS = {
  widthMin: 15,
  widthMax: 120,
  heightMin: 10,
  heightMax: 300,
  gapMin: 0,
  gapMax: 10,
} as const;

export function clampLabelWidth(mm: number): number {
  return Math.min(TSPL_LIMITS.widthMax, Math.max(TSPL_LIMITS.widthMin, Math.round(mm)));
}

export function clampLabelHeight(mm: number): number {
  return Math.min(TSPL_LIMITS.heightMax, Math.max(TSPL_LIMITS.heightMin, Math.round(mm)));
}

export function clampGapMm(mm: number): number {
  return Math.min(TSPL_LIMITS.gapMax, Math.max(TSPL_LIMITS.gapMin, Math.round(mm)));
}

/** Команда калибровки зазора: принтер сам находит разрывы между этикетками */
export function encodeTsplGapDetect(): Uint8Array {
  return ascii("GAPDETECT\r\n");
}

/** Текстовая команда (ASCII + CRLF) — для диагностики/простых задач */
export function encodeTsplRaw(command: string): Uint8Array {
  return ascii(command.endsWith("\r\n") ? command : `${command}\r\n`);
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
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

const num = (n: number) => String(Math.round(n));

/**
 * Полный поток TSPL для одной этикетки с растром:
 * SIZE → GAP → DIRECTION → SPEED → DENSITY → CLS → BITMAP → PRINT.
 * Картинка прижимается к ЛЕВОМУ и верхнему краю этикетки (v1.0.38 —
 * выравнивание по левому краю всегда, BITMAP x=0); энкодер печатает
 * ровно то, что ему дали, от точки (x, 0).
 *
 * v1.0.40: с autoHeight высокий растр — не ошибка, а авто-длина этикетки
 * (SIZE растёт под содержимое, минимум — физическая высота из настройки);
 * ширина по-прежнему обязана влезать (масштабирование по ширине — вне
 * энкодера, в printCanvas).
 *
 * v1.0.46: continuous (непрерывная лента) — двойная экономия ленты:
 *   1) GAP 0 mm,0 mm — принтер не ищет датчиком разрыв (на рулонной ленте
 *      его нет: поиск = длинная пустая протяжка ПЕРЕД печатью);
 *   2) SIZE = высоте содержимого без минимума из настройки — излишек
 *      высоты при DIRECTION 1 печатается пустым куском ПЕРЕД картинкой,
 *      на непрерывной ленте этот запас — чистый расход.
 *
 * v1.0.47: растр прижимается к ВЕДУЩЕМУ краю этикетки (y = labelPxH −
 * rows). DIRECTION 1 переворачивает координаты: y = 0 — задний (нижний)
 * край этикетки, печатается ПОСЛЕДНИМ; бумага выходит из принтера ведущим
 * краем (y = labelPxH − 1) вперёд. Раньше BITMAP стоял в y = 0 — контент
 * уходил в конец этикетки, и весь излишек длины (минимум «Высота
 * этикетки» из настройки, запас до границы) протягивался ПУСТЫМ куском
 * ДО начала печати («принтер выплёвывает ленту и только потом печатает»).
 * Теперь контент печатается СРАЗУ, а остаток длины этикетки выходит
 * после него — расход ленты тот же, но пустой протяжки перед печатью
 * больше нет в любом режиме носителя.
 */
export function encodeTsplBitmap(image: TsplImage, opts: TsplEncodeOptions): Uint8Array {
  const wMm = clampLabelWidth(opts.labelWidthMm);
  const gapMm = clampGapMm(opts.gapMm);
  const speed = Math.min(6, Math.max(1, Math.round(opts.speed ?? 4)));
  const density = Math.min(15, Math.max(0, Math.round(opts.density ?? 8)));
  // Точек на мм (v1.0.43): по умолчанию 8 — сетка 203 dpi; для головок
  // 300/600 dpi значение приходит из настройки «Разрешение печати (DPI)»
  const dotsPerMm = Math.min(100, Math.max(1, opts.dotsPerMm ?? 8));
  const labelPxW = Math.round(wMm * dotsPerMm);
  if (image.width <= 0 || image.height <= 0) {
    throw new Error("tspl: empty image");
  }
  if (image.width > labelPxW) {
    throw new Error("tspl: image does not fit the label — scale it down before encoding");
  }

  const wBytes = Math.ceil(image.width / 8);
  const rows = image.height;
  // Высота этикетки: авто-длина — max(настройка, высота растра в мм);
  // иначе — настройка как раньше (переполнение по высоте = исключение).
  // Непрерывная лента (v1.0.46): настройка-минимум не применяется —
  // длина равна содержимому, лишней протяжки нет
  const hMm = opts.continuous
    ? Math.min(TSPL_AUTO_HEIGHT_MAX_MM, Math.ceil(rows / dotsPerMm))
    : opts.autoHeight
      ? Math.min(
          TSPL_AUTO_HEIGHT_MAX_MM,
          Math.max(clampLabelHeight(opts.labelHeightMm), Math.ceil(rows / dotsPerMm))
        )
      : clampLabelHeight(opts.labelHeightMm);
  // Целые точки высоты этикетки (при 300/600 dpi dotsPerMm дробный)
  const labelPxH = Math.round(hMm * dotsPerMm);
  if (!opts.autoHeight && image.height > labelPxH) {
    throw new Error("tspl: image does not fit the label — scale it down before encoding");
  }
  const bits = packBits(image, opts.dither ?? true, opts.invert ?? false, opts.enhance ?? false);
  // Выравнивание по левому краю — всегда (v1.0.38)
  const x = 0;
  // v1.0.47: прижимаем растр к ведущему краю этикетки (см. комментарий
  // функции): при DIRECTION 1 ведущий край — y = labelPxH − 1, поэтому
  // верхняя координата растра = labelPxH − rows. Контент печатается сразу
  // после начала подачи, излишек длины (минимум высоты из настройки)
  // выходит пустым куском ПОСЛЕ картинки, а не до неё.
  const y = Math.max(0, labelPxH - rows);

  return concat([
    ascii(`SIZE ${num(wMm)} mm,${num(hMm)} mm\r\n`),
    // Непрерывная лента: GAP 0 — датчик разрыва не запускается, печать
    // начинается сразу (v1.0.46); иначе — зазор из настройки
    ascii(`GAP ${num(opts.continuous ? 0 : gapMm)} mm,0 mm\r\n`),
    ascii("DIRECTION 1\r\n"),
    ascii(`SPEED ${num(speed)}\r\n`),
    ascii(`DENSITY ${num(density)}\r\n`),
    ascii("CLS\r\n"),
    ascii(`BITMAP ${num(x)},${num(y)},${num(wBytes)},${num(rows)},0,`),
    bits,
    ascii("\r\n"),
    ascii("PRINT 1,1\r\n"),
  ]);
}

/**
 * RGBA → 1-битные строки (1 = чёрная точка, MSB первым, дополнение до байта —
 * белое). Альфа композитится на белый; серый — 0.299R + 0.587G + 0.114B,
 * затем порог 50% или дизеринг Флойда—Стейнберга. invert — негатив уже
 * скомпозитного серого ДО бинаризации (прозрачные места станут чёрными).
 */
function packBits(image: TsplImage, dither: boolean, invert: boolean, enhance: boolean): Uint8Array {
  const { width, height } = image;
  const wBytes = Math.ceil(width / 8);
  const out = new Uint8Array(wBytes * height);

  // Серая полутоновая матрица (уже композит на белый)
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const a = image.data[p + 3] / 255;
    const r = image.data[p] * a + 255 * (1 - a);
    const g = image.data[p + 1] * a + 255 * (1 - a);
    const b = image.data[p + 2] * a + 255 * (1 - a);
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Инверсия цветов (настройка «Инверсия канваса») — до порога/дизеринга
  if (invert) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
  }

  // Чёткая печать (v1.0.41): серый → 255·v·√v (γ 1.5) — полутона темнеют,
  // края неподвижны; шрифт и тонкие линии ловятся сплошными точками
  if (enhance) {
    for (let i = 0; i < gray.length; i++) {
      const v = Math.min(1, Math.max(0, gray[i] / 255));
      gray[i] = 255 * v * Math.sqrt(v);
    }
  }

  const blackAt = (x: number, y: number): boolean => gray[y * width + x] < 128;

  if (dither) {
    // Флойд—Стейнберг: err распределяется вправо/вниз, порог 128
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const old = gray[i];
        const isNew = old < 128 ? 0 : 255;
        const err = old - isNew;
        gray[i] = isNew;
        if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) gray[i + width - 1] += (err * 3) / 16;
          gray[i + width] += (err * 5) / 16;
          if (x + 1 < width) gray[i + width + 1] += err / 16;
        }
      }
    }
  }

  for (let y = 0; y < height; y++) {
    const rowOff = y * wBytes;
    for (let x = 0; x < width; x++) {
      const black = dither ? gray[y * width + x] < 128 : blackAt(x, y);
      if (!black) continue;
      out[rowOff + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}
