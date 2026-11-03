/**
 * Юнит-тесты плотности POS-ветки (v1.0.45): печатная ширина головки
 * считается ОТ ХАРАКТЕРИСТИК ПРИНТЕРА, а не от дизайн-сетки приложения.
 * Спецификация Gprinter BP21: 203 dpi = 8 точек/мм, максимальная ширина
 * печати 54 мм → ширина в точках 54 × (203 / 25.4) = 431.6 ≈ 432.
 * BLE (MXW01) продолжает считаться по-прежнему — его математика здесь
 * не проверяется (не менялась).
 * Запуск: bun scripts/test-usb-head-dots.ts
 */
import { strict as assert } from "node:assert";
import {
  clampUsbDpi,
  dpiToDotsPerMm,
  tsplTargetWidth,
  usbPosHeadDots,
  USB_POS_MAX_PRINT_MM,
} from "../src/lib/printer/usb/raster";
import { encodeEscposRaster } from "../src/lib/printer/usb/escpos";
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

test("константа спецификации: печатная ширина BP21 = 54 мм", () => {
  assert.equal(USB_POS_MAX_PRINT_MM, 54);
});

test("usbPosHeadDots: 203 dpi → 432 точки (54 × 203/25.4 = 431.57 → 432)", () => {
  assert.equal(usbPosHeadDots(203), 432);
});

test("usbPosHeadDots: 300 dpi → 638, 600 dpi → 1276 (54 × dpi/25.4)", () => {
  assert.equal(usbPosHeadDots(300), Math.round((54 * 300) / 25.4));
  assert.equal(usbPosHeadDots(300), 638);
  assert.equal(usbPosHeadDots(600), Math.round((54 * 600) / 25.4));
  assert.equal(usbPosHeadDots(600), 1276);
});

test("usbPosHeadDots: 100 dpi → 213; dpi зажимается clampUsbDpi (0/1000 → края)", () => {
  assert.equal(usbPosHeadDots(100), Math.round((54 * 100) / 25.4));
  assert.equal(usbPosHeadDots(100), 213);
  assert.equal(clampUsbDpi(1000), 600);
  assert.equal(usbPosHeadDots(1000), 1276);
  assert.equal(clampUsbDpi(-5), 100);
  assert.equal(usbPosHeadDots(-5), 213);
});

test("согласованность с сеткой 8 px/мм: 54 мм × dpiToDotsPerMm(203) = 432 ровно", () => {
  assert.equal(Math.round(USB_POS_MAX_PRINT_MM * dpiToDotsPerMm(203)), 432);
});

test("TSPL: этикетка 60 мм шире головки → эффективные 54 мм: labelPxW 432, а не 480", () => {
  const eff = Math.min(60, USB_POS_MAX_PRINT_MM);
  assert.equal(eff, 54);
  const capped = tsplTargetWidth(384, eff, 203);
  const uncapped = tsplTargetWidth(384, 60, 203);
  assert.equal(capped.labelPxW, 432);
  assert.equal(uncapped.labelPxW, 480); // именно это головка бы отбросила
  // контент 384 px не апскейлится: цель ≤ 432, растр влезает в головку
  assert.equal(capped.target, 384);
  assert.ok(capped.target <= usbPosHeadDots(203));
});

test("TSPL-энкодер с эффективной этикеткой: SIZE 54 mm, BITMAP 48 байт (384 точки)", () => {
  const w = 384;
  const h = 16;
  const img = { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h };
  // чёрная полоса слева 8 px — видимый маркер
  for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) img.data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  const stream = encodeTsplBitmap(img, {
    labelWidthMm: Math.min(60, USB_POS_MAX_PRINT_MM), // как в контексте v1.0.45
    labelHeightMm: 30,
    gapMm: 2,
    dither: false,
    autoHeight: true,
    dotsPerMm: 8,
  });
  const text = Buffer.from(stream).toString("latin1");
  assert.ok(/^SIZE 54 mm,/.test(text), `SIZE 54 mm, получено: ${text.slice(0, 40)}`);
  assert.ok(/BITMAP 0,224,48,/.test(text), "BITMAP 0,224,48,16 — 48 байт = 384 точки ≤ 432; y = 240−16 = 224 (ведущий край, v1.0.47)");
});

test("ESC/POS: бумага 576 ужимается до головки min(576, 432) = 432 → 54 байта/строку", () => {
  const paperWidth = 576;
  const target = Math.min(paperWidth, usbPosHeadDots(203));
  assert.equal(target, 432);
  const bytesPerRow = Math.ceil(target / 8);
  assert.equal(bytesPerRow, 54);
  // полный энкодер: бинарный чёрный растр 432×8 → заголовок GS v 0 c xL=54
  const w = 432;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.fill(0, i * 4, i * 4 + 3); // всё чёрное
  const stream = encodeEscposRaster({ data, width: w, height: h }, { dither: false, init: false, feedLines: 0 });
  assert.equal(stream[0], 0x1d);
  assert.equal(stream[1], 0x76);
  assert.equal(stream[4], 54, "xL = 54 байта/строку (432 точки)");
  // бумага 384 не трогается: min(384, 432) = 384 → 48 байт (WYSIWYG с превью)
  assert.equal(Math.min(384, usbPosHeadDots(203)), 384);
});

console.log(`\nИтого: ${passed} ок, ${failed} падело`);
if (failed > 0) process.exit(1);
