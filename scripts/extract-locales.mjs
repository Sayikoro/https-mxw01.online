/**
 * - Вынос словарей i18n в отдельную папку src/locales (v1.0.48). -
 *  Читает src/lib/printer/i18n.tsx, вырезает тела RU и EN и создаёт:
 *    src/locales/ru.ts  — export const ru
 *    src/locales/en.ts  — export const en
 *  В i18n.tsx тела словарей заменяются импортами (idempotent:
 *  при отсутствии блоков скрипт завершается без изменений).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const SRC = join(ROOT, "src/lib/printer/i18n.tsx");
const OUT_RU = join(ROOT, "src/locales/ru.ts");
const OUT_EN = join(ROOT, "src/locales/en.ts");

const NEW_RU = [
  "",
  "  // --- settings: experimental ---",
  '  "set.experimentalTitle": "Экспериментально",',
  '  "set.experimentalHint":',
  '    "Опциональные функции — могут измениться или исчезнуть в будущих версиях.",',
  '  "set.posBeta": "Поддержка POS (Beta)",',
  '  "set.posBetaHint":',
  '    "Печать на кассовых и этикеточных принтерах по USB (ESC/POS и TSPL) — Gprinter BP21 и совместимые. После включения тип «POS-USB» появится в списке выбора принтера.",',
];
const NEW_EN = [
  "",
  "  // --- settings: experimental ---",
  '  "set.experimentalTitle": "Experimental",',
  '  "set.experimentalHint":',
  '    "Opt-in features — they may change or disappear in future versions.",',
  '  "set.posBeta": "POS support (Beta)",',
  '  "set.posBetaHint":',
  '    "Printing on receipt and label printers over USB (ESC/POS and TSPL) — Gprinter BP21 and compatible. Once enabled, the «POS-USB» type appears in the printer picker.",',
];

const src = readFileSync(SRC, "utf8");

function extractBlock(name) {
  const startMark = `const ${name}: Record<string, string> = {\n`;
  const s = src.indexOf(startMark);
  if (s < 0) return null;
  const bodyStart = s + startMark.length;
  const e = src.indexOf("\n};", bodyStart);
  if (e < 0) return null;
  return { body: src.slice(bodyStart, e), start: s, end: e + 3 };
}

const ruBlock = extractBlock("RU");
const enBlock = extractBlock("EN");
if (!ruBlock || !enBlock) {
  console.log("Блоки RU/EN не найдены (уже вынесены?) — выход без изменений");
  process.exit(0);
}

const RU_HEADER = `/**
 * - Локализация: русский словарь — весь текст интерфейса живёт здесь. -
 *  Плоские ключи «раздел.подраздел.название» со вставками {var};
 *  подключается в src/lib/printer/i18n.tsx, английская пара —
 *  src/locales/en.ts. Новые ключи добавлять СРАЗУ в оба словаря.
 */
export const ru: Record<string, string> = {
`;

const EN_HEADER = `/**
 * - Локализация: английский словарь — парный к src/locales/ru.ts. -
 *  Ключи и вставки {var} совпадают с русским словарем; подключается
 *  в src/lib/printer/i18n.tsx. Новые ключи добавлять СРАЗУ в оба словаря.
 */
export const en: Record<string, string> = {
`;

writeFileSync(OUT_RU, RU_HEADER + ruBlock.body + NEW_RU.join("\n") + "\n};\n");
writeFileSync(OUT_EN, EN_HEADER + enBlock.body + NEW_EN.join("\n") + "\n};\n");

// - Пересобираем i18n.tsx: без тел словарей, с импортами из src/locales -
let out = src;
const first = Math.min(ruBlock.start, enBlock.start);
const last = Math.max(ruBlock.end, enBlock.end);
// блоки разделены комментарием/пустыми строками — вырезаем всё между ними
out = out.slice(0, first) + out.slice(last);
const dictsOld = "const DICTS: Record<Lang, Record<string, string>> = { ru: RU, en: EN };";
const dictsNew = 'const DICTS: Record<Lang, Record<string, string>> = { ru, en };';
if (!out.includes(dictsOld)) {
  console.error("Не найдена строка DICTS — прерываю, файлы src/locales уже созданы");
  process.exit(1);
}
out = out.replace(dictsOld, dictsNew);
// импорты словарей после блока импортов React
const reactImportEnd = out.indexOf('} from "react";');
if (reactImportEnd < 0) {
  console.error("Не найден импорт react");
  process.exit(1);
}
const insertAt = out.indexOf("\n", reactImportEnd) + 1;
const localeImports =
  'import { ru } from "@/locales/ru";\nimport { en } from "@/locales/en";\n';
out = out.slice(0, insertAt) + localeImports + out.slice(insertAt);
// шапка: упоминание отдельной папки словарей
out = out.replace(
  " *  t(\"ключ\", {vars}) — словарь с интерполяцией {var};",
  " *  t(\"ключ\", {vars}) — словарь с интерполяцией {var} (словари лежат\n *  в отдельной папке src/locales — ru.ts и en.ts);"
);
writeFileSync(SRC, out);
console.log(
  "OK: ru.ts", existsSync(OUT_RU), "en.ts", existsSync(OUT_EN),
  "i18n.tsx строк теперь:", out.split("\n").length
);
