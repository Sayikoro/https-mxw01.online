/**
 * ============================================================================
 *  ШТРИХКОДЫ: EAN-13 и Code-128 — слой приложения, драйвер не затрагивается.
 * ============================================================================
 *  • Чистые энкодеры (без DOM) — тестируются в bun;
 *  • renderBarcodeCanvas() рисует штрихкод в ОТДЕЛЬНЫЙ холст с целочисленными
 *    штрихами и жёсткой бинаризацией подписи — холст затем кладётся на ценник
 *    1:1, штрихи остаются идеально чёткими (никакой передискретизации).
 *
 *  Авто-определение типа:
 *    • 12 цифр          → EAN-13 (контрольная цифра добавится сама);
 *    • 13 цифр (верная контрольная сумма) → EAN-13;
 *    • прочее (до 48 печатных ASCII, включая 13 цифр с неверной суммой)
 *                       → Code-128.
 * ============================================================================
 */

import { binarizeCanvas } from "./canvas-quality";

export type BarcodeKind = "ean13" | "code128";

export interface BarcodePlan {
  kind: BarcodeKind;
  /** Ширины штрих/пробел в модулях, начиная со штриха (чёрного) */
  runs: number[];
  /** Всего модулей (сумма runs) */
  modules: number;
  /** Код, который будет напечатан подписью */
  text: string;
}

/* ------------------------------------------------------------------ */
/* EAN-13                                                              */
/* ------------------------------------------------------------------ */

const EAN_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const EAN_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const EAN_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
/** Чётность левой половины по первой цифре (L = нечётная, G = чётная) */
const EAN_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

/** Контрольная цифра EAN-13 по первым 12 цифрам */
export function ean13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Нормализовать код до 13 цифр: 12 цифр → добавить контрольную;
 * 13 цифр → проверить контрольную (неверная → null).
 */
export function normalizeEan13(text: string): string | null {
  const t = text.trim();
  if (!/^\d{12,13}$/.test(t)) return null;
  if (t.length === 12) return t + String(ean13CheckDigit(t));
  return ean13CheckDigit(t.slice(0, 12)) === Number(t[12]) ? t : null;
}

/**
 * 95 модулей EAN-13 строкой «1»/«0» (без тихих зон):
 * 101 + 6 цифр (L/G по чётности) + 01010 + 6 цифр (R) + 101.
 */
export function ean13Modules(text: string): string | null {
  const d = normalizeEan13(text);
  if (!d) return null;
  const parity = EAN_PARITY[Number(d[0])];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const digit = Number(d[1 + i]);
    bits += parity[i] === "L" ? EAN_L[digit] : EAN_G[digit];
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) {
    bits += EAN_R[Number(d[7 + i])];
  }
  bits += "101";
  return bits;
}

/* ------------------------------------------------------------------ */
/* Code-128 (кодовое множество B)                                      */
/* ------------------------------------------------------------------ */

/**
 * Таблица 107 паттернов Code 128: каждый паттерн — 6 ширин (штрих, пробел,
 * …), стоп-паттерн — 7 ширин (заканчивается штрихом).
 */
const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

export const CODE128_MAX_LEN = 48;

/** Значения символов Code-128 B: start B + данные + контрольная сумма */
export function code128Values(text: string): number[] | null {
  const t = text.trim();
  if (!t.length || t.length > CODE128_MAX_LEN) return null;
  if (!/^[\x20-\x7e]+$/.test(t)) return null;
  const vals: number[] = [CODE128_START_B];
  for (const ch of t) vals.push(ch.charCodeAt(0) - 32);
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103);
  return vals;
}

/** Чередующиеся ширины штрих/пробел в модулях */
export function code128Runs(text: string): { runs: number[]; modules: number } | null {
  const vals = code128Values(text);
  if (!vals) return null;
  const runs: number[] = [];
  let modules = 0;
  for (const v of [...vals, CODE128_STOP]) {
    const pat = CODE128_PATTERNS[v];
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]);
      runs.push(w);
      modules += w;
    }
  }
  return { runs, modules };
}

/* ------------------------------------------------------------------ */
/* Авто-определение и план                                             */
/* ------------------------------------------------------------------ */

export function detectBarcodeKind(text: string): BarcodeKind | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{12}$/.test(t)) return "ean13";
  if (/^\d{13}$/.test(t) && normalizeEan13(t)) return "ean13";
  if (t.length <= CODE128_MAX_LEN && /^[\x20-\x7e]+$/.test(t)) return "code128";
  return null;
}

/** План штрихкода (чистая функция) или null, если код не распознан */
export function planBarcode(raw: string): BarcodePlan | null {
  const t = raw.trim();
  if (!t) return null;
  const kind = detectBarcodeKind(t);
  if (kind === "ean13") {
    const bits = ean13Modules(t);
    if (!bits) return null;
    const runs: number[] = [];
    let cur = bits[0];
    let len = 0;
    for (const b of bits) {
      if (b === cur) {
        len++;
      } else {
        runs.push(len);
        cur = b;
        len = 1;
      }
    }
    runs.push(len);
    return { kind, runs, modules: bits.length, text: normalizeEan13(t)! };
  }
  if (kind === "code128") {
    const r = code128Runs(t);
    if (!r) return null;
    return { kind, runs: r.runs, modules: r.modules, text: t.trim() };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Отрисовка (DOM)                                                     */
/* ------------------------------------------------------------------ */

/** Высота штрихов, px на печати */
export const BARCODE_BAR_HEIGHT = 52;
/** Высота подписи цифрами, px */
export const BARCODE_TEXT_HEIGHT = 14;
/** px на модуль (штрих минимальной ширины) */
export const BARCODE_MODULE_PX = 2;

/**
 * Отрисовать штрихкод в отдельный бинарный холст (чёрные штрихи на белом,
 * тихая зона 2 модуля с каждой стороны, подпись кода снизу).
 * Возвращает null, если код не распознан.
 */
export function renderBarcodeCanvas(
  raw: string,
  opts?: { modulePx?: number; maxWidth?: number }
): HTMLCanvasElement | null {
  const plan = planBarcode(raw);
  if (!plan) return null;

  const maxWidth = opts?.maxWidth ?? 384;
  let modulePx = Math.max(1, Math.round(opts?.modulePx ?? BARCODE_MODULE_PX));
  // Вписать в maxWidth: модуль не мельче 1 px
  if ((plan.modules + 4) * modulePx > maxWidth) {
    modulePx = Math.max(1, Math.floor(maxWidth / (plan.modules + 4)));
  }

  const quiet = 2 * modulePx;
  const w = (plan.modules + 4) * modulePx;
  const h = BARCODE_BAR_HEIGHT + BARCODE_TEXT_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000000";
  let x = quiet;
  let isBar = true;
  for (const run of plan.runs) {
    if (isBar) ctx.fillRect(x, 0, run * modulePx, BARCODE_BAR_HEIGHT);
    x += run * modulePx;
    isBar = !isBar;
  }

  // Подпись кода снизу
  ctx.font = `400 ${BARCODE_TEXT_HEIGHT - 3}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(plan.text, Math.round(w / 2), BARCODE_BAR_HEIGHT + 2);

  // Жёсткая бинаризация (подпись fillText даёт серые края — убираем их)
  binarizeCanvas(canvas);
  return canvas;
}
