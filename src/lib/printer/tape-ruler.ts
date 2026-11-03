/**
 * Линейка — контрольная шкала миллиметров на этикетке.
 *
 * Назначение: проверить фактический масштаб печати физической линейкой.
 * Деления размечаются ТОЙ ЖЕ константой PX_PER_MM, что и расчёт длины
 * этикетки (384 точки = 58 мм), поэтому на бумаге линейка показывает
 * ровно то, во что верит приложение: шаг 1 мм = PX_PER_MM точек печати.
 * Если физическая линейка показывает расхождение — калибруется константа
 * PX_PER_MM в types.ts, и весь расчёт длины ленты выравнивается по факту.
 *
 * Геометрия (координаты печати, 1 px = 1 точка): вертикальная базовая
 * линия, деления вправо — малые 1 мм, средние 5 мм, крупные 10 мм;
 * числа у крупных делений (каждые 10 мм) и у последнего деления, если
 * оно отстоит от ближайшего кратного 10 не меньше чем на 4 мм.
 * Отрисовка идёт в логических координатах (контекст масштабирован 4×,
 * ssPx привязывает к целым device-пикселям) — как у разделителей.
 */
import { PX_PER_MM, RULER_MM_MAX, RULER_MM_MIN } from "./types";
import type { RulerItem } from "./types";
import { ssPx } from "./canvas-quality";

/** Нормализованная длина шкалы, мм */
export function rulerMm(r: Pick<RulerItem, "lengthMm">): number {
  const mm = Math.round(Number(r.lengthMm));
  if (!Number.isFinite(mm)) return 50;
  return Math.min(RULER_MM_MAX, Math.max(RULER_MM_MIN, mm));
}

/**
 * Высота блока линейки, px печати — та же математика, что у высоты
 * этикетки (mmToLabelPx): floor(мм × PX_PER_MM). Поэтому линейка длиной
 * N мм занимает ровно столько же точек, сколько этикетка фиксированной
 * длины N мм, — последнее деление совпадает с концом бумаги.
 */
export function rulerHeightPx(r: Pick<RulerItem, "lengthMm">): number {
  return Math.max(1, Math.floor(rulerMm(r) * PX_PER_MM));
}

/**
 * Нарисовать линейку в ЛОГИЧЕСКИХ координатах печати (контекст 4×).
 * Шкала вертикальна: 0 в верхней точке блока (на фиксированной этикетке
 * layoutTape прижимает первую на странице линейку к началу бумаги),
 * деления вниз до lengthMm.
 */
export function drawRulerItem(ctx: CanvasRenderingContext2D, r: RulerItem): void {
  const mm = rulerMm(r);
  const H = Math.max(1, Math.floor(mm * PX_PER_MM));
  const y0 = r.y;
  const t = 2; // толщина линий, px
  const x0 = 64; // базовая линия (вертикальная), px от левого края
  const lenMinor = 16;
  const lenMid = 24;
  const lenMajor = 32;
  const numX = x0 + 40;

  ctx.save();
  ctx.fillStyle = "#000000";
  // Базовая линия во всю высоту блока
  ctx.fillRect(ssPx(x0), ssPx(y0), ssPx(t), ssPx(H));

  ctx.font = "700 20px sans-serif";
  for (let i = 0; i <= mm; i++) {
    // Деление i на расстоянии floor(i × PX_PER_MM) от нуля шкалы;
    // крайнее деление прижимаем внутрь блока (не вылезает на 1 px)
    const ty = Math.min(H - t, Math.floor(i * PX_PER_MM));
    const len = i % 10 === 0 ? lenMajor : i % 5 === 0 ? lenMid : lenMinor;
    ctx.fillRect(ssPx(x0), ssPx(y0 + ty), ssPx(len), ssPx(t));

    // Числа: каждые 10 мм + последнее деление, если оно отстоит от
    // соседнего числа не меньше чем на 6 мм (ниже — слитно бы с ним)
    const showNumber =
      i % 10 === 0 || (i === mm && mm >= 16 && mm % 10 >= 6);
    if (!showNumber) continue;
    // «0» — под верхним делением (не резаться на краю бумаги);
    // последнее деление — НАД чертой (при линейке вровень с этикеткой
    // оно лежит на самом краю бумаги — по центру число обрезалось бы);
    // остальные — по центру деления
    const textY =
      i === 0 ? y0 + 4 : i === mm ? y0 + ty - 24 : Math.max(y0, y0 + ty - 10);
    ctx.fillText(String(i), ssPx(numX), ssPx(textY));
  }
  ctx.restore();
}
