/**
 * Тесты движка ленты (tape.ts): паковка строк по страницам, вставка по
 * точке броска, фиксированная высота этикетки, вписывание картинок,
 * высоты встроенных разделителей и мм → px. Чистая математика без DOM
 * (текстовые элементы не участвуют — им нужен canvas).
 * Запуск: bun scripts/test-tape.ts
 */
import {
  packRows,
  layoutTape,
  insertIndexAt,
  indicatorYAt,
  fitImageSize,
  type TapeRowSpec,
  type TapeLayout,
} from "../src/lib/printer/tape.ts";
import {
  PAGE_PAD_TOP,
  PAGE_PAD_BOTTOM,
  PAGE_GAP,
  PAGE_MIN_PX,
} from "../src/lib/printer/tape.ts";
import { builtinDividerHeight } from "../src/lib/printer/text-fields.ts";
import { TAPE_PAGE_MAX_PX, PX_PER_MM, isDivider, isImage } from "../src/lib/printer/types.ts";
import { mmToLabelPx } from "../src/lib/printer/label-size.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

function spec(height: number, elementIndex = 0, lineIndex = 0): TapeRowSpec {
  return { elementIndex, lineIndex, height };
}

console.log("packRows: авто-режим (страницы до 720 px):");
{
  // 3 строки одного элемента по 250 px: 8 + 500 = 508 ≤ 708, третья не влезает
  const r = packRows([spec(250), spec(250), spec(250)]);
  check("одна страница до переноса", r.pageHeights.length === 2, JSON.stringify(r.pageHeights));
  check("третья строка ушла на стр. 2", r.rows[2].page === 1);
  check("высота стр.1 = контент + паддинг", r.pageHeights[0] === 508 + PAGE_PAD_BOTTOM, String(r.pageHeights[0]));
  check("минимальная высота страницы", r.pageHeights[1] >= PAGE_MIN_PX);
}

console.log("packRows: промежуток только между элементами:");
{
  const r = packRows([
    spec(50, 0, 0),
    spec(50, 0, 1),
    spec(50, 1, 0),
  ]);
  check("первый элемент от верхнего паддинга", r.rows[0].y === PAGE_PAD_TOP);
  check("вторая строка элемента — без промежутка", r.rows[1].y === PAGE_PAD_TOP + 50);
  check("новый элемент — с промежутком", r.rows[2].y === PAGE_PAD_TOP + 100 + PAGE_GAP);
}

console.log("packRows: фиксированная высота (этикетка 40 мм = 320 px):");
{
  const cap = mmToLabelPx(40);
  const r = packRows([spec(100), spec(100), spec(100), spec(100)], { capacity: cap, fixed: true });
  check("все страницы ровно по 320 px", r.pageHeights.every((h) => h === cap), JSON.stringify(r.pageHeights));
  check("контент распределился на 2 страницы", r.pageHeights.length === 2, JSON.stringify(r.pageHeights));
  check("первая страница вмещает 3 строки", r.rows[2].page === 0 && r.rows[3].page === 1);
}

console.log("packRows: одиночная строка выше страницы:");
{
  const r = packRows([spec(1500)]);
  check("строка получила свою страницу", r.rows[0].page === 0 && r.rows[0].y === PAGE_PAD_TOP);
  check("высота страницы с переливом", r.pageHeights[0] >= 1500, String(r.pageHeights[0]));
}

console.log("layoutTape: разделители и картинки:");
{
  const items = [
    { id: "d1", kind: "divider" as const, x: 16, y: 0, width: 352, thickness: 2, style: "solid" as const, height: builtinDividerHeight("solid", 2) },
    { id: "i1", kind: "image" as const, src: "data:image/png;base64,x", x: 0, y: 0, width: 100, height: 60, dither: "none" as const, brightness: 0, contrast: 0 },
    { id: "d2", kind: "divider" as const, x: 16, y: 0, width: 240, thickness: 3, style: "zigzag" as const, height: builtinDividerHeight("zigzag", 3) },
  ];
  const layout = layoutTape(items);
  check("три элемента на одной странице", layout.pages.length === 1 && layout.pages[0].items.length === 3);
  check("y идут по потоку", layout.pages[0].items[0].y < layout.pages[0].items[1].y && layout.pages[0].items[1].y < layout.pages[0].items[2].y);
  check("зигзаг выше сплошной при той же толщине", items[2].height > items[0].height);
  check("двойная = 2t+3", builtinDividerHeight("double", 2) === 7);
}

console.log("layoutTape: оверлей «поверх текста» (без текста — как блок):");
{
  const overlayFirst = [
    { id: "o1", kind: "divider" as const, x: 16, y: 0, width: 352, thickness: 1, style: "dotted" as const, height: 3, overlay: true },
  ];
  const l1 = layoutTape(overlayFirst);
  check("оверлей без предыдущего — печатает блоком", l1.pages.length === 1 && l1.pages[0].items.length === 1);
}

console.log("insertIndexAt / indicatorYAt:");
{
  const items = [
    { id: "a", kind: "divider" as const, x: 16, y: 0, width: 100, thickness: 1, style: "solid" as const, height: 3 },
    { id: "b", kind: "divider" as const, x: 16, y: 0, width: 100, thickness: 1, style: "solid" as const, height: 3 },
    { id: "c", kind: "divider" as const, x: 16, y: 0, width: 100, thickness: 1, style: "solid" as const, height: 3 },
  ];
  const layout: TapeLayout = layoutTape(items);
  check("бросок выше всего → индекс 0", insertIndexAt(layout, 0, 1) === 0);
  const mids = layout.elementSegments.map((s) => (s[0].top + s[0].bottom) / 2);
  const between = (mids[0] + mids[1]) / 2;
  check("бросок между 1-м и 2-м → индекс 1", insertIndexAt(layout, 0, between) === 1, String(insertIndexAt(layout, 0, between)));
  check("бросок ниже всего → индекс 3", insertIndexAt(layout, 0, layout.pages[0].height) === 3);
  const iy = indicatorYAt(layout, 0, 1);
  check("индикатор прилипает к первой строке", iy === layout.rows[0].y, String(iy));
}

console.log("fitImageSize:");
{
  check("большая горизонтальная — по ширине 384", fitImageSize(1000, 500).width === 384);
  check("пропорции сохранены", Math.abs(fitImageSize(1000, 500).height - 192) <= 1);
  check("маленькая не растягивается", fitImageSize(50, 30).width === 50 && fitImageSize(50, 30).height === 30);
  check("высокая — по высоте страницы", fitImageSize(200, 5000).height <= TAPE_PAGE_MAX_PX);
}

console.log("типы и константы:");
{
  check("TAPE_PAGE_MAX_PX = 720", TAPE_PAGE_MAX_PX === 720, String(TAPE_PAGE_MAX_PX));
  check("PX_PER_MM = 8 (203 DPI, 384/48)", Math.abs(PX_PER_MM - 384 / 48) < 1e-9);
  const d = { id: "x", kind: "divider" as const, x: 0, y: 0, width: 10, thickness: 1, style: "solid" as const, height: 2 };
  check("isDivider/isImage", isDivider(d) && !isImage(d));
}

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : "\nВсе тесты прошли");
process.exit(failed ? 1 : 0);
