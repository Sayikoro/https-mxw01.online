/**
 * Тесты линейки (инструмент «Линейка» на ленте): математика высоты
 * и поведение компоновки (прижим к началу фиксированной этикетки).
 * Запуск: bun scripts/test-tape-ruler.ts
 */
import {
  layoutTape,
  PAGE_PAD_TOP,
  type MeasuredTape,
} from "../src/lib/printer/tape";
import { rulerHeightPx, rulerMm } from "../src/lib/printer/tape-ruler";
import { PX_PER_MM, type LabelItem, type RulerItem } from "../src/lib/printer/types";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function ruler(lengthMm: number, id = "r1"): RulerItem {
  return { id, kind: "ruler", x: 64, y: 0, lengthMm };
}

/* ----------------------- Математика высоты ----------------------- */

check("ниже минимума: 1 мм клампится к 5", rulerMm(ruler(1)) === 5 && rulerHeightPx(ruler(1)) === Math.floor(5 * PX_PER_MM));
check("5 мм → floor(5 × PX_PER_MM)", rulerHeightPx(ruler(5)) === Math.floor(5 * PX_PER_MM), String(rulerHeightPx(ruler(5))));
check("50 мм → 400 px", rulerHeightPx(ruler(50)) === Math.floor(50 * PX_PER_MM), String(rulerHeightPx(ruler(50))));
check("90 мм → 720 px", rulerHeightPx(ruler(90)) === 720, String(rulerHeightPx(ruler(90))));
check("кламп снизу: 0 мм → 5 мм", rulerMm(ruler(0)) === 5 && rulerHeightPx(ruler(0)) === Math.floor(5 * PX_PER_MM));
check("кламп сверху: 5000 мм → 500 мм", rulerMm(ruler(5000)) === 500 && rulerHeightPx(ruler(5000)) === Math.floor(500 * PX_PER_MM));
check("дробное округляется", rulerMm(ruler(50.6)) === 51);
check("NaN → 50 мм", rulerMm({ id: "x", kind: "ruler", x: 0, y: 0, lengthMm: NaN }) === 50);

/* --------------------- Компоновка: авто-режим -------------------- */

{
  const layout = layoutTape([ruler(50)]);
  check("авто: одна страница", layout.pages.length === 1);
  const page = layout.pages[0];
  const it = page.items[0] as RulerItem;
  check("авто: высота страницы = 8 + 400 + 12", page.height === rulerHeightPx(ruler(50)) + 20, String(page.height));
  check("авто: линейка на отступе сверху", it.y === PAGE_PAD_TOP);
  check("авто: y не прижимается к 0", it.y !== 0);
}

{
  // Линейка после разделителя: не прижимается, идёт потоком
  // (текст в bun-тестах не используется — fieldLines требует DOM)
  const items: LabelItem[] = [
    { id: "d1", kind: "divider", x: 16, y: 0, width: 352, thickness: 2, style: "solid", height: 3 },
    ruler(50, "r2"),
  ];
  const layout = layoutTape(items);
  const seg = layout.elementSegments[1][0];
  check("авто: линейка после разделителя идёт потоком", seg.top > PAGE_PAD_TOP, String(seg.top));
}

/* -------------------- Компоновка: фикс-режим --------------------- */

{
  // Пресет 30 мм (240 px): линейка 30 мм на своей странице — 0 у края бумаги
  const layout = layoutTape([ruler(30)], { fixedPageHeight: 240 });
  check("фикс 30: одна страница", layout.pages.length === 1);
  check("фикс 30: высота страницы = 240", layout.pages[0].height === 240, String(layout.pages[0].height));
  const it = layout.pages[0].items[0] as RulerItem;
  check("фикс 30: линейка прижата к началу бумаги (y=0)", it.y === 0, String(it.y));
  check("фикс 30: конец шкалы = конец этикетки", rulerHeightPx(ruler(30)) === 240);
}

{
  // Линейка 25 мм на пресете 30 мм: первая на странице → тоже от края
  const layout = layoutTape([ruler(25)], { fixedPageHeight: 240 });
  const it = layout.pages[0].items[0] as RulerItem;
  check("фикс 30/линейка 25: y=0, высота 200", it.y === 0 && rulerHeightPx(it) === Math.floor(25 * PX_PER_MM));
}

{
  // Разделитель выше линейки на фиксированной этикетке: прижатия нет
  const items: LabelItem[] = [
    { id: "d1", kind: "divider", x: 16, y: 0, width: 352, thickness: 2, style: "solid", height: 3 },
    ruler(20, "r3"),
  ];
  const layout = layoutTape(items, { fixedPageHeight: 240 });
  const seg = layout.elementSegments[1][0];
  check("фикс: линейка после разделителя не прижимается", seg.top !== 0 && seg.top > PAGE_PAD_TOP, String(seg.top));
}

{
  // Две линейки 30 мм на пресете 30: по этикетке на каждую
  const layout = layoutTape([ruler(30, "a"), ruler(30, "b")], { fixedPageHeight: 240 });
  check("фикс 30: две линейки → две страницы", layout.pages.length === 2, String(layout.pages.length));
  const yA = (layout.pages[0].items[0] as RulerItem).y;
  const yB = (layout.pages[1].items[0] as RulerItem).y;
  check("фикс 30: обе прижаты к краю", yA === 0 && yB === 0, `${yA}/${yB}`);
}

{
  // Измерение: линейка — цельный блок
  const m: MeasuredTape = { specs: [], linesByElement: new Map(), overlayDividers: [] };
  check("дымо: импорты типов живы", Array.isArray(m.specs));
}

console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
if (failed > 0) process.exit(1);
