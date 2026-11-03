/**
 * Юнит-тесты TSPL-энкодера (этикеточные принтеры: Gprinter BP21 и др., v1.0.37;
 * левый край и инверсия — v1.0.38).
 * Золотые байты: заголовки SIZE/GAP/DIRECTION/SPEED/DENSITY/CLS, BITMAP
 * (ширина в байтах, 1 = чёрная точка, MSB первым), выравнивание по левому
 * краю, PRINT, порог/дизеринг, композит альфы, калибровка GAPDETECT, зажим.
 * Запуск: bun scripts/test-tspl.ts
 */
import { strict as assert } from "node:assert";
import {
  TSPL_LIMITS,
  clampGapMm,
  clampLabelHeight,
  clampLabelWidth,
  encodeTsplBitmap,
  encodeTsplGapDetect,
} from "../src/lib/printer/usb/tspl";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

/** RGBA-буфер: fill(x, y) → [r, g, b, a] */
function rgba(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

/** Текстовое представление потока (команды — ASCII, данные — бинарь) */
function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/** Индекс первого байта растровых данных BITMAP (после 5-й запятой) */
function dataStart(bytes: Uint8Array): number {
  const s = text(bytes);
  const bm = s.indexOf("BITMAP ");
  assert.ok(bm >= 0, "нет команды BITMAP");
  let commas = 0;
  let i = bm + "BITMAP ".length;
  while (commas < 5 && i < s.length) {
    if (s[i] === ",") commas += 1;
    i += 1;
  }
  assert.equal(commas, 5, "BITMAP без 5 запятых");
  return i;
}

const W = 40; // мм → 320 px
const H = 30; // мм → 240 px

test("заголовок: SIZE/GAP/DIRECTION/SPEED/DENSITY/CLS по рабочей конфигурации BP21", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(320, 240, () => [255, 255, 255, 255]), width: 320, height: 240 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  const head = text(bytes).slice(0, 160);
  assert.ok(head.startsWith("SIZE 40 mm,30 mm\r\n"), head);
  assert.ok(head.includes("GAP 2 mm,0 mm\r\n"), head);
  assert.ok(head.includes("DIRECTION 1\r\n"), head);
  assert.ok(head.includes("SPEED 4\r\n"), head);
  assert.ok(head.includes("DENSITY 8\r\n"), head);
  assert.ok(head.includes("CLS\r\n"), head);
});

test("BITMAP: ширина в байтах, высота в строках, mode 0; PRINT 1,1 в конце", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(320, 240, () => [255, 255, 255, 255]), width: 320, height: 240 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  const s = text(bytes);
  assert.ok(s.includes("BITMAP 0,0,40,240,0,"), s.slice(0, 200));
  const tail = s.slice(-12);
  assert.ok(tail.endsWith("PRINT 1,1\r\n"), tail);
});

