/**
 * Тесты раскладки копий (copies.ts — чистая математика planCopies/clampCopies).
 * Запуск: bun scripts/test-copies.ts
 */
import { planCopies, clampCopies } from "../src/lib/printer/copies.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

console.log("clampCopies:");
check("1 → 1", clampCopies(1) === 1);
check("дробное 2.6 → 3", clampCopies(2.6) === 3);
check("0 → 1", clampCopies(0) === 1);
check("−5 → 1", clampCopies(-5) === 1);
check("9999 → 50 (COPIES_MAX)", clampCopies(9999) === 50);
check("NaN → 1", clampCopies(NaN) === 1);

console.log("planCopies (столбик):");
let p = planCopies(384, 100, 3, "stack", 8);
check("столбик: ширина = 384", p.outW === 384);
check("столбик: высота 3·100 + 2·8 = 316", p.outH === 316, String(p.outH));
check("столбик: cols=1 rows=3", p.cols === 1 && p.rows === 3);
p = planCopies(384, 100, 1, "stack", 0);
check("1 копия: высота = 100", p.outH === 100);
p = planCopies(100, 50, 4, "stack", 0);
check("столбик узкой копии: высота 4·50 = 200", p.outH === 200);

console.log("planCopies (в ряд):");
// Копия 100 px: floor((384+8)/108) = 3 колонки
p = planCopies(100, 50, 7, "row", 8);
check("в ряд 100px: cols=3", p.cols === 3, String(p.cols));
check("в ряд 7 копий: rows=3", p.rows === 3, String(p.rows));
check("в ряд: высота 3·50 + 2·8 = 166", p.outH === 166, String(p.outH));
check("в ряд: ширина = 384", p.outW === 384);
// Вплотную: floor(384/110) = 3
p = planCopies(110, 50, 6, "row", 0);
check("в ряд 110px без промежутка: cols=3", p.cols === 3, String(p.cols));
// Копия на всю ширину → столбик (fallback)
p = planCopies(384, 100, 3, "row", 8);
check("row при 384px → fallback столбик", p.cols === 1 && p.rows === 3);
p = planCopies(400, 100, 3, "row", 8);
check("row при ширине > 384 → fallback столбик", p.cols === 1);
// 1 копия «в ряд»
p = planCopies(100, 50, 1, "row", 8);
check("в ряд 1 копия: rows=1", p.rows === 1 && p.outH === 50);

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : "\nВсе тесты прошли");
process.exit(failed ? 1 : 0);
