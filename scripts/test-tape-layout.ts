/**
 * Тесты движка ленты (bun, без DOM): паковка строк по страницам 58×90 мм,
 * индекс вставки по точке броска, индикатор вставки, вписывание картинок.
 * Запуск: bun scripts/test-tape-layout.ts
 */
import {
  PAGE_GAP,
  PAGE_PAD_BOTTOM,
  PAGE_PAD_TOP,
  fitImageSize,
  indicatorYAt,
  insertIndexAt,
  packRows,
} from "../src/lib/printer/tape";
import { TAPE_PAGE_MAX_PX } from "../src/lib/printer/types";
import type { TapeLayout } from "../src/lib/printer/tape";

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function fakeLayout(pack: ReturnType<typeof packRows>): TapeLayout {
  return {
    pages: pack.pageHeights.map((height, index) => ({ index, height, items: [] })),
    rows: pack.rows,
    elementSegments: pack.elementSegments,
  };
}

/* ---------------- Паковка: одна страница ---------------- */

{
  const pack = packRows([{ elementIndex: 0, lineIndex: 0, height: 50 }]);
  ok(pack.pageHeights.length === 1, "одна строка — одна страница");
  ok(pack.rows[0].page === 0 && pack.rows[0].y === PAGE_PAD_TOP, "первая строка на отступе сверху");
  ok(
    pack.pageHeights[0] === Math.max(96, PAGE_PAD_TOP + 50 + PAGE_PAD_BOTTOM),
    "высота страницы = контент + отступы (мин 96)"
  );
}

{
  // 5 строк одного элемента по 100px — влезают в страницу 720
  const specs = Array.from({ length: 5 }, (_, i) => ({ elementIndex: 0, lineIndex: i, height: 100 }));
  const pack = packRows(specs);
  ok(pack.pageHeights.length === 1, "5×100 — одна страница");
  ok(pack.rows[4].y === PAGE_PAD_TOP + 4 * 100, "строки идут подряд без промежутка");
}

/* ---------------- Паковка: перенос на новую страницу ---------------- */

{
  // 8 строк по 90: 8-я (638+90=728 > 708) не влезает → новая страница
  const specs = Array.from({ length: 8 }, (_, i) => ({ elementIndex: 0, lineIndex: i, height: 90 }));
  const pack = packRows(specs);
  ok(pack.pageHeights.length === 2, "8×90 — две страницы (перенос построчно)");
  ok(pack.rows[6].page === 0 && pack.rows[7].page === 1, "перенос между 7-й и 8-й строкой");
  ok(pack.rows[7].y === PAGE_PAD_TOP, "на новой странице отсчёт сверху");
  ok(pack.rows[6].page === 0, "7 строк влезли (638 ≤ 708)");
}

{
  // Промежуток ТОЛЬКО между элементами
  const pack = packRows([
    { elementIndex: 0, lineIndex: 0, height: 100 },
    { elementIndex: 1, lineIndex: 0, height: 100 },
  ]);
  ok(
    pack.rows[1].y === PAGE_PAD_TOP + 100 + PAGE_GAP,
    `между элементами промежуток ${PAGE_GAP}px`
  );
}

{
  // Граничный случай: строка впритык к полезной высоте
  const usable = TAPE_PAGE_MAX_PX - PAGE_PAD_BOTTOM; // 708
  const h1 = usable - PAGE_PAD_TOP; // 700
  const pack = packRows([
    { elementIndex: 0, lineIndex: 0, height: h1 },
    { elementIndex: 1, lineIndex: 0, height: 10 },
  ]);
  ok(pack.pageHeights.length === 2, "строка впритык — следующая уходит на новую страницу");
  ok(pack.pageHeights[0] === TAPE_PAGE_MAX_PX, "полная страница = 720px (90 мм)");
}

{
  // Одиночная строка выше страницы — своя страница с мягким переливом
  const pack = packRows([{ elementIndex: 0, lineIndex: 0, height: 700 }]);
  ok(pack.pageHeights.length === 1, "переливающаяся строка — одна страница");
  ok(pack.pageHeights[0] === 700 + PAGE_PAD_TOP + PAGE_PAD_BOTTOM, "страница растянута под строку");
}

{
  // Оверлей не входит в паковку (measureTapeItems), но пустой список — пустая лента
  const pack = packRows([]);
  ok(pack.pageHeights.length === 0, "пустой список — ни одной страницы");
}

/* ---------------- Индекс вставки по точке броска ---------------- */

{
  const pack = packRows([
    { elementIndex: 0, lineIndex: 0, height: 250 }, // 8..258, середина 133
    { elementIndex: 1, lineIndex: 0, height: 250 }, // 266..516, середина 391
    { elementIndex: 2, lineIndex: 0, height: 250 }, // 266+250 не влезает → страница 1
  ]);
  const layout = fakeLayout(pack);

  ok(insertIndexAt(layout, 0, 20) === 0, "бросок над серединой 1-го — вставка в начало");
  ok(insertIndexAt(layout, 0, 200) === 1, "бросок ниже середины 1-го — перед 2-м");
  ok(insertIndexAt(layout, 0, 500) === 2, "бросок ниже середины 2-го — после него");
  ok(insertIndexAt(layout, 1, 200) === 3, "бросок на второй странице ниже середины 3-го — в конец");
  ok(insertIndexAt(layout, 1, 0) === 2, "бросок в самый верх второй страницы — перед 3-м");
}

/* ---------------- Индикатор вставки ---------------- */

{
  const pack = packRows([
    { elementIndex: 0, lineIndex: 0, height: 100 },
    { elementIndex: 1, lineIndex: 0, height: 100 },
  ]);
  const layout = fakeLayout(pack);
  ok(indicatorYAt(layout, 0, 0) === PAGE_PAD_TOP, "индикатор над всеми — верх первой строки");
  ok(indicatorYAt(layout, 0, 110) === PAGE_PAD_TOP + 100 + PAGE_GAP, "индикатор между элементами");
  ok(
    indicatorYAt(layout, 0, 9999) === pack.pageHeights[0] - PAGE_PAD_BOTTOM,
    "индикатор ниже всех — низ контента"
  );
}

/* ---------------- Вписывание картинок в блок ленты ---------------- */

{
  const a = fitImageSize(1000, 2000);
  ok(a.width === 360 && a.height === 720, `высокая картинка: 1000×2000 → ${a.width}×${a.height} (по высоте)`);
  const b = fitImageSize(100, 50);
  ok(b.width === 100 && b.height === 50, "маленькая картинка не растягивается");
  const c = fitImageSize(768, 768);
  ok(c.width === 384 && c.height === 384, "широкая картинка — по ширине 384");
}

/* ---------------- Итог ---------------- */

console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
if (failed > 0) process.exit(1);
