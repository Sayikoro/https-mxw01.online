/**
 * Тесты бинарного ресемпла для USB-печати (usb/raster.ts — v1.0.42).
 * Запуск: bun scripts/test-usb-raster.ts
 */
import { isBinaryRgba, resampleBinary, BINARY_LUMA_THRESHOLD } from "../src/lib/printer/usb/raster.ts";
import { encodeTsplBitmap } from "../src/lib/printer/usb/tspl.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

/** Собрать RGBA: белый фон, набор чёрных колонок x (по индексам пикселей) */
function makeRgba(w: number, h: number, blackCols: number[]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (const x of blackCols) {
      const p = (y * w + x) * 4;
      d[p] = 0;
      d[p + 1] = 0;
      d[p + 2] = 0;
      d[p + 3] = 255;
    }
  }
  return d;
}

/** Индексы чёрных пикселей строки y */
function blackInRow(img: { data: Uint8ClampedArray; width: number }, y: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < img.width; x++) {
    const p = (y * img.width + x) * 4;
    if (img.data[p] === 0) out.push(x);
  }
  return out;
}

console.log("isBinaryRgba:");
{
  const d = makeRgba(4, 2, [1]);
  check("строго ч/б → true", isBinaryRgba(d) === true);
  const g = makeRgba(4, 2, [1]);
  g[4] = 128; // первый пиксель второй... (индекс 4 = пиксель 1) — серый
  check("серый пиксель 128 → false", isBinaryRgba(g) === false);
  const a = makeRgba(4, 2, [1]);
  a[7] = 200; // альфа < 255 у пикселя 1
  check("альфа < 255 → false", isBinaryRgba(a) === false);
  const e = new Uint8ClampedArray(0);
  check("пустой растр → true", isBinaryRgba(e) === true);
  const c = makeRgba(4, 2, [0, 3]);
  check("несколько чёрных колонок → true", isBinaryRgba(c) === true);
}

console.log("resampleBinary: 1:1 и увеличение:");
{
  const d = makeRgba(8, 1, [3]);
  const same = resampleBinary({ data: d, width: 8, height: 1 }, 8);
  check("1:1 → тот же объект без копии", same.data === d);
  const up = resampleBinary({ data: d, width: 8, height: 1 }, 16);
  check("увеличение: ширина 16, высота 2", up.width === 16 && up.height === 2, `${up.width}x${up.height}`);
  check("увеличение: колонка 3 → 6-7 (nearest)", JSON.stringify(blackInRow(up, 0)) === "[6,7]", JSON.stringify(blackInRow(up, 0)));
  let allBinary = true;
  for (let i = 0; i < up.data.length; i += 4) {
    const v = up.data[i];
    if ((v !== 0 && v !== 255) || up.data[i + 3] !== 255) allBinary = false;
  }
  check("увеличение: растр остался строго 0/255", allBinary);
  // 2×: 384 → 576 (бумага 80 мм)
  const t = makeRgba(384, 2, [100, 101]);
  const big = resampleBinary({ data: t, width: 384, height: 2 }, 576);
  check("384 → 576: ширина 576", big.width === 576);
  const row = blackInRow(big, 0);
  check(
    "384 → 576: линия 100-101 → 150-152 (3 точки, без размазни)",
    JSON.stringify(row) === "[150,151,152]",
    JSON.stringify(row)
  );
}

