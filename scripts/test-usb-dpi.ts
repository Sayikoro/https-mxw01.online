/**
 * Юнит-тесты разрешения печати DPI (v1.0.43): пересчёт «мм → точки головки»
 * для TSPL при разных разрешениях термоголовки. При 203 dpi математика
 * ПОБИТНО идентична прежней (labelPxW = labelW·8) — это страхует регрессию
 * v1.0.40/v1.0.42 (масштаб только по ширине, авто-длина этикетки).
 * Запуск: bun scripts/test-usb-dpi.ts
 */
import { strict as assert } from "node:assert";
import { USB_BASE_DPI, clampUsbDpi, dpiToDotsPerMm, tsplTargetWidth, USB_DEFAULT_DPI } from "../src/lib/printer/usb/raster";

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

test("база: USB_BASE_DPI = 203, dpiToDotsPerMm(203) === 8 ровно", () => {
  assert.equal(USB_BASE_DPI, 203);
  assert.equal(dpiToDotsPerMm(203), 8);
});

test("dpiToDotsPerMm: 300 → ≈11.82, 600 → ≈23.65; зажим мусора (0 → 1 точка/мм)", () => {
  assert.ok(Math.abs(dpiToDotsPerMm(300) - (8 * 300) / 203) < 1e-12);
  assert.ok(Math.abs(dpiToDotsPerMm(600) - (8 * 600) / 203) < 1e-12);
  assert.equal(dpiToDotsPerMm(0), 8 / 203);
  assert.equal(dpiToDotsPerMm(-5), 8 / 203);
});

test("203 dpi, холст 384, этикетка 40 мм → 320 точек (как в v1.0.42, даунскейл)", () => {
  const r = tsplTargetWidth(384, 40, 203);
  assert.equal(r.dotsPerMm, 8);
  assert.equal(r.labelPxW, 320);
  assert.equal(r.target, 320);
});

test("203 dpi, холст 384, этикетка 48 мм → 384 (1:1, без апскейла)", () => {
  const r = tsplTargetWidth(384, 48, 203);
  assert.equal(r.labelPxW, 384);
  assert.equal(r.target, 384);
});

test("203 dpi, холст 300, этикетка 48 мм → 300 (не растягиваем под этикетку)", () => {
  const r = tsplTargetWidth(300, 48, 203);
  assert.equal(r.labelPxW, 384);
  assert.equal(r.target, 300);
});

test("203 dpi, стопка копий 768 px, этикетка 40 мм → 320 (ширина та же)", () => {
  const r = tsplTargetWidth(768, 40, 203);
  assert.equal(r.target, 320);
});

test("300 dpi, холст 384, этикетка 40 мм → ≈473 точки (40 мм × 11.82 точек/мм)", () => {
  const r = tsplTargetWidth(384, 40, 300);
  assert.equal(r.labelPxW, 473); // round(40 · 8 · 300/203) = round(472.9)
  // floor от плавающей точки может дать 472 или 473 — обе ширины ≤ labelPxW
  assert.ok(r.target === 473 || r.target === 472, `target = ${r.target}`);
  assert.ok(r.target <= r.labelPxW);
});

test("300 dpi, холст 384, этикетка 100 мм → без ужимания (контент уже этикетки)", () => {
  const r = tsplTargetWidth(384, 100, 300);
  // labelPxW = round(100·11.82) = 1182 > contentDots = 567.5 → scale 1
  assert.ok(r.target === 567 || r.target === 568, `target = ${r.target}`);
});

test("600 dpi, холст 384, этикетка 40 мм → labelPxW 946, target ≤ labelPxW", () => {
  const r = tsplTargetWidth(384, 40, 600);
  assert.equal(r.labelPxW, 946); // round(40 · 23.645) = round(945.8)
  assert.ok(r.target === 946 || r.target === 945, `target = ${r.target}`);
});

test("зажим DPI: 50 → 100, 9999 → 600, дробное → округление", () => {
  assert.equal(clampUsbDpi(50), 100);
  assert.equal(clampUsbDpi(9999), 600);
  assert.equal(clampUsbDpi(299.6), 300);
  assert.equal(clampUsbDpi(USB_DEFAULT_DPI), 203);
});

console.log(
  failed === 0
    ? `\nИТОГ: test-usb-dpi ${passed}/${passed + failed} ✓`
    : `\nИТОГ: test-usb-dpi упало ${failed}`
);
if (failed > 0) process.exit(1);
