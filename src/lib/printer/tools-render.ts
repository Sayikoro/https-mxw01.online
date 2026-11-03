/**
 * Рендереры инструментов вкладки «Инструменты»: данные → бинарная лента
 * 384×N. Каждый рендер — чистая функция без React: собирает фрагменты
 * (tools-canvas.ts) и возвращает готовый канвас + границы страниц, либо
 * null, если печатать нечего (компонент показывает пустое состояние).
 * Рисование в 4× суперсэмплинге с бинаризацией: печать = превью,
 * драйвер `mxw01-thermal-printer` не изменяется.
 */
import QRCode from "qrcode";
import { PX_PER_MM } from "./types";
import type { Translator } from "./i18n";
import type { Lang } from "./i18n";
import { renderBarcodeCanvas } from "./barcode";
import {
  drawCheckbox,
  drawDashedLine,
  drawDottedLeader,
  drawRoundedFrame,
  composeToolCanvas,
  measureCtx,
  wrapTextLines,
  TOOL_WIDTH,
  TOOL_MARGIN_X,
  TOOL_INK,
} from "./tools-canvas";
import type { ToolPiece, ToolComposeResult } from "./tools-canvas";
import {
  addDuration,
  calendarGrid,
  daysInMonth,
  formatDateHuman,
  formatMoney,
  isBarcodeSafe,
  monthTitle,
  numberSeries,
  receiptTotals,
  todayISO,
  weekdayLabels,
  wifiPayload,
} from "./tools-data";
import type { WifiData as WifiToolData } from "./tools-data";

/* ------------------------------------------------------------------ */
/* Типы данных инструментов                                            */
/* ------------------------------------------------------------------ */

/**
 * Схемы данных инструментов живут в types.ts (их же хранит ToolItem ленты):
 * единый источник для рендереров, форм и нормализации localStorage.
 */
import type {
  CalendarToolData,
  ChecklistToolData,
  DatesToolData,
  HabitsToolData,
  NumbersToolData,
  QrToolData,
  ReceiptToolData,
  ReplacementToolData,
  ToolTypo,
} from "./types";
export type {
  CalendarToolData,
  ChecklistToolData,
  ChecklistToolItem,
  DatesToolData,
  HabitsToolData,
  NumbersToolData,
  QrToolData,
  ReceiptToolData,
  ReceiptToolItem,
} from "./types";

/** Максимум привычек в трекере (по ширине ленты) */
export const MAX_HABITS = 6;

/* ------------------------------------------------------------------ */
/* Вспомогательные шрифты                                              */
/* ------------------------------------------------------------------ */

const F_TITLE = (px: number) => `700 ${px}px sans-serif`;
const F_BODY = (px: number) => `400 ${px}px sans-serif`;

/**
 * Шрифтовые хелперы с типографикой блока (ToolTypo): кегль умножается на
 * масштаб; семья берётся из настройки. Если типографики нет (старый элемент),
 * роли получают исходные шрифты: заголовок/текст — sans-serif, моноширинные
 * роли (чек, дата) — monospace — рендер совпадает с прежним байт в байт.
 * Выбранный пользователем шрифт применяется ко ВСЕМ ролям блока.
 * renderTestPage намеренно использует базовые F_* — тестовая страница
 * служит эталоном масштаба печати.
 */
function makeFonts(typo?: ToolTypo): {
  s: number;
  title: (px: number) => string;
  body: (px: number) => string;
  mono: (px: number) => string;
  monoBold: (px: number) => string;
} {
  const raw = typo?.scale;
  const s = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;
  const fam = typo?.fontFamily || "";
  return {
    s,
    title: (px: number) => `700 ${px * s}px ${fam || "sans-serif"}`,
    body: (px: number) => `400 ${px * s}px ${fam || "sans-serif"}`,
    mono: (px: number) => `400 ${px * s}px ${fam || "monospace"}`,
    monoBold: (px: number) => `700 ${px * s}px ${fam || "monospace"}`,
  };
}

