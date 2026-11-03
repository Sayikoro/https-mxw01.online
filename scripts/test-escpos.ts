/**
 * Юнит-тесты ESC/POS-энкодера (WebUSB POS, v1.0.33; левый край и инверсия — v1.0.38).
 * Золотые байты: заголовки команд, упаковка строк в биты, альфа-композит,
 * дизеринг Флойда—Стейнберга, чанкинг GS v 0, выравнивание, инверсия и отрез.
 * Запуск: bun scripts/test-escpos.ts
 */
import { strict as assert } from "node:assert";
import {
  encodeEscposRaster,
  escposAlign,
  escposCut,
  escposFeed,
  escposInit,
  escposRasterHeader,
} from "../src/lib/printer/usb/escpos";

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

/** Сколько раз встречается подпоследовательность */
function countSeq(hay: Uint8Array, needle: number[]): number {
  let n = 0;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    n += 1;
    i += needle.length - 1;
  }
  return n;
}

console.log("test-escpos:");

test("команды-строители: ESC @, ESC a, GS V 0, LF, заголовок GS v 0", () => {
  assert.deepEqual(Array.from(escposInit()), [0x1b, 0x40]);
  assert.deepEqual(Array.from(escposAlign(1)), [0x1b, 0x61, 0x01]);
  assert.deepEqual(Array.from(escposAlign(0)), [0x1b, 0x61, 0x00]);
  assert.deepEqual(Array.from(escposCut()), [0x1d, 0x56, 0x00]);
  assert.deepEqual(Array.from(escposFeed(3)), [0x0a, 0x0a, 0x0a]);
  // 384 px = 48 байт/строка; 2 строки — little-endian
  assert.deepEqual(Array.from(escposRasterHeader(48, 2)), [
    0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0x02, 0x00,
  ]);
  // строки > 255: 300 = 0x012C → 2C 01
  assert.deepEqual(Array.from(escposRasterHeader(72, 300)), [
    0x1d, 0x76, 0x30, 0x00, 0x48, 0x00, 0x2c, 0x01,
  ]);
});

test("чёрные пиксели 8×1: MSB = самая левая точка, 8 чёрных = 0xFF", () => {
  const bytes = encodeEscposRaster(
    { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 },
    { init: false, center: false, feedLines: 0 }
  );
  assert.deepEqual(Array.from(bytes), [
    0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff,
  ]);
  // одиночный чёрный пиксель: x=0 → 0x80, x=7 → 0x01
  const left = encodeEscposRaster(
    { data: rgba(8, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])), width: 8, height: 1 },
    { init: false, center: false, feedLines: 0, dither: false }
  );
  assert.equal(left[left.length - 1], 0x80);
  const right = encodeEscposRaster(
    { data: rgba(8, 1, (x) => (x === 7 ? [0, 0, 0, 255] : [255, 255, 255, 255])), width: 8, height: 1 },
    { init: false, center: false, feedLines: 0, dither: false }
  );
  assert.equal(right[right.length - 1], 0x01);
});

test("белый и прозрачный пиксели не печатаются (альфа композит на белый)", () => {
  const bytes = encodeEscposRaster(
    {
      data: rgba(8, 1, (x) => (x < 4 ? [255, 255, 255, 255] : [0, 0, 0, 0])),
      width: 8,
      height: 1,
    },
    { init: false, center: false, feedLines: 0, dither: false }
  );
  assert.equal(bytes[bytes.length - 1], 0x00);
});

test("ширина не кратна 8: 9 px → 2 байта/строка, 9-й пиксель = старший бит 2-го байта", () => {
  const bytes = encodeEscposRaster(
    { data: rgba(9, 1, () => [0, 0, 0, 255]), width: 9, height: 1 },
    { init: false, center: false, feedLines: 0, dither: false }
  );
  assert.deepEqual(Array.from(bytes), [
    0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x01, 0x00, 0xff, 0x80,
  ]);
});

test("пороговый режим: 140 < threshold 150 → чёрный, 220 → белый", () => {
  const bytes = encodeEscposRaster(
    {
      data: rgba(2, 1, (x) => (x === 0 ? [140, 140, 140, 255] : [220, 220, 220, 255])),
      width: 2,
      height: 1,
    },
    { init: false, center: false, feedLines: 0, dither: false, threshold: 150 }
  );
  assert.equal(bytes[bytes.length - 1], 0b10000000);
});

test("дизеринг Флойда—Стейнберга: 2 пикселя по 128 → ровно одна точка (0x40)", () => {
  const bytes = encodeEscposRaster(
    { data: rgba(2, 1, () => [128, 128, 128, 255]), width: 2, height: 1 },
    { init: false, center: false, feedLines: 0, dither: true }
  );
  assert.equal(bytes[bytes.length - 1], 0b01000000);
});

test("чанкинг: 200 строк по 64 → 4 команды GS v 0 (64+64+64+8)", () => {
  const bytes = encodeEscposRaster(
    { data: rgba(8, 200, () => [0, 0, 0, 255]), width: 8, height: 200 },
    { init: false, center: false, feedLines: 0 }
  );
  // заголовок: 1D 76 30 00 01 00 …
  assert.equal(countSeq(bytes, [0x1d, 0x76, 0x30, 0x00, 0x01, 0x00]), 4);
  // последний чанк — 8 строк
  assert.deepEqual(Array.from(bytes.slice(-8 - 8, -8)), [
    0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x08, 0x00,
  ]);
});

