/**
 * Юнит-тесты ведущего края растра (v1.0.47): при DIRECTION 1 бумага выходит
 * из принтера ведущим краем (y = labelPxH − 1) вперёд, поэтому BITMAP
 * прижимается к y = labelPxH − rows — контент печатается СРАЗУ после начала
 * подачи, а излишек длины этикетки (минимум «Высота этикетки», округление
 * до мм) выходит пустым куском ПОСЛЕ содержимого, а не до него.
 * Запрос пользователя: «на некоторых генераторах … сначала выплевывает
 * [ленту] а потом печатает». Запуск: bun scripts/test-leading-feed.ts
 */
import { strict as assert } from "node:assert";
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

/** Чёрный RGBA-растр заданного размера (чернила по всей ширине) */
function makeRaster(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function tsplText(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes);
}

/** Значения x,y,height из команды BITMAP */
function bitmapXYH(s: string): { x: number; y: number; h: number } {
  const m = /BITMAP (\d+),(\d+),(\d+),(\d+),0,/.exec(s);
  assert.ok(m, "нет команды BITMAP: " + s.slice(0, 120));
  return { x: Number(m[1]), y: Number(m[2]), h: Number(m[4]) };
}

const BASE = {
  labelWidthMm: 40,
  labelHeightMm: 30,
  gapMm: 2,
  dither: false as const,
  autoHeight: true,
  dotsPerMm: 8,
};

test("gap-режим: короткий растр 160 точек при минимуме 30 мм — BITMAP y = 80 (ведущий край)", () => {
  const s = tsplText(encodeTsplBitmap(makeRaster(64, 160), { ...BASE }));
  assert.ok(s.includes("SIZE 40 mm,30 mm\r\n"), s.split("\r\n")[0]);
  const bm = bitmapXYH(s);
  assert.equal(bm.y, 240 - 160, "y = labelPxH − rows: контент у ведущего края");
  assert.equal(bm.h, 160);
});

test("gap-режим: растр ровно в минимум (240 точек) — y = 0, как раньше", () => {
  const s = tsplText(encodeTsplBitmap(makeRaster(64, 240), { ...BASE }));
  assert.ok(s.includes("SIZE 40 mm,30 mm\r\n"), s.split("\r\n")[0]);
  assert.equal(bitmapXYH(s).y, 0);
});

test("continuous: высота некратна 8 (213 точек → 27 мм = 216) — хвост ≤ 7 точек, y = 3", () => {
  const s = tsplText(encodeTsplBitmap(makeRaster(64, 213), { ...BASE, continuous: true }));
  assert.ok(s.includes("SIZE 40 mm,27 mm\r\n"), s.split("\r\n")[0]);
  assert.equal(bitmapXYH(s).y, 3);
});

test("continuous: высота кратна 8 (96 точек → 12 мм) — y = 0", () => {
  const s = tsplText(encodeTsplBitmap(makeRaster(64, 96), { ...BASE, continuous: true }));
  assert.ok(s.includes("SIZE 40 mm,12 mm\r\n"), s.split("\r\n")[0]);
  assert.equal(bitmapXYH(s).y, 0);
});

test("инвариант v1.0.47: BITMAP y + rows ≤ labelPxH (растр всегда внутри этикетки)", () => {
  for (const rows of [1, 7, 96, 160, 213, 240, 400, 1600]) {
    for (const labelH of [10, 30, 90]) {
      const s = tsplText(
        encodeTsplBitmap(makeRaster(64, rows), { ...BASE, labelHeightMm: labelH })
      );
      const bm = bitmapXYH(s);
      const labelPxH = Number(/SIZE 40 mm,(\d+) mm/.exec(s)![1]) * 8;
      assert.ok(bm.y + bm.h <= labelPxH, `rows=${rows} labelH=${labelH}: y=${bm.y}+${bm.h}>${labelPxH}`);
      assert.ok(bm.y >= 0);
    }
  }
});

test("инвариант v1.0.47: при autoHeight длинный растр растит SIZE, y = остаток до целых мм", () => {
  const s = tsplText(encodeTsplBitmap(makeRaster(64, 400), { ...BASE }));
  assert.ok(s.includes("SIZE 40 mm,50 mm\r\n"), s.split("\r\n")[0]);
  assert.equal(bitmapXYH(s).y, 0, "400 точек = 50 мм ровно → y = 0");
});

test("300 dpi: дробный dotsPerMm — labelPxH целое (округление), y целое", () => {
  const dpm = (8 * 300) / 203;
  const s = tsplText(
    encodeTsplBitmap(makeRaster(473, 946), {
      labelWidthMm: 40,
      labelHeightMm: 30,
      gapMm: 2,
      dither: false,
      autoHeight: true,
      dotsPerMm: dpm,
    })
  );
  const bm = bitmapXYH(s);
  assert.ok(Number.isInteger(bm.y));
  const labelPxH = Math.round(Number(/SIZE 40 mm,(\d+) mm/.exec(s)![1]) * dpm);
  assert.ok(bm.y + bm.h <= labelPxH, `y=${bm.y}+${bm.h} > ${labelPxH}`);
});

console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
if (failed > 0) process.exit(1);
