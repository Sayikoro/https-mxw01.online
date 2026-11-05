#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * - извлечение CRC8-таблицы из npm-драйвера mxw01-thermal-printer в
 *   расширение: table берётся из dist/index.js БЕЗ ручного переписывания,
 *   чтобы исключить опечатки в 256 значениях -
 */
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "/home/z/my-project/node_modules/mxw01-thermal-printer/dist/index.js";
const OUT = "/home/z/my-project/extension/mxw01-printer/lib/crc8.js";

const code = fs.readFileSync(SRC, "utf8");
// - первая массив-константа `const I = [ ... ];` в dist — это и есть таблица CRC8 -
const m = code.match(/const I = \[([\s\S]*?)\];/);
if (!m) {
  console.error("Таблица CRC8 не найдена в драйвере");
  process.exit(1);
}
const table = m[1]
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map(Number);
if (table.length !== 256 || table.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
  console.error("Неожиданный размер/содержимое таблицы:", table.length);
  process.exit(1);
}
// - контроль: стандартная CRC8 (poly 0x07, init 0) обязана совпасть со значениями -
// - драйвера — это обычная табличная реализация CRC-8/SMBUS -
const std = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  std.push(c);
}
let mismatches = 0;
for (let i = 0; i < 256; i++) if (std[i] !== table[i]) mismatches++;
console.log("Совпадение со стандартной CRC8 (poly 0x07):", mismatches === 0 ? "ДА" : `НЕТ (${mismatches})`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const lines = [];
for (let i = 0; i < 256; i += 12) {
  lines.push("  " + table.slice(i, i + 12).join(", ") + ",");
}
const out = `/**
 * - CRC8-таблица MXW01 — извлечена СКРИПТОМ из npm-драйвера
 *   mxw01-thermal-printer (dist/index.js, const I = [...]) один в один,
 *   ручное редактирование запрещено. Алгоритм: crc = T[crc ^ байт],
 *   init 0, poly 0x07 (CRC-8/SMBUS), файл генерирует
 *   scripts/extract-crc-table.js -
 */
(function (g) {
  "use strict";
  var TABLE = new Uint8Array([
${lines.join("\n")}
  ]);

  /** - CRC8 потока байт (init 0), как в драйвере: t = TABLE[(t ^ b) & 255] - */
  function crc8(bytes) {
    var t = 0;
    for (var i = 0; i < bytes.length; i++) t = TABLE[(t ^ bytes[i]) & 255];
    return t & 255;
  }

  g.MXWPRINT_CRC8 = { TABLE: TABLE, crc8: crc8 };
})(typeof globalThis !== "undefined" ? globalThis : self);
`;
fs.writeFileSync(OUT, out);
console.log("Записано:", OUT, "| элементов:", table.length, "| crc8('123456789') = 0x" + stdCheck(table));
function stdCheck(t) {
  let c = 0;
  const s = "123456789";
  for (let i = 0; i < s.length; i++) c = t[(c ^ s.charCodeAt(i)) & 255];
  return c.toString(16).padStart(2, "0");
}
