/**
 * Тесты тон-редактора изображений (image-processing.ts — чистые функции).
 * Запуск: bun scripts/test-image-processing.ts
 */
import {
  toGray,
  grayWithTone,
  sharpenGray,
  autoTone,
  ditherGray,
  BAYER8,
} from "../src/lib/printer/image-processing.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}
function near(a: number, b: number, eps = 2): boolean {
  return Math.abs(a - b) <= eps;
}

/* ---------------- toGray: альфа → белый, luma BT.709 ---------------- */
console.log("toGray:");
// Белый, чёрный, красный
const rgba1 = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
const g1 = toGray(rgba1);
check("белый → 255", g1[0] === 255);
check("чёрный → 0", g1[1] === 0);
check("красный → 54 (0.2125·255)", near(g1[2], 54.19, 1), String(g1[2]));
// Полупрозрачный чёрный на белом: a=128 → смешивание с белым
const rgba2 = new Uint8ClampedArray([0, 0, 0, 128]);
const g2 = toGray(rgba2);
check("альфа 128 → смесь с белым (~127)", near(g2[0], 127, 2), String(g2[0]));

/* ---------------- тон: гамма-яркость + контраст ---------------- */
console.log("grayWithTone:");
const g = new Uint8ClampedArray([0, 64, 128, 192, 255]);
check("нейтрально (0,0) = копия", (() => {
  const r = grayWithTone(g, 0, 0);
  return r[0] === 0 && r[2] === 128 && r[4] === 255;
})());
// Чёрный и белый не сдвигаются ни при какой яркости — ключевое свойство
check("чёрный/белый не сдвигаются при −100", (() => {
  const r = grayWithTone(g, -100, 0);
  return r[0] === 0 && r[4] === 255;
})());
check("чёрный/белый не сдвигаются при +100", (() => {
  const r = grayWithTone(g, 100, 0);
  return r[0] === 0 && r[4] === 255;
})());
// Гамма: −100 → g=4 → 128·((128/255)^4) ≈ 15.6; +100 → g=0.25 → ≈ 215
check("яркость −100: 128 → ~16", near(grayWithTone(g, -100, 0)[2], 16, 2), String(grayWithTone(g, -100, 0)[2]));
check("яркость +100: 128 → ~215", near(grayWithTone(g, 100, 0)[2], 215, 2), String(grayWithTone(g, 100, 0)[2]));
// Контраст: +100 → k=2: 64 → 0, 192 → 255; −100 → всё в 128
check("контраст +100: 64 → 0, 192 → 255", (() => {
  const r = grayWithTone(g, 0, 100);
  return r[1] === 0 && r[3] === 255;
})());
check("контраст −100: всё → 128", (() => {
  const r = grayWithTone(g, 0, -100);
  return r.every((v) => v === 128);
})());
check("вход не мутируется", g[1] === 64 && g[2] === 128);

/* ---------------- резкость ---------------- */
console.log("sharpenGray:");
const flat = new Uint8ClampedArray(9 * 9).fill(100);
check("плоское поле не искажается", (() => {
  const r = sharpenGray(flat, 9, 9, 100);
  return r.every((v) => v === 100);
})());
check("amount 0 → копия", (() => {
  const src = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const r = sharpenGray(src, 3, 3, 0);
  return r[0] === 10 && r[8] === 90 && r !== src;
})());
// Ступенька 64|192 с резкостью 100: центр края уходит в контраст
const step = new Uint8ClampedArray(6 * 3);
for (let y = 0; y < 3; y++) {
  for (let x = 0; x < 6; x++) step[y * 6 + x] = x < 3 ? 64 : 192;
}
const stepSharp = sharpenGray(step, 6, 3, 100);
const darkSide = stepSharp[1 * 6 + 2]; // последний пиксель тёмной стороны края
const lightSide = stepSharp[1 * 6 + 3]; // первый пиксель светлой стороны
check("ступенька обостряется: тёмная сторона темнее 64", darkSide < 40, String(darkSide));
check("ступенька обостряется: светлая сторона светлее 192", lightSide > 216, String(lightSide));

/* ---------------- автотон ---------------- */
console.log("autoTone:");
// Узкий тёмный диапазон 30..80 → нужен подъём
const dark = new Uint8ClampedArray(1000);
for (let i = 0; i < dark.length; i++) dark[i] = 30 + (i % 51);
const t1 = autoTone(dark);
check("тёмное фото → положительная коррекция", t1.brightness > 0 || t1.contrast > 0, JSON.stringify(t1));
// Полный диапазон → ничего не менять
const full = new Uint8ClampedArray(1000);
for (let i = 0; i < full.length; i++) full[i] = Math.floor((i * 251) % 256);
const t2 = autoTone(full);
check("контрастное фото → почти без правок (brightness 0, контраст ≤ 3)", t2.brightness === 0 && t2.contrast <= 3, JSON.stringify(t2));
// Плоское поле → ничего не менять (hi−lo < 8)
const t3 = autoTone(new Uint8ClampedArray(100).fill(128));
check("плоское поле → {0, 0}", t3.brightness === 0 && t3.contrast === 0, JSON.stringify(t3));

/* ---------------- дизеринг ---------------- */
console.log("ditherGray:");
// Бинарный вход — тождество для всех методов (печать = превью)
const binary = new Uint8ClampedArray(64);
for (let i = 0; i < 64; i++) binary[i] = i % 2 ? 0 : 255;
for (const m of ["steinberg", "bayer", "atkinson", "none"] as const) {
  const r = ditherGray(binary.slice(), 8, 8, m);
  check(`бинарный вход: ${m} — тождество`, r.every((v, i) => v === binary[i]));
}
// Полутон 128 даёт смесь точек
const mid = new Uint8ClampedArray(64 * 64).fill(128);
const d1 = ditherGray(mid, 64, 64, "steinberg");
const blacks = [...d1].filter((v) => v === 0).length;
const whites = [...d1].filter((v) => v === 255).length;
check("steinberg 128: смесь чёрных и белых", blacks > 0 && whites > 0, `${blacks}/${whites}`);
check("steinberg 128: примерно 50/50", Math.abs(blacks - whites) < 400, `${blacks}/${whites}`);
const d2 = ditherGray(new Uint8ClampedArray(64 * 64).fill(128), 64, 64, "none");
check("none: строгий порог (128 → 0, >128 → 255)", [...d2].every((v) => v === 0 || v === 255));
const d3 = ditherGray(new Uint8ClampedArray(64 * 64).fill(129), 64, 64, "none");
check("none: 129 → 255 (строго больше 128, как в драйвере)", d3.every((v) => v === 255));
// Bayer: детерминированный, использует матрицу драйвера
check("BAYER8: 64 значения 0..63, все разные", new Set(BAYER8).size === 64 && Math.max(...BAYER8) === 63);
const d4 = ditherGray(new Uint8ClampedArray(64 * 64).fill(255), 64, 64, "bayer");
check("bayer: белый остаётся белым", d4.every((v) => v === 255));

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : "\nВсе тесты прошли");
process.exit(failed ? 1 : 0);
