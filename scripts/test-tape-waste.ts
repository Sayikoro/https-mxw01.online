/**
 * Юнит-тесты экономии ленты (v1.0.46): режим «Непрерывная лента» TSPL —
 * без поиска зазора (GAP 0), длина этикетки ровно под содержимое и
 * обрезка пустых полей растра. Запрос пользователя: перед печатью
 * картинки принтер протягивает ~20 см ленты и только потом печатает.
 * Запуск: bun scripts/test-tape-waste.ts
 */
import { strict as assert } from "node:assert";
import { BINARY_LUMA_THRESHOLD, resampleBinary, trimBlankRows } from "../src/lib/printer/usb/raster";
import { encodeTsplBitmap } from "../src/lib/printer/usb/tspl";

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

/** RGBA-растр заданного размера: белое поле сверху/снизу, чёрная полоса в середине */
function makeRaster(w: number, h: number, opts?: { padTop?: number; padBottom?: number }) {
  const padTop = opts?.padTop ?? 0;
  const padBottom = opts?.padBottom ?? 0;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = padTop; y < h - padBottom; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = 0;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function tsplText(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes);
}

/* ------------------------- trimBlankRows ------------------------- */

test("trimBlankRows: белые поля сверху и снизу обрезаются, содержимое цело", () => {
  const src = makeRaster(16, 20, { padTop: 5, padBottom: 7 });
  const out = trimBlankRows(src);
  assert.equal(out.width, 16);
  assert.equal(out.height, 8);
  // Первая строка результата = первая чёрная строка источника
  assert.equal(out.data[0], 0);
  // Последняя строка результата = последняя чёрная строка источника
  const lastRow = (out.height - 1) * 16 * 4;
  assert.equal(out.data[lastRow], 0);
});

test("trimBlankRows: растр без полей возвращается как есть (та же высота)", () => {
  const src = makeRaster(8, 6);
  const out = trimBlankRows(src);
  assert.equal(out.height, 6);
  assert.equal(out.data, src.data as unknown as Uint8ClampedArray);
});

test("trimBlankRows: полностью пустой растр не превращается в нулевой", () => {
  const src = makeRaster(8, 6, { padTop: 6, padBottom: 0 });
  const out = trimBlankRows(src);
  assert.equal(out.height, 6);
  assert.equal(out.width, 8);
});

test("trimBlankRows: альфа композитится на белый — прозрачный ряд пустой", () => {
  const w = 4;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4); // все нули = прозрачный чёрный
  // верхний ряд: прозрачный (альфа 0) → белый → пустой
  // нижние три: непрозрачный чёрный
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p + 3] = 255;
    }
  }
  const out = trimBlankRows({ data, width: w, height: h });
  assert.equal(out.height, 3);
});

test("trimBlankRows: порог 128 — серый 200 не чернила (обрежется), 100 — чернила", () => {
  const w = 4;
  const h = 3;
  const mk = (top: number) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 0; x < w; x++) {
      // Нулевой ряд — проверяемый серый, остальные — чёрные чернила
      const p0 = x * 4;
      data[p0] = top;
      data[p0 + 1] = top;
      data[p0 + 2] = top;
      data[p0 + 3] = 255;
      for (let y = 1; y < h; y++) {
        const p = (y * w + x) * 4;
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 255;
      }
    }
    return { data, width: w, height: h };
  };
  // Верхний ряд светло-серый 200 — не чернила при пороге 128 → обрезка
  const light = trimBlankRows(mk(200));
  assert.equal(light.height, 2);
  // Верхний ряд тёмно-серый 100 — чернила → не обрезка
  const dark = trimBlankRows(mk(100));
  assert.equal(dark.height, 3);
  assert.equal(BINARY_LUMA_THRESHOLD, 128);
});

/* ------------------- encodeTsplBitmap: continuous ------------------- */

const IMG = { data: makeRaster(64, 96).data, width: 64, height: 96 };
const BASE = {
  labelWidthMm: 40,
  labelHeightMm: 30,
  gapMm: 2,
  dither: false as const,
  autoHeight: true,
  dotsPerMm: 8,
};

test("continuous: GAP 0 mm,0 mm — датчик разрыва не запускается", () => {
  const s = tsplText(encodeTsplBitmap(IMG, { ...BASE, continuous: true }));
  assert.ok(s.includes("GAP 0 mm,0 mm\r\n"), s.split("\r\n")[1]);
});

test("continuous: SIZE = содержимому (96 точек / 8 = 12 мм), минимум 30 мм не применяется", () => {
  const s = tsplText(encodeTsplBitmap(IMG, { ...BASE, continuous: true }));
  assert.ok(s.includes("SIZE 40 mm,12 mm\r\n"), s.split("\r\n")[0]);
});

test("прежний режим (gap): GAP из настройки, минимум высоты работает — поведение не изменилось", () => {
  const s = tsplText(encodeTsplBitmap(IMG, { ...BASE }));
  assert.ok(s.includes("GAP 2 mm,0 mm\r\n"));
  assert.ok(s.includes("SIZE 40 mm,30 mm\r\n"));
});

test("continuous: скорость/плотность/растр уходят как раньше — меняется только GAP и высота", () => {
  const cont = tsplText(encodeTsplBitmap(IMG, { ...BASE, continuous: true }));
  assert.ok(cont.includes("SPEED 4\r\n"));
  assert.ok(cont.includes("DENSITY 8\r\n"));
  assert.ok(cont.includes("BITMAP 0,0,8,96,0,"));
  assert.ok(cont.includes("PRINT 1,1\r\n"));
  assert.ok(cont.includes("DIRECTION 1\r\n"));
});

test("continuous + обрезка полей: связка как в printCanvas — 96 (24+48+24) → BITMAP 48, SIZE 6 мм", () => {
  const padded = makeRaster(64, 96, { padTop: 24, padBottom: 24 });
  const trimmed = trimBlankRows(padded);
  assert.equal(trimmed.height, 48);
  const s = tsplText(
    encodeTsplBitmap(
      { data: trimmed.data, width: trimmed.width, height: trimmed.height },
      { ...BASE, continuous: true }
    )
  );
  // После обрезки 48 рядов → SIZE 6 мм, BITMAP высота 48
  assert.ok(s.includes("SIZE 40 mm,6 mm\r\n"), s.split("\r\n")[0]);
  assert.ok(s.includes("BITMAP 0,0,8,48,0,"), s.split("\r\n").find((l) => l.startsWith("BITMAP")));
});

test("resampleBinary + trimBlankRows: связка как в printCanvas (384×256 → 320, поля обрезаны)", () => {
  const src = makeRaster(384, 256, { padTop: 20, padBottom: 12 });
  const dst = resampleBinary(src, 320);
  assert.equal(dst.width, 320);
  assert.equal(dst.height, Math.round((256 * 320) / 384));
  const trimmed = trimBlankRows(dst);
  assert.ok(trimmed.height < dst.height, "поля после ресемпла должны обрезаться");
  assert.ok(trimmed.height > 0);
});

console.log(`\nИтого: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