function textLines(text: string, font: string, maxWidth: number): string[] {
  const ctx = measureCtx();
  ctx.font = font;
  return wrapTextLines(ctx, text, maxWidth);
}

/* ------------------------------------------------------------------ */
/* 1. QR-код по произвольным данным                                    */
/* ------------------------------------------------------------------ */

/** Нарисовать QR-матрицу в логических координатах (sync через QRCode.create) */
function drawQrMatrix(
  ctx: CanvasRenderingContext2D,
  text: string,
  level: "L" | "M" | "Q" | "H",
  centerX: number,
  y: number,
  size: number
): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  const count = qr.modules.size;
  const cell = size / count;
  const x0 = centerX - size / 2;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.data[r * count + c]) {
        // +0.25 — компенсация проседания на бинаризации, модуль остаётся цельным
        ctx.fillRect(x0 + c * cell, y + r * cell, cell + 0.25, cell + 0.25);
      }
    }
  }
}

export function renderQr(
  data: QrToolData,
  _t: Translator,
  _lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const text = data.text.trim();
  if (!text) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const caption = data.caption.trim();
  const qrSize = caption ? 232 : 296;
  const capLines = caption ? textLines(caption, F.body(13), TOOL_WIDTH - 2 * TOOL_MARGIN_X) : [];
  // Масштабируется только подпись (текст): сам QR-код — не типографика
  const capPad = Math.round(10 * s);
  const capAdv = Math.round(18 * s);

  const pieces: ToolPiece[] = [
    { height: 20, draw: () => {} },
    {
      height: qrSize,
      draw: (ctx, _x, y, w) => drawQrMatrix(ctx, text, data.level, w / 2, y, qrSize),
    },
  ];
  if (caption) {
    pieces.push({
      height: capPad + capLines.length * capAdv,
      draw: (ctx, _x, y, w) => {
        ctx.font = F.body(13);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        capLines.forEach((line, i) => ctx.fillText(line, w / 2, y + capPad + i * capAdv));
      },
    });
  }
  pieces.push({ height: 18, draw: () => {} });
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 2. Wi-Fi этикетка                                                   */
/* ------------------------------------------------------------------ */

export function renderWifi(
  data: WifiToolData,
  t: Translator,
  lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const ssid = data.ssid.trim();
  if (!ssid) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const pass = data.enc === "nopass" ? "" : data.password;
  const payload = wifiPayload({ ssid, password: pass, enc: data.enc, hidden: data.hidden });
  const ssidLines = textLines(ssid, F.title(18), TOOL_WIDTH - 2 * TOOL_MARGIN_X - 40);
  const passLine = pass ? pass : t("tool.wifi.noPassShort");
  const qrSize = 176;
  // Текстовые строки масштабируются, QR остаётся базовым
  const labelH = Math.round(26 * s); // строка «Wi-Fi» с отступом (шрифт 17)
  const ssidAdv = Math.round(22 * s); // строки SSID (шрифт 18)
  const passH = Math.round(22 * s); // строка пароля (шрифт 14)

  const pieces: ToolPiece[] = [
    { height: 14, draw: () => {} },
    {
      height: labelH + ssidLines.length * ssidAdv + passH + qrSize + 18,
      draw: (ctx, _x, y, w) => {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = TOOL_INK;
        ctx.font = F.title(17);
        ctx.fillText(t("tool.wifi.label"), w / 2, y + 2);
        ctx.font = F.title(18);
        ssidLines.forEach((line, i) => ctx.fillText(line, w / 2, y + labelH + i * ssidAdv));
        ctx.font = F.body(14);
        ctx.fillText(
          data.enc === "nopass" ? t("tool.wifi.open") : `${t("tool.wifi.password")}: ${passLine}`,
          w / 2,
          y + labelH + ssidLines.length * ssidAdv
        );
        drawQrMatrix(ctx, payload, "M", w / 2, y + labelH + ssidLines.length * ssidAdv + passH, qrSize);
      },
    },
    { height: 16, draw: () => {} },
  ];
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 3. Чек-лист                                                         */
/* ------------------------------------------------------------------ */

export function renderChecklist(
  data: ChecklistToolData,
  _t: Translator,
  _lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const items = data.items.filter((it) => it.text.trim());
  if (!data.title.trim() && !items.length) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const pieces: ToolPiece[] = [];

  if (data.title.trim()) {
    const lines = textLines(data.title.trim(), F.title(18), TOOL_WIDTH - 2 * TOOL_MARGIN_X);
    const titleAdv = Math.round(24 * s);
    pieces.push({
      height: Math.round(10 * s) + lines.length * titleAdv + Math.round(6 * s),
      draw: (ctx, _x, y, w) => {
        ctx.font = F.title(18);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        lines.forEach((line, i) => ctx.fillText(line, TOOL_MARGIN_X, y + Math.round(10 * s) + i * titleAdv));
      },
    });
  } else {
    pieces.push({ height: 8, draw: () => {} });
  }

  for (const item of items) {
    const lines = textLines(item.text.trim(), F.body(14), TOOL_WIDTH - 36 - TOOL_MARGIN_X);
    const itemAdv = Math.round(18 * s);
    // Чекбокс растёт вместе с кеглем строки, чтобы пропорция сохранялась
    const box = Math.round(13 * s);
    pieces.push({
      height: Math.round(7 * s) + lines.length * itemAdv,
      draw: (ctx, _x, y, w) => {
        drawCheckbox(ctx, TOOL_MARGIN_X, y + Math.round(8 * s), box, item.done);
        ctx.font = F.body(14);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        lines.forEach((line, i) =>
          ctx.fillText(line, TOOL_MARGIN_X + Math.round(22 * s), y + Math.round(9 * s) + i * itemAdv)
        );
        void w;
      },
    });
  }
  pieces.push({ height: 8, draw: () => {} });
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 4. Чек                                                              */
/* ------------------------------------------------------------------ */

const R_DOT_Y = 12; // базовая линия точки-лидера во второй строке позиции

export function renderReceipt(
  data: ReceiptToolData,
  t: Translator,
  lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const items = data.items
    .filter((it) => it.name.trim() || it.price > 0)
    .map((it) => ({ ...it, name: it.name.trim(), qty: Math.max(1, Math.floor(it.qty || 1)) }));
  if (!data.shop.trim() && !items.length) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const totals = receiptTotals(items, data.discount);
  const W = TOOL_WIDTH;
  const left = TOOL_MARGIN_X;
  const right = W - TOOL_MARGIN_X;
  const pieces: ToolPiece[] = [];

  // Шапка: магазин + дата/время
  const shopLines = data.shop.trim() ? textLines(data.shop.trim(), F.title(18), W - 2 * TOOL_MARGIN_X) : [];
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const dateLine = data.showDate ? `${formatDateHuman(todayISO(), lang)} ${hh}:${mm}` : "";
  const headPad = Math.round(8 * s);
  const shopAdv = Math.round(23 * s);
  const dateH = dateLine ? Math.round(16 * s) : 0;
  pieces.push({
    height: headPad + shopLines.length * shopAdv + dateH + 4,
    draw: (ctx, _x, y, w) => {
      ctx.textBaseline = "top";
      ctx.font = F.title(18);
      ctx.textAlign = "center";
      shopLines.forEach((line, i) => ctx.fillText(line, w / 2, y + headPad + i * shopAdv));
      if (dateLine) {
        ctx.font = F.mono(12);
        ctx.fillText(dateLine, w / 2, y + headPad + shopLines.length * shopAdv);
      }
    },
  });
  pieces.push({ height: 10, draw: (ctx, _x, y, w) => drawDashedLine(ctx, y + 5, left, right) });

  // Позиции
  const nameAdv = Math.round(16 * s);
  const sumRow = Math.round(16 * s);
  for (const it of items) {
    const nameLines = it.name ? textLines(it.name, F.mono(13), W - 2 * TOOL_MARGIN_X) : [];
    const sum = formatMoney(it.price * it.qty);
    pieces.push({
      height: 2 + nameLines.length * nameAdv + sumRow + 4,
      draw: (ctx, _x, y, w) => {
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.font = F.mono(13);
        nameLines.forEach((line, i) => ctx.fillText(line, left, y + 2 + i * nameAdv));
        const y2 = y + 2 + nameLines.length * nameAdv;
        const qtyPrice = `${it.qty} × ${formatMoney(it.price)}`;
        ctx.fillText(qtyPrice, left, y2);
        const sumW = ctx.measureText(sum).width;
        ctx.fillText(sum, right - sumW, y2);
        // точки-лидер между «кол-во × цена» и суммой
        const lEnd = left + ctx.measureText(qtyPrice).width + 8;
        const rStart = right - sumW - 8;
        if (rStart > lEnd) drawDottedLeader(ctx, y2 + Math.round(R_DOT_Y * s), lEnd, rStart);
      },
    });
  }
  pieces.push({ height: 10, draw: (ctx, _x, y, w) => drawDashedLine(ctx, y + 5, left, right) });

  // Итоги
  const totalLabel = `${t("tool.receipt.total")}:`;
  const discountLine =
    data.discount > 0 ? `${t("tool.receipt.discountLine", { pct: data.discount })}: -${formatMoney(totals.discountValue)}` : "";
  const subH = Math.round(20 * s);
  const discH = discountLine ? Math.round(17 * s) : 0;
  const totH = Math.round(24 * s);
  pieces.push({
    height: subH + discH + totH + 6,
    draw: (ctx, _x, y, w) => {
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      ctx.font = F.mono(13);
      ctx.fillText(`${t("tool.receipt.subtotal")}: ${formatMoney(totals.subtotal)}`, w - TOOL_MARGIN_X, y + 2);
      if (discountLine) ctx.fillText(discountLine, w - TOOL_MARGIN_X, y + Math.round(19 * s));
      ctx.font = F.monoBold(16);
      ctx.fillText(
        `${totalLabel} ${formatMoney(totals.total)}`,
        w - TOOL_MARGIN_X,
        y + subH + discH + 2
      );
    },
  });

  // Подпись в конце
  const footer = data.footer.trim();
  if (footer) {
    const lines = textLines(footer, F.body(12), W - 2 * TOOL_MARGIN_X);
    const footPad = Math.round(4 * s);
    const footAdv = Math.round(16 * s);
    pieces.push({
      height: footPad + lines.length * footAdv + 10,
      draw: (ctx, _x, y, w) => {
        ctx.font = F.body(12);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        lines.forEach((line, i) => ctx.fillText(line, w / 2, y + footPad + i * footAdv));
      },
    });
  } else {
    pieces.push({ height: 10, draw: () => {} });
  }
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 5. Этикетка «изготовлено / годно до»                                */
/* ------------------------------------------------------------------ */

export function renderDates(
  data: DatesToolData,
  t: Translator,
  lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const name = data.name.trim();
  const made = data.made;
  if (!name && !data.showMade && !data.showUntil) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const until = addDuration(made, data.amount, data.unit);
  const nameLines = name ? textLines(name, F.title(20), TOOL_WIDTH - 2 * TOOL_MARGIN_X - 16) : [];
  const bodyLines: { text: string; bold: boolean }[] = [];
  if (data.showMade) bodyLines.push({ text: `${t("tool.dates.made")}: ${formatDateHuman(made, lang)}`, bold: false });
  if (data.showUntil)
    bodyLines.push({ text: `${t("tool.dates.until")}: ${formatDateHuman(until, lang)}`, bold: true });
  if (!nameLines.length && !bodyLines.length) return null;

  const nameAdv = Math.round(26 * s);
  const bodyAdv = Math.round(21 * s);
  const gap = nameLines.length && bodyLines.length ? Math.round(8 * s) : 0;
  const pad = data.border ? 14 : 0;
  const innerH = nameLines.length * nameAdv + gap + bodyLines.length * bodyAdv;
  const height = innerH + (pad ? 10 : 12);

  const pieces: ToolPiece[] = [
    {
      height,
      draw: (ctx, x, y, w) => {
        if (data.border) drawRoundedFrame(ctx, x + 3, y + 3, w - 6, height - 6, 10, 1.5);
        ctx.textBaseline = "top";
        ctx.font = F.title(20);
        ctx.textAlign = "center";
        nameLines.forEach((line, i) => ctx.fillText(line, w / 2, y + pad + i * nameAdv));
        bodyLines.forEach((l, i) => {
          ctx.font = l.bold ? F.title(15) : F.body(15);
          ctx.fillText(l.text, w / 2, y + pad + nameLines.length * nameAdv + gap + i * bodyAdv);
        });
      },
    },
    { height: 8, draw: () => {} },
  ];
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 9. Замена (этикетка обслуживания)                                   */
/* ------------------------------------------------------------------ */

/**
 * Этикетка обслуживания: «Заменено: дата» + автоматически посчитанная
 * «Следующая: дата» (конец месяца зажимается — та же математика, что у
 * сроков годности). Наклейка на устройство: фильтры, картриджи, вода и т.п.
 */
export function renderReplacement(
  data: ReplacementToolData,
  t: Translator,
  lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const name = data.name.trim();
  const next = addDuration(data.date, data.amount, data.unit);
  const F = makeFonts(typo);
  const s = F.s;
  const nameLines = name ? textLines(name, F.title(20), TOOL_WIDTH - 2 * TOOL_MARGIN_X - 16) : [];
  const bodyLines: { text: string; bold: boolean }[] = [
    { text: `${t("tool.replace.replaced")}: ${formatDateHuman(data.date, lang)}`, bold: false },
  ];
  if (data.showNext) {
    bodyLines.push({ text: `${t("tool.replace.next")}: ${formatDateHuman(next, lang)}`, bold: true });
  }

  const nameAdv = Math.round(26 * s);
  const bodyAdv = Math.round(21 * s);
  const gap = nameLines.length ? Math.round(8 * s) : 0;
  const pad = data.border ? 14 : 0;
  const innerH = nameLines.length * nameAdv + gap + bodyLines.length * bodyAdv;
  const height = innerH + (pad ? 10 : 12);

  const pieces: ToolPiece[] = [
    {
      height,
      draw: (ctx, x, y, w) => {
        if (data.border) drawRoundedFrame(ctx, x + 3, y + 3, w - 6, height - 6, 10, 1.5);
        ctx.textBaseline = "top";
        ctx.font = F.title(20);
        ctx.textAlign = "center";
        nameLines.forEach((line, i) => ctx.fillText(line, w / 2, y + pad + i * nameAdv));
        bodyLines.forEach((l, i) => {
          ctx.font = l.bold ? F.title(15) : F.body(15);
          ctx.fillText(l.text, w / 2, y + pad + nameLines.length * nameAdv + gap + i * bodyAdv);
        });
      },
    },
    { height: 8, draw: () => {} },
  ];
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 6. Нумерация / инвентаризация                                       */
/* ------------------------------------------------------------------ */

export function renderNumbers(
  data: NumbersToolData,
  _t: Translator,
  _lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const labels = numberSeriesSafe(data);
  if (!labels.length) return null;
  const F = makeFonts(typo);
  const s = F.s;
  // Строка номера масштабируется, штрихкод под ней остаётся базовым
  const labelH = Math.round(34 * s);
  const pieces: ToolPiece[] = [];
  for (const label of labels) {
    const barcodeCanvas =
      data.barcode && isBarcodeSafe(label) ? renderBarcodeCanvas(label, { modulePx: 2, maxWidth: 348 }) : null;
    pieces.push({
      height: labelH + (barcodeCanvas ? 72 : 0) + 8,
      draw: (ctx, _x, y, w) => {
        ctx.font = F.title(24);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(label, w / 2, y + 2);
        if (barcodeCanvas) {
          ctx.drawImage(barcodeCanvas, Math.round((w - barcodeCanvas.width) / 2), y + labelH);
        }
      },
    });
  }
  pieces.push({ height: 6, draw: () => {} });
  return composeToolCanvas(pieces);
}

function numberSeriesSafe(data: NumbersToolData): string[] {
  return numberSeries({
    prefix: data.prefix,
    postfix: data.postfix,
    start: data.start,
    count: data.count,
    pad: data.pad,
  });
}

/* ------------------------------------------------------------------ */
/* 7. Календарь месяца                                                 */
/* ------------------------------------------------------------------ */

const CAL_CELL_H = 42;

export function renderCalendar(
  data: CalendarToolData,
  _t: Translator,
  lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const weeks = calendarGrid({ year: data.year, month: data.month, weekStart: data.weekStart });
  if (!weeks.length) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const labels = weekdayLabels(data.weekStart, lang);
  // Шапка (месяц + дни недели) и высота клеток масштабируются;
  // ширина клеток фиксирована шириной ленты
  const titleH = Math.round(26 * s);
  const weekH = Math.round(18 * s);
  const gridTop = Math.round(10 * s) + titleH + weekH;
  const cellH = Math.round(CAL_CELL_H * s);
  const gridH = weeks.length * cellH;
  const height = gridTop + gridH + 12;
  const cellW = (TOOL_WIDTH - 2 * TOOL_MARGIN_X) / 7;
  const dayH = Math.round(15 * s);

  // индексы выходных колонок (сб, вс) с учётом weekStart
  const weekendCols = new Set<number>();
  for (let c = 0; c < 7; c++) {
    const dow = (data.weekStart + c) % 7; // 0 — вс
    if (dow === 0 || dow === 6) weekendCols.add(c);
  }

  const pieces: ToolPiece[] = [
    {
      height,
      draw: (ctx, _x, y, w) => {
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.font = F.title(17);
        ctx.fillText(monthTitle(data.year, data.month, lang), w / 2, y + Math.round(8 * s));

        ctx.font = F.body(11);
        labels.forEach((label, c) => {
          const cx = TOOL_MARGIN_X + c * cellW + cellW / 2;
          ctx.fillText(label, cx, y + Math.round(10 * s) + titleH);
        });

        // сетка
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = TOOL_INK;
        const gy = y + gridTop;
        for (let r = 0; r <= weeks.length; r++) {
          ctx.beginPath();
          ctx.moveTo(TOOL_MARGIN_X, gy + r * cellH);
          ctx.lineTo(w - TOOL_MARGIN_X, gy + r * cellH);
          ctx.stroke();
        }
        for (let c = 0; c <= 7; c++) {
          const cx = TOOL_MARGIN_X + c * cellW;
          ctx.beginPath();
          ctx.moveTo(cx, gy);
          ctx.lineTo(cx, gy + gridH);
          ctx.stroke();
        }
        ctx.restore();

        // числа
        weeks.forEach((week, r) => {
          week.forEach((day, c) => {
            if (day === null) return;
            const bold = data.weekends && weekendCols.has(c);
            ctx.font = bold ? F.title(15) : F.body(15);
            ctx.fillText(
              String(day),
              TOOL_MARGIN_X + c * cellW + cellW / 2,
              gy + r * cellH + (cellH - dayH) / 2
            );
          });
        });
      },
    },
  ];
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 8. Трекер привычек                                                  */
/* ------------------------------------------------------------------ */

const HAB_ROW_H = 20;
const HAB_DAY_COL = 26;

export function renderHabits(
  data: HabitsToolData,
  _t: Translator,
  lang: Lang,
  typo?: ToolTypo
): ToolComposeResult | null {
  const habits = data.habits.map((h) => h.trim()).filter(Boolean).slice(0, MAX_HABITS);
  if (!habits.length) return null;
  const F = makeFonts(typo);
  const s = F.s;
  const days = daysInMonth(data.year, data.month);
  const colW = (TOOL_WIDTH - 2 * TOOL_MARGIN_X - HAB_DAY_COL) / habits.length;
  // Шапка, строки дней и клеточки масштабируются вместе с кеглем
  const gridTop = Math.round(10 * s) + Math.round(22 * s) + Math.round(4 * s);
  const headerH = Math.round(34 * s);
  const rowH = Math.round(HAB_ROW_H * s);
  const nameAdv = Math.round(11 * s);
  const box = Math.round(13 * s);
  const dayH = Math.round(11 * s);
  const height = gridTop + headerH + days * rowH + 10;

  const pieces: ToolPiece[] = [
    {
      height,
      draw: (ctx, _x, y, w) => {
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.font = F.title(16);
        ctx.fillText(monthTitle(data.year, data.month, lang), w / 2, y + Math.round(8 * s));

        // шапка: имена привычек
        ctx.font = F.body(10);
        habits.forEach((name, i) => {
          const cx = TOOL_MARGIN_X + HAB_DAY_COL + i * colW + colW / 2;
          const lines = wrapTextLines(ctx, name, colW - 4).slice(0, 2);
          lines.forEach((line, li) =>
            ctx.fillText(line, cx, y + gridTop + Math.round(2 * s) + li * nameAdv)
          );
        });

        // строки дней
        const gy = y + gridTop + headerH;
        ctx.font = F.body(11);
        ctx.textAlign = "right";
        for (let d = 1; d <= days; d++) {
          const ry = gy + (d - 1) * rowH;
          ctx.fillText(String(d), TOOL_MARGIN_X + HAB_DAY_COL - 6, ry + (rowH - dayH) / 2);
        }
        ctx.textAlign = "center";

        // клеточки
        for (let d = 1; d <= days; d++) {
          const ry = gy + (d - 1) * rowH;
          habits.forEach((_h, i) => {
            const bx = TOOL_MARGIN_X + HAB_DAY_COL + i * colW + (colW - box) / 2;
            drawCheckbox(ctx, bx, ry + (rowH - box) / 2, box, false);
          });
        }
        // линия под последним днём
        ctx.save();
        ctx.strokeStyle = TOOL_INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(TOOL_MARGIN_X, gy + days * rowH);
        ctx.lineTo(w - TOOL_MARGIN_X, gy + days * rowH);
        ctx.stroke();
        ctx.restore();
      },
    },
  ];
  return composeToolCanvas(pieces);
}

/* ------------------------------------------------------------------ */
/* 9. Тестовая страница принтера                                       */
/* ------------------------------------------------------------------ */

/**
 * Диагностическая страница: клинья разрешения (шахматки и линии),
 * лестница шрифтов, толщины линий и миллиметровая шкала.
 * Языконезависима — только символы и цифры.
 */
export function renderTestPage(): ToolComposeResult {
  const W = TOOL_WIDTH;
  const pad = 12;
  const rulerW = W - 2 * pad - 8;
  const fonts = [10, 12, 14, 16, 20, 26];
  const fontsH = fonts.reduce((s, px) => s + Math.ceil(px * 1.35) + 4, 0);
  const blocksH = 46;
  const height = 12 + 22 + 6 + 30 + 8 + blocksH + 16 + fontsH + 10 + 4 * 12 + 12;

  const pieces: ToolPiece[] = [
    {
      height,
      draw: (ctx, x, y, w) => {
        ctx.textBaseline = "top";
        ctx.fillStyle = TOOL_INK;
        ctx.strokeStyle = TOOL_INK;

        // заголовок
        ctx.font = F_TITLE(16);
        ctx.textAlign = "center";
        ctx.fillText("MXW01 · TEST", w / 2, y + 12);

        // миллиметровая шкала
        const ry = y + 12 + 22 + 6;
        ctx.font = F_BODY(8);
        ctx.textAlign = "center";
        ctx.save();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + pad, ry);
        ctx.lineTo(x + pad + rulerW, ry);
        ctx.stroke();
        for (let mm = 0; mm * PX_PER_MM <= rulerW; mm++) {
          const tx = x + pad + mm * PX_PER_MM;
          const tickH = mm % 5 === 0 ? 9 : 5;
          ctx.beginPath();
          ctx.moveTo(tx, ry);
          ctx.lineTo(tx, ry + tickH);
          ctx.stroke();
          if (mm % 5 === 0 && mm > 0) ctx.fillText(String(mm), tx, ry + tickH + 1);
        }
        ctx.restore();

        // клинья разрешения
        const by = ry + 30;
        const bw = (w - 2 * pad - 5 * 8) / 6;
        const patterns: ((bx: number, bby: number, bw2: number, bh: number) => void)[] = [
          (bx, bby, bw2, bh) => {
            ctx.fillRect(bx, bby, bw2, bh);
          }, // сплошной
          (bx, bby, bw2, bh) => checker(ctx, bx, bby, bw2, bh, 1),
          (bx, bby, bw2, bh) => checker(ctx, bx, bby, bw2, bh, 2),
          (bx, bby, bw2, bh) => lines(ctx, bx, bby, bw2, bh, "h", 1),
          (bx, bby, bw2, bh) => lines(ctx, bx, bby, bw2, bh, "v", 1),
          (bx, bby, bw2, bh) => checker(ctx, bx, bby, bw2, bh, 3),
        ];
        patterns.forEach((p, i) => {
          const bx = x + pad + i * (bw + 8);
          p(bx, by, bw, 34);
          ctx.font = F_BODY(8);
          ctx.textAlign = "center";
          const labels = ["100%", "1px", "2px", "H1", "V1", "3px"];
          ctx.fillText(labels[i], bx + bw / 2, by + 36);
        });

        // лестница шрифтов
        let fy = by + blocksH;
        for (const px of fonts) {
          ctx.font = F_BODY(px);
          ctx.textAlign = "left";
          ctx.fillText(`Тест Test 0123 — ${px}px`, x + pad, fy);
          fy += Math.ceil(px * 1.35) + 4;
        }

        // толщины линий
        fy += 4;
        for (let lw = 1; lw <= 4; lw++) {
          ctx.save();
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(x + pad, fy + lw);
          ctx.lineTo(x + w - pad, fy + lw);
          ctx.stroke();
          ctx.restore();
          fy += 12;
        }

        // рамка
        drawRoundedFrame(ctx, x + 2, y + 2, w - 4, height - 4, 8, 1);
      },
    },
  ];
  return composeToolCanvas(pieces);
}

/** Шахматка с шагом step px (логические) */
function checker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number
): void {
  for (let ry = 0; ry < h; ry += step) {
    for (let rx = 0; rx < w; rx += step) {
      if (((rx / step) | 0) % 2 === ((ry / step) | 0) % 2) {
        ctx.fillRect(x + rx, y + ry, Math.min(step, w - rx), Math.min(step, h - ry));
      }
    }
  }
}

/** Полосы: горизонтальные или вертикальные, шаг step px */
function lines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dir: "h" | "v",
  step: number
): void {
  if (dir === "h") {
    for (let ry = 0; ry < h; ry += step * 2) ctx.fillRect(x, y + ry, w, step);
  } else {
    for (let rx = 0; rx < w; rx += step * 2) ctx.fillRect(x + rx, y, step, h);
  }
}