test("реальный случай 384×2: 48 байт/строка, один растр = 8 + 48×2 байт", () => {
  const bytes = encodeEscposRaster(
    { data: rgba(384, 2, () => [0, 0, 0, 255]), width: 384, height: 2 },
    { init: false, center: false, feedLines: 0 }
  );
  assert.equal(bytes.length, 8 + 48 * 2);
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [
    0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0x02, 0x00,
  ]);
});

test("выравнивание по умолчанию — левый край: ESC a в потоке нет вовсе (ESC @ сбрасывает)", () => {
  const bytes = encodeEscposRaster(
    { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 },
    { init: false, feedLines: 0 }
  );
  assert.equal(countSeq(bytes, [0x1b, 0x61]), 0, "команд ESC a быть не должно");
  // опция center: true осталась для особых случаев — ESC a 1 в начале, ESC a 0 в конце
  const centered = encodeEscposRaster(
    { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 },
    { init: false, feedLines: 0, center: true }
  );
  assert.deepEqual(Array.from(centered.slice(0, 3)), [0x1b, 0x61, 0x01]);
  assert.deepEqual(Array.from(centered.slice(-3)), [0x1b, 0x61, 0x00]);
});

test("инверсия (v1.0.38): белое становится чёрным, чёрное — белым", () => {
  const white = encodeEscposRaster(
    { data: rgba(8, 1, () => [255, 255, 255, 255]), width: 8, height: 1 },
    { init: false, center: false, feedLines: 0, dither: false, invert: true }
  );
  assert.equal(white[white.length - 1], 0xff, "белый холст → все точки чёрные");
  const black = encodeEscposRaster(
    { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 },
    { init: false, center: false, feedLines: 0, dither: false, invert: true }
  );
  assert.equal(black[black.length - 1], 0x00, "чёрный холст → все точки белые");
});

test("инверсия: без флага байты не меняются; альфа инвертируется как белый", () => {
  const src = { data: rgba(8, 1, () => [255, 255, 255, 255]), width: 8, height: 1 };
  const off = encodeEscposRaster(src, { init: false, center: false, feedLines: 0, dither: false });
  assert.equal(off[off.length - 1], 0x00);
  // прозрачный пиксель композитится на белый → при инверсии печатается чёрным
  const transparent = encodeEscposRaster(
    { data: rgba(8, 1, () => [0, 0, 0, 0]), width: 8, height: 1 },
    { init: false, center: false, feedLines: 0, dither: false, invert: true }
  );
  assert.equal(transparent[transparent.length - 1], 0xff);
});

test("полный поток по умолчанию: ESC @ … растр … LF×3 … [GS V 0 при cut]", () => {
  const src = { data: rgba(8, 1, () => [0, 0, 0, 255]), width: 8, height: 1 };
  const noCut = encodeEscposRaster(src, { center: false, cut: false });
  assert.deepEqual(Array.from(noCut.slice(0, 2)), [0x1b, 0x40]);
  assert.deepEqual(Array.from(noCut.slice(-3)), [0x0a, 0x0a, 0x0a]);
  const withCut = encodeEscposRaster(src, { center: false, cut: true });
  assert.deepEqual(Array.from(withCut.slice(-3)), [0x1d, 0x56, 0x00]);
});

test("пустой вход → пустой выход (без исключений)", () => {
  assert.equal(encodeEscposRaster({ data: new Uint8ClampedArray(0), width: 0, height: 0 }).length, 0);
});

// v1.0.41: чёткая печать — гамма 1.5 до бинаризации (полутона темнеют)
test("чёткая печать: серый 150 без усиления — белый, с усилением — чёрный (порог 150)", () => {
  const src = { data: rgba(8, 1, () => [150, 150, 150, 255]), width: 8, height: 1 };
  const off = encodeEscposRaster(src, { init: false, center: false, feedLines: 0, dither: false });
  assert.equal(off[off.length - 1], 0x00, "серый 150 > 128, но < порога 150 → белый");
  const on = encodeEscposRaster(src, {
    init: false,
    center: false,
    feedLines: 0,
    dither: false,
    enhance: true,
  });
  assert.equal(on[on.length - 1], 0xff, "усиленный 150 → ~115 → чёрный");
});

test("чёткая печать: края неподвижны (0 и 255 не меняются), дизеринг плотнее на полутонах", () => {
  // чёрный/белый пиксели при enhance не меняются
  const bw = { data: rgba(16, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])), width: 16, height: 1 };
  const plain = encodeEscposRaster(bw, { init: false, center: false, feedLines: 0, dither: false });
  const enh = encodeEscposRaster(bw, { init: false, center: false, feedLines: 0, dither: false, enhance: true });
  assert.deepEqual(Array.from(enh), Array.from(plain), "крайние яркости не искажаются");
  // полутон 128 при усилении → ~91 → доля чёрного при дизеринге ≈ 0.64 (без — ~0.5)
  const mid = encodeEscposRaster(
    { data: rgba(64, 64, () => [128, 128, 128, 255]), width: 64, height: 64 },
    { init: false, center: false, feedLines: 0, dither: true, enhance: true }
  );
  // поток: заголовок GS v 0 (8 байт) + биты 8 байт × 64 строк
  const data = mid.subarray(8, 8 + 8 * 64);
  let ones = 0;
  for (const b of data) for (let bit = 0; bit < 8; bit++) ones += (b >> bit) & 1;
  const ratio = ones / (8 * 64 * 8);
  assert.ok(ratio > 0.55 && ratio < 0.75, `доля чёрного с усилением ${ratio}`);
});

console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
if (failed > 0) process.exit(1);