console.log("resampleBinary: уменьшение (box + порог):");
{
  // Тот самый кейс чеков: 384 → 320 (этикетка 40 мм), вертикальная линия
  const d = makeRgba(384, 1, [100]);
  const small = resampleBinary({ data: d, width: 384, height: 1 }, 320);
  check("384 → 320: ширина 320", small.width === 320);
  const row = blackInRow(small, 0);
  // dst x=83 покрывает src [99.6, 100.85) → линия 100 покрыта на ~0.83 → чёрная
  check("линия 100 → ровно одна точка (порог, без рассыпания)", JSON.stringify(row) === "[83]", JSON.stringify(row));
  // Полупокрытие: x=3 из 8 → 4: покрытие 0.5 → средняя 127.5 < 128 → чёрная
  const d2 = makeRgba(8, 1, [3]);
  const s2 = resampleBinary({ data: d2, width: 8, height: 1 }, 4);
  check("покрытие 0.5 (127.5) → чёрная (< порога)", JSON.stringify(blackInRow(s2, 0)) === "[1]", JSON.stringify(blackInRow(s2, 0)));
  // Порог сверху: средняя ровно 128 → белая (чёрный = строго < порога)
  const d3 = new Uint8ClampedArray([1, 255, 255, 255, 255, 255, 255, 255]);
  const s3 = resampleBinary({ data: d3, width: 2, height: 1 }, 1);
  check("средняя 128 → белая (граница порога)", blackInRow(s3, 0).length === 0);
  check("константа порога = 128", BINARY_LUMA_THRESHOLD === 128);
  // Широкая линия 2px не исчезает при сжатии вдвое
  const d4 = makeRgba(8, 1, [2, 3]);
  const s4 = resampleBinary({ data: d4, width: 8, height: 1 }, 4);
  check("линия 2px при 8→4 остаётся", JSON.stringify(blackInRow(s4, 0)) === "[1]", JSON.stringify(blackInRow(s4, 0)));
  // Высота: пропорциональное округление как в прежнем rasterize
  const d5 = makeRgba(384, 10, []);
  const s5 = resampleBinary({ data: d5, width: 384, height: 10 }, 320);
  check("высота 10 → round(10·320/384) = 8", s5.height === 8, String(s5.height));
}

console.log("сквозной кейс TSPL (этикетка 40 мм, чек как картинка):");
{
  // Чек 384×16: сплошная чёрная полоса-разделитель + белое
  const d = makeRgba(384, 16, []);
  for (let y = 8; y < 10; y++) for (let x = 0; x < 384; x++) { const p = (y * 384 + x) * 4; d[p] = d[p+1] = d[p+2] = 0; }
  const small = resampleBinary({ data: d, width: 384, height: 16 }, 320);
  const bytes = encodeTsplBitmap(
    { data: small.data, width: small.width, height: small.height },
    { labelWidthMm: 40, labelHeightMm: 30, gapMm: 2, dither: false, autoHeight: true }
  );
  const text = new TextDecoder().decode(bytes.slice(0, 120));
  check("SIZE 40,~40 (авто-высота под 16px строк)", /^SIZE 40 mm,\d+ mm\r\n/.test(text), text.split("\r\n")[0]);
  const m = text.match(/BITMAP 0,227,40,(\d+),0,/); // y = 240 − 13 строк = 227 (ведущий край, v1.0.47)
  check("BITMAP шириной 40 байт (320 точек)", m !== null, text.split("\r\n")[5] ?? "");
  // В данных разделитель: строки 6-7 (8→10 при 384→320 даёт 6.67→8.33 → 7)
  const header = bytes.indexOf(new Uint8Array([0x0c])) >= 0; // заглушка, ниже парсим честно
  void header;
  const asciiEnd = bytes.findIndex((b, i) => b === 0x2c && i > 40) + 1; // конец «0,»
  const raster = bytes.slice(asciiEnd, asciiEnd + 40 * small.height);
  // Найдём строку с максимальным числом единичных битов — это разделитель
  let bestRow = -1, bestCount = -1;
  for (let y = 0; y < small.height; y++) {
    let c = 0;
    for (let x = 0; x < 40; x++) {
      const b = raster[y * 40 + x];
      for (let k = 0; k < 8; k++) if (b & (0x80 >> k)) c++;
    }
    if (c > bestCount) { bestCount = c; bestRow = y; }
  }
  check("разделитель печатается сплошной линией", bestCount === 320, `row=${bestRow} bits=${bestCount}`);
}

console.log(failed === 0 ? "\nВсе тесты usb-raster прошли" : `\nУпало: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