test("упаковка: 1 = чёрная точка, MSB первым; белая картинка — нули", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(8, 1, () => [255, 255, 255, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  // 8 px → 1 байт данных; хвост: данные + CRLF + PRINT 1,1\r\n (11)
  assert.equal(bytes.length, dataStart(bytes) + 1 + 2 + 11);
  assert.equal(bytes[dataStart(bytes)], 0x00);
});

test("чёрная точка в первом пикселе → 0x80; в последнем (8-м) → 0x01", () => {
  const one = encodeTsplBitmap(
    {
      data: rgba(8, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      width: 8,
      height: 1,
    },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(one[dataStart(one)], 0x80);
  const last = encodeTsplBitmap(
    {
      data: rgba(8, 1, (x) => (x === 7 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      width: 8,
      height: 1,
    },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(last[dataStart(last)], 0x01);
});

test("порог без дизеринга: тёмно-серый 100 → чёрный, светло-серый 200 → белый", () => {
  const dark = encodeTsplBitmap(
    { data: rgba(8, 1, () => [100, 100, 100, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(dark[dataStart(dark)], 0xff);
  const light = encodeTsplBitmap(
    { data: rgba(8, 1, () => [200, 200, 200, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(light[dataStart(light)], 0x00);
});

test("дизеринг Флойда—Стейнберга: 50% серый — примерно половина чёрных точек", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(64, 64, () => [128, 128, 128, 255]), width: 64, height: 64 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: true }
  );
  const data = bytes.subarray(dataStart(bytes), bytes.length - 13);
  let ones = 0;
  let total = 0;
  for (const b of data) {
    for (let bit = 0; bit < 8; bit++) {
      ones += (b >> bit) & 1;
      total += 1;
    }
  }
  const ratio = ones / total;
  assert.ok(ratio > 0.4 && ratio < 0.6, `доля чёрного ${ratio}`);
});

test("альфа композитится на белый: прозрачный пиксель → белая точка", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(8, 1, () => [0, 0, 0, 0]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(bytes[dataStart(bytes)], 0x00);
});

test("выравнивание по левому краю: картинка 160 px на этикетке 320 px → BITMAP x=0", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(160, 240, () => [255, 255, 255, 255]), width: 160, height: 240 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.ok(text(bytes).includes("BITMAP 0,0,20,240,0,"), text(bytes).slice(0, 200));
});

test("инверсия (v1.0.38): белое → 0xff (чёрное), чёрное → 0x00 (белое)", () => {
  const white = encodeTsplBitmap(
    { data: rgba(8, 1, () => [255, 255, 255, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, invert: true }
  );
  assert.equal(white[dataStart(white)], 0xff, "белый холст печатается целиком чёрным");
  const black = encodeTsplBitmap(
    { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, invert: true }
  );
  assert.equal(black[dataStart(black)], 0x00, "чёрный холст становится белым");
  // без флага — прежнее поведение
  const off = encodeTsplBitmap(
    { data: rgba(8, 1, () => [255, 255, 255, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(off[dataStart(off)], 0x00);
  // прозрачный пиксель композитится на белый → при инверсии печатается чёрным
  const transparent = encodeTsplBitmap(
    { data: rgba(8, 1, () => [0, 0, 0, 0]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, invert: true }
  );
  assert.equal(transparent[dataStart(transparent)], 0xff);
});

test("данные BITMAP: длина = wBytes × height (нечётная ширина дополняется)", () => {
  const wBytes = Math.ceil(161 / 8); // 21
  const bytes = encodeTsplBitmap(
    { data: rgba(161, 10, () => [0, 0, 0, 255]), width: 161, height: 10 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
  );
  assert.equal(bytes.length, dataStart(bytes) + wBytes * 10 + 2 + 11);
});

test("калибровка: GAPDETECT\\r\\n", () => {
  const bytes = encodeTsplGapDetect();
  assert.deepEqual(Array.from(bytes), Array.from(Buffer.from("GAPDETECT\r\n", "ascii")));
});

test("зажим размеров: границы TSPL_LIMITS уважаются", () => {
  assert.equal(clampLabelWidth(1), TSPL_LIMITS.widthMin);
  assert.equal(clampLabelWidth(999), TSPL_LIMITS.widthMax);
  assert.equal(clampLabelHeight(1), TSPL_LIMITS.heightMin);
  assert.equal(clampLabelHeight(9999), TSPL_LIMITS.heightMax);
  assert.equal(clampGapMm(-3), TSPL_LIMITS.gapMin);
  assert.equal(clampGapMm(55), TSPL_LIMITS.gapMax);
});

test("картинка не влезает в этикетку → исключение (масштабирование — вне энкодера)", () => {
  assert.throws(
    () =>
      encodeTsplBitmap(
        { data: rgba(400, 10, () => [0, 0, 0, 255]), width: 400, height: 10 },
        { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false }
      ),
    /does not fit/
  );
});

// v1.0.40: авто-длина этикетки — картинки/копии не ужимаются по высоте
test("авто-длина: высокий растр не бросает, SIZE растёт под содержимое (400 px → 50 мм)", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(320, 400, () => [255, 255, 255, 255]), width: 320, height: 400 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, autoHeight: true }
  );
  assert.ok(text(bytes).startsWith("SIZE 40 mm,50 mm\r\n"), text(bytes).slice(0, 40));
  assert.ok(text(bytes).includes("BITMAP 0,0,40,400,0,"), text(bytes).slice(0, 200));
});

test("авто-длина: короткий растр — минимум из настройки этикетки (160 px → 30 мм)", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(320, 160, () => [255, 255, 255, 255]), width: 320, height: 160 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, autoHeight: true }
  );
  assert.ok(text(bytes).startsWith("SIZE 40 mm,30 mm\r\n"), text(bytes).slice(0, 40));
});

test("авто-длина: ширина всё равно обязана влезать (исключение даже с autoHeight)", () => {
  assert.throws(
    () =>
      encodeTsplBitmap(
        { data: rgba(400, 10, () => [0, 0, 0, 255]), width: 400, height: 10 },
        { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, autoHeight: true }
      ),
    /does not fit/
  );
});

test("авто-длина: некратная 8 высота округляется вверх (241 px → 31 мм)", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(320, 241, () => [255, 255, 255, 255]), width: 320, height: 241 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, autoHeight: true }
  );
  assert.ok(text(bytes).startsWith("SIZE 40 mm,31 mm\r\n"), text(bytes).slice(0, 40));
});

// v1.0.41: чёткая печать + настройки скорости/плотности принтера
test("чёткая печать: серый 150 без усиления — белый, с усилением — чёрный (порог 128)", () => {
  const src = { data: rgba(8, 1, () => [150, 150, 150, 255]), width: 8, height: 1 };
  const off = encodeTsplBitmap(src, { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false });
  assert.equal(off[dataStart(off)], 0x00, "150 > 128 → белая точка");
  const on = encodeTsplBitmap(src, {
    labelWidthMm: W,
    labelHeightMm: H,
    gapMm: 2,
    dither: false,
    enhance: true,
  });
  assert.equal(on[dataStart(on)], 0xff, "усиленный 150 → ~115 < 128 → чёрная точка");
});

test("чёткая печать: края неподвижны (0 → 0x00, 255 → 0xff)", () => {
  const black = encodeTsplBitmap(
    { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, enhance: true }
  );
  assert.equal(black[dataStart(black)], 0xff);
  const white = encodeTsplBitmap(
    { data: rgba(8, 1, () => [255, 255, 255, 255]), width: 8, height: 1 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, enhance: true }
  );
  assert.equal(white[dataStart(white)], 0x00);
});

test("SPEED/DENSITY из настроек дока попадают в поток (2 и 12)", () => {
  const bytes = encodeTsplBitmap(
    { data: rgba(320, 240, () => [255, 255, 255, 255]), width: 320, height: 240 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, speed: 2, density: 12 }
  );
  const head = text(bytes).slice(0, 160);
  assert.ok(head.includes("SPEED 2\r\n"), head);
  assert.ok(head.includes("DENSITY 12\r\n"), head);
  // зажим: 0 → 1, 99 → 15
  const clamped = encodeTsplBitmap(
    { data: rgba(320, 240, () => [255, 255, 255, 255]), width: 320, height: 240 },
    { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false, speed: 0, density: 99 }
  );
  const head2 = text(clamped).slice(0, 160);
  assert.ok(head2.includes("SPEED 1\r\n"), head2);
  assert.ok(head2.includes("DENSITY 15\r\n"), head2);
});

test("v1.0.42: на строго бинарном растре дизеринг и порог дают идентичные байты", () => {
  // Шахматка чёрных колонок 320×24 — как холст чека/текста после бинаризации
  // (320 = этикетка W мм · 8 точек/мм, кейс printCanvas после ресемпла)
  const data = rgba(320, 24, (x) => (x % 24 < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const src = { data, width: 320, height: 24 };
  const withDither = encodeTsplBitmap(src, { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: true });
  const withThreshold = encodeTsplBitmap(src, { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false });
  assert.ok(withDither.length === withThreshold.length);
  assert.deepEqual(withDither, withThreshold, "дизерингу на бинарном растре нечего распространять");
});

// v1.0.43: разрешение печати (DPI) — dotsPerMm в энкодере
test("dotsPerMm 300 dpi (≈11.82): BITMAP 473 px → 60 байт, авто-высота по точкам/мм", () => {
  // 40 мм · 8 · 300/203 = 472.9 → 473 точки; растр 946 строк (80 мм контента)
  const dpm = (8 * 300) / 203;
  const pxW = Math.round(40 * dpm); // 473
  const rows = 946;
  const bytes = encodeTsplBitmap(
    { data: rgba(pxW, rows, () => [255, 255, 255, 255]), width: pxW, height: rows },
    { labelWidthMm: 40, labelHeightMm: 30, gapMm: 2, dither: false, autoHeight: true, dotsPerMm: dpm }
  );
  const s = text(bytes);
  assert.ok(s.startsWith("SIZE 40 mm,81 mm\r\n"), s.slice(0, 40)); // ceil(946/11.82)=81
  assert.ok(s.includes(`BITMAP 0,12,60,${rows},0,`), s.slice(0, 200)); // ceil(473/8)=60; y = round(81·11.82)−946 = 12 (ведущий край, v1.0.47)
});

test("dotsPerMm: ширина обязана влезать и при 300 dpi (480 > 473 → исключение)", () => {
  const dpm = (8 * 300) / 203;
  assert.throws(
    () =>
      encodeTsplBitmap(
        { data: rgba(480, 10, () => [0, 0, 0, 255]), width: 480, height: 10 },
        { labelWidthMm: 40, labelHeightMm: 30, gapMm: 2, dither: false, autoHeight: true, dotsPerMm: dpm }
      ),
    /does not fit/
  );
});

test("dotsPerMm по умолчанию = 8: результат побитно равен вызову с dotsPerMm: 8 (203 dpi)", () => {
  const optsA = { labelWidthMm: W, labelHeightMm: H, gapMm: 2, dither: false } as const;
  const optsB = { ...optsA, dotsPerMm: 8 };
  const a = encodeTsplBitmap({ data: rgba(320, 240, () => [255, 255, 255, 255]), width: 320, height: 240 }, optsA);
  const b = encodeTsplBitmap({ data: rgba(320, 240, () => [255, 255, 255, 255]), width: 320, height: 240 }, optsB);
  assert.deepEqual(a, b, "дефолт не изменил поведение 203 dpi");
});

console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
if (failed > 0) process.exit(1);
