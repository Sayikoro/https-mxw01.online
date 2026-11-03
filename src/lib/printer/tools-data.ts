/**
 * Чистая математика инструментов вкладки «Инструменты» — без DOM и React.
 * Всё, что можно проверить юнит-тестами: Wi-Fi payload, арифметика сроков
 * годности, серии номеров, сетка календаря, итоги чека, форматирование.
 * (Рисование — в tools-canvas.ts, UI — в components/printer/tools/.)
 * - покрытие: scripts/test-tools.ts -
 */
import type { Lang } from "./i18n";

/* ------------------------------------------------------------------ */
/* Wi-Fi этикетка                                                      */
/* ------------------------------------------------------------------ */

export type WifiEnc = "wpa" | "wep" | "nopass";

export interface WifiData {
  ssid: string;
  password: string;
  enc: WifiEnc;
  hidden: boolean;
}

/**
 * Экранирование спецсимволов стандарта Wi-Fi QR (\ ; , : ") —
 * каждый из них в значении предваряется обратным слешем.
 */
export function escapeWifiSegment(s: string): string {
  return s.replace(/([\\;,:"])/g, "\\$1");
}

/** Строка подключения Wi-Fi: WiFi:T:WPA;S:имя;P:пароль;H:true;; */
export function wifiPayload(d: WifiData): string {
  const ssid = escapeWifiSegment(d.ssid.trim());
  // Конвенция формата WIFI:: T:WPA/T:WEP в верхнем регистре, T:nopass — в нижнем
  const enc = d.enc === "nopass" ? "nopass" : d.enc.toUpperCase();
  const parts: string[] = [`T:${enc}`, `S:${ssid}`];
  if (d.enc !== "nopass") parts.push(`P:${escapeWifiSegment(d.password)}`);
  if (d.hidden) parts.push("H:true");
  return `WiFi:${parts.join(";")};;`;
}

/* ------------------------------------------------------------------ */
/* Сроки годности                                                      */
/* ------------------------------------------------------------------ */

export type DurationUnit = "day" | "month" | "year";

/** Локальная дата в формате YYYY-MM-DD (input type="date" локален) */
export function todayISO(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

function isoParts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/**
 * Прибавить срок к дате. Конец месяца зажимается: 31.01 + 1 месяц = 28.02
 * (29.02 в високосный год). Возвращает YYYY-MM-DD или исходную строку,
 * если она не распознана.
 */
export function addDuration(iso: string, amount: number, unit: DurationUnit): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  const [y, mo, d] = parts;
  const dt = new Date(Date.UTC(y, mo - 1, 1));
  if (unit === "day") {
    dt.setUTCDate(d + amount);
  } else {
    const step = unit === "month" ? amount : amount * 12;
    const targetMonthStart = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + step, 1));
    const lastDay = new Date(
      Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)
    ).getUTCDate();
    dt.setUTCFullYear(targetMonthStart.getUTCFullYear());
    dt.setUTCMonth(targetMonthStart.getUTCMonth());
    dt.setUTCDate(Math.min(d, lastDay));
  }
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Дата в человеческом виде: ru — 14.03.2027, en — 14 Mar 2027 */
export function formatDateHuman(iso: string, lang: Lang): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  const [y, mo, d] = parts;
  if (lang === "en") {
    return new Date(Date.UTC(y, mo - 1, d))
      .toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d)}.${p(mo)}.${y}`;
}

/* ------------------------------------------------------------------ */
/* Нумерация / инвентаризация                                          */
/* ------------------------------------------------------------------ */

export interface SeriesParams {
  prefix: string;
  postfix: string;
  start: number;
  count: number;
  /** Сколько цифр в номере (дополнение нулями слева) */
  pad: number;
}

export const SERIES_MAX = 200;
export const SERIES_PAD_MAX = 12;

export function numberSeries(p: SeriesParams): string[] {
  const start = Math.max(0, Math.floor(p.start) || 0);
  const count = Math.min(SERIES_MAX, Math.max(1, Math.floor(p.count) || 1));
  const pad = Math.min(SERIES_PAD_MAX, Math.max(0, Math.floor(p.pad) || 0));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = String(start + i).padStart(pad, "0");
    out.push(`${p.prefix}${n}${p.postfix}`);
  }
  return out;
}

/** Code-128 (подмножество B): видимые ASCII, максимум 48 символов */
export function isBarcodeSafe(s: string): boolean {
  return /^[\x20-\x7E]{1,48}$/.test(s);
}

/* ------------------------------------------------------------------ */
/* Календарь и трекер привычек                                         */
/* ------------------------------------------------------------------ */

export interface CalendarParams {
  year: number;
  /** 1–12 */
  month: number;
  /** 0 — с воскресенья, 1 — с понедельника */
  weekStart: 0 | 1;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Сетка недель: 7 ячеек в каждой (число дня или null — пустая) */
export function calendarGrid(p: CalendarParams): (number | null)[][] {
  const days = daysInMonth(p.year, p.month);
  const firstDow = new Date(p.year, p.month - 1, 1).getDay();
  const shift = (firstDow - p.weekStart + 7) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < shift; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** «Сентябрь 2026» / «September 2026» (без « г.» у ru-локали) */
export function monthTitle(year: number, month: number, lang: Lang): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const monthName = new Date(year, month - 1, 1)
    .toLocaleDateString(locale, { month: "long" });
  const s = `${monthName} ${year}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Короткие подписи дней недели, начиная с weekStart: ПН ВТ … ВС / MO TU … SU */
export function weekdayLabels(weekStart: 0 | 1, lang: Lang): string[] {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const take = lang === "ru" ? 2 : 3;
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    // 2023-01-02 — понедельник
    const d = new Date(2023, 0, 2 + i);
    out.push(d.toLocaleDateString(locale, { weekday: "short" }).slice(0, take).toUpperCase());
  }
  if (weekStart === 0) out.unshift(out.pop() as string);
  return out;
}

/* ------------------------------------------------------------------ */
/* Чек                                                                 */
/* ------------------------------------------------------------------ */

export interface ReceiptItem {
  name: string;
  price: number;
  qty: number;
}

export interface ReceiptTotals {
  subtotal: number;
  discountValue: number;
  total: number;
}

export const DISCOUNT_MAX = 90;

/** Подытог/скидка/итог; дробное количество отбрасывается вниз до целого */
export function receiptTotals(items: ReceiptItem[], discountPercent: number): ReceiptTotals {
  let subtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.floor(it.qty || 1));
    const price = Number.isFinite(it.price) ? Math.max(0, it.price) : 0;
    subtotal += price * qty;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const pct = Math.min(DISCOUNT_MAX, Math.max(0, Number.isFinite(discountPercent) ? discountPercent : 0));
  const discountValue = Math.round(subtotal * pct) / 100;
  const total = Math.round((subtotal - discountValue) * 100) / 100;
  return { subtotal, discountValue, total };
}

/** Деньги в две decimal-позиции: 247.95 */
export function formatMoney(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2);
}
