/**
 * Тесты штрихкодов (barcode.ts — чистые энкодеры, без DOM).
 * Запуск: bun scripts/test-barcode.ts
 */
import {
  ean13CheckDigit,
  normalizeEan13,
  ean13Modules,
  code128Values,
  code128Runs,
  detectBarcodeKind,
  planBarcode,
} from "../src/lib/printer/barcode.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

/* ---------------- EAN-13 ---------------- */
console.log("EAN-13:");
check("контрольная цифра 400638133393 → 1", ean13CheckDigit("400638133393") === 1);
check("контрольная цифра 123456789012 → 8", ean13CheckDigit("123456789012") === 8);
check("normalizeEan13: 12 цифр → добавлена контрольная", normalizeEan13("400638133393") === "4006381333931");
check("normalizeEan13: 13 цифр верная → как есть", normalizeEan13("4006381333931") === "4006381333931");
check("normalizeEan13: 13 цифр неверная сумма → null", normalizeEan13("4006381333932") === null);
check("normalizeEan13: буквы → null", normalizeEan13("40063813339a") === null);

const bits = ean13Modules("4006381333931");
check("модули: 95 бит", bits?.length === 95, String(bits?.length));
check("модули: старт 101", bits?.startsWith("101") === true);
check("модули: конец 101", bits?.endsWith("101") === true);
check("модули: центр 01010 (после левой половины)", bits?.slice(3 + 42, 3 + 42 + 5) === "01010");
// Первая цифра 4 → чётность LGLLGG; левая цифра 0 (позиция 2) = G-код "0100111"
check("чётность: цифра 0 кодируется G-кодом 0100111", bits?.slice(3 + 7, 3 + 14) === "0100111", bits?.slice(3 + 7, 3 + 14));
// Правая половина — всегда R-коды: цифра 3 → "1000010"
check("правая половина R-кодом", bits?.slice(50, 57) === "1000010", bits?.slice(50, 57));
check("ean13Modules: неверная контрольная → null", ean13Modules("4006381333932") === null);

/* ---------------- Code-128 ---------------- */
console.log("Code-128:");
// Канонический тестовый вектор: Code B «HI» → 104, 40, 41, контроль 20
check("code128Values('HI') = [104, 40, 41, 20]", JSON.stringify(code128Values("HI")) === "[104,40,41,20]", JSON.stringify(code128Values("HI")));
const hi = code128Runs("HI");
check("runs: паттерны start-B/H/I/check/stop", hi?.runs.join(",") === "2,1,1,2,1,4,2,3,1,1,1,3,2,3,1,3,1,1,2,2,1,2,3,1,2,3,3,1,1,1,2", hi?.runs.join(","));
// 5 символов (start + 2 данных + check + stop): 4·11 + 13 = 57 модулей
check("модули HI = 57", hi?.modules === 57, String(hi?.modules));
check("code128: кириллица → null", code128Values("Привет") === null);
check("code128: пустая строка → null", code128Values("") === null);
check("code128: слишком длинный → null", code128Values("x".repeat(49)) === null);
check("code128: ASCII 32..126 ок", code128Values("ABC-123 abc!") !== null);

/* ---------------- авто-определение ---------------- */
console.log("detectBarcodeKind:");
check("12 цифр → ean13", detectBarcodeKind("400638133393") === "ean13");
check("13 цифр с верной суммой → ean13", detectBarcodeKind("4006381333931") === "ean13");
check("13 цифр с неверной суммой → code128", detectBarcodeKind("4006381333932") === "code128");
check("буквы и цифры → code128", detectBarcodeKind("ABC-123") === "code128");
check("кириллица → null", detectBarcodeKind("Штрих") === null);
check("пустая → null", detectBarcodeKind("  ") === null);
check("слишком длинный → null", detectBarcodeKind("x".repeat(49)) === null);

/* ---------------- planBarcode ---------------- */
console.log("planBarcode:");
const p1 = planBarcode("4006381333931");
check("ean13: runs и modules согласованы", p1 !== null && p1.runs.reduce((a, b) => a + b, 0) === p1.modules && p1.modules === 95);
check("ean13: подпись = нормализованный код", p1?.text === "4006381333931");
check("ean13: 12 цифр — контрольная добавлена", planBarcode("400638133393")?.text === "4006381333931");
const p2 = planBarcode("ABC-123");
check("code128: план строится", p2 !== null && p2.kind === "code128" && p2.runs.reduce((a, b) => a + b, 0) === p2.modules);
check("code128: runs чередуются (не может начинаться с 0)", p2 !== null && p2.runs.every((r) => r >= 1));
check("мусор → null", planBarcode("не штрихкод!") === null);
check("пустой → null", planBarcode("") === null);

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : "\nВсе тесты прошли");
process.exit(failed ? 1 : 0);
