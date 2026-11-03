/**
 * Юнит-тесты чистых функций инструментов: scripts/test-tools.ts
 * Запуск: bun scripts/test-tools.ts
 * Проверяет: tools-data.ts (Wi-Fi payload, сроки, серии, календарь, чек).
 */
import {
  escapeWifiSegment,
  wifiPayload,
  addDuration,
  formatDateHuman,
  numberSeries,
  SERIES_MAX,
  isBarcodeSafe,
  calendarGrid,
  daysInMonth,
  monthTitle,
  weekdayLabels,
  receiptTotals,
  formatMoney,
} from "../src/lib/printer/tools-data";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`, extra !== undefined ? extra : "");
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? undefined : { actual, expected });
}

/* ---------------- Wi-Fi ---------------- */

eq(
  "wifi escape: спецсимволы",
  escapeWifiSegment('a;b:c,d"e\\f'),
  'a\\;b\\:c\\,d\\"e\\\\f'
);
eq("wifi escape: обычная строка не трогается", escapeWifiSegment("Home_5G-2"), "Home_5G-2");
eq(
  "wifi payload: WPA + hidden",
  wifiPayload({ ssid: "Home", password: "pa;ss", enc: "wpa", hidden: true }),
  "WiFi:T:WPA;S:Home;P:pa\\;ss;H:true;;"
);
eq(
  "wifi payload: nopass без P",
  wifiPayload({ ssid: "Cafe", password: "", enc: "nopass", hidden: false }),
  "WiFi:T:nopass;S:Cafe;;"
);

/* ---------------- Сроки ---------------- */

eq("addDuration: дни через месяц", addDuration("2026-01-01", 40, "day"), "2026-02-10");
eq("addDuration: зажим конца месяца", addDuration("2026-01-31", 1, "month"), "2026-02-28");
eq("addDuration: високосный февраль", addDuration("2024-01-31", 1, "month"), "2024-02-29");
eq("addDuration: 29.02 + 1 год", addDuration("2024-02-29", 1, "year"), "2025-02-28");
eq("addDuration: через декабрь", addDuration("2026-12-15", 2, "month"), "2027-02-15");
eq("addDuration: ноль дней", addDuration("2026-09-14", 0, "day"), "2026-09-14");
eq("addDuration: неверный iso — как есть", addDuration("мусор", 3, "day"), "мусор");
eq("todayISO: формат", /^\d{4}-\d{2}-\d{2}$/.test("2026-09-14"), true);
eq("formatDateHuman: ru", formatDateHuman("2027-03-14", "ru"), "14.03.2027");
check("formatDateHuman: en короткий месяц", /^Mar 14, 2027$/.test(formatDateHuman("2027-03-14", "en")), formatDateHuman("2027-03-14", "en"));

/* ---------------- Серии ---------------- */

eq(
  "numberSeries: pad + префикс",
  numberSeries({ prefix: "SK-", postfix: "", start: 7, count: 3, pad: 4 }),
  ["SK-0007", "SK-0008", "SK-0009"]
);
eq(
  "numberSeries: суффикс и старт без pad",
  numberSeries({ prefix: "", postfix: "/A", start: 99, count: 2, pad: 0 }),
  ["99/A", "100/A"]
);
eq("numberSeries: clamp количества", numberSeries({ prefix: "", postfix: "", start: 0, count: SERIES_MAX + 50, pad: 0 }).length, SERIES_MAX);
eq("numberSeries: отрицательный старт → 0", numberSeries({ prefix: "", postfix: "", start: -5, count: 1, pad: 2 })[0], "00");
eq("isBarcodeSafe: ascii ok", isBarcodeSafe("SKU-000123"), true);
eq("isBarcodeSafe: кириллица нет", isBarcodeSafe("ТОВАР-1"), false);
eq("isBarcodeSafe: слишком длинно", isBarcodeSafe("A".repeat(49)), false);
eq("isBarcodeSafe: 48 символов ок", isBarcodeSafe("A".repeat(48)), true);

/* ---------------- Календарь ---------------- */

eq("daysInMonth: февраль 2026", daysInMonth(2026, 2), 28);
eq("daysInMonth: февраль 2028 високосный", daysInMonth(2028, 2), 29);
eq("daysInMonth: декабрь", daysInMonth(2026, 12), 31);

// Январь 2026: 1 января — четверг; неделя с понедельника
const jan2026 = calendarGrid({ year: 2026, month: 1, weekStart: 1 });
eq("calendarGrid: первый день в своей колонке", jan2026[0][3], 1);
eq("calendarGrid: перед 1 января три пустые", jan2026[0].slice(0, 3), [null, null, null]);
eq("calendarGrid: 5 недель", jan2026.length, 5);
eq("calendarGrid: последняя неделя", jan2026[4], [26, 27, 28, 29, 30, 31, null]);

// Сентябрь 2026: 1 сентября — вторник; с воскресенья
const sep2026sun = calendarGrid({ year: 2026, month: 9, weekStart: 0 });
eq("calendarGrid(sun): сдвиг 2", sep2026sun[0].slice(0, 3), [null, null, 1]);
eq("calendarGrid(sun): 1 сентября — вторник", sep2026sun[0][2], 1);

const feb2028 = calendarGrid({ year: 2028, month: 2, weekStart: 1 });
eq("calendarGrid: полные недели", feb2028.every((w) => w.length === 7), true);

eq("monthTitle: ru", monthTitle(2026, 9, "ru"), "Сентябрь 2026");
check("monthTitle: en", /^September 2026$/.test(monthTitle(2026, 9, "en")), monthTitle(2026, 9, "en"));

eq("weekdayLabels: с понедельника", weekdayLabels(1, "ru"), ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]);
eq("weekdayLabels: с воскресенья (сдвиг)", weekdayLabels(0, "ru")[0], "ВС");
eq("weekdayLabels: en длина 3", weekdayLabels(1, "en")[0], "MON");

/* ---------------- Чек ---------------- */

const totals = receiptTotals(
  [
    { name: "Хлеб", price: 120, qty: 2 },
    { name: "Молоко", price: 35.5, qty: 1 },
  ],
  10
);
eq("receiptTotals: подытог", totals.subtotal, 275.5);
eq("receiptTotals: скидка", totals.discountValue, 27.55);
eq("receiptTotals: итог", totals.total, 247.95);

eq("receiptTotals: дробное qty → вниз", receiptTotals([{ name: "x", price: 10, qty: 2.9 }], 0).subtotal, 20);
eq("receiptTotals: без скидки", receiptTotals([{ name: "x", price: 10, qty: 3 }], 0).total, 30);
eq("receiptTotals: скидка clamp 90", receiptTotals([{ name: "x", price: 100, qty: 1 }], 150).discountValue, 90);
eq("receiptTotals: пустой чек", receiptTotals([], 10), { subtotal: 0, discountValue: 0, total: 0 });
eq("formatMoney: два знака", formatMoney(247.95), "247.95");
eq("formatMoney: округление", formatMoney(10.005), "10.01");
eq("formatMoney: целое", formatMoney(30), "30.00");

/* ---------------- Итог ---------------- */

console.log(`test-tools: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
