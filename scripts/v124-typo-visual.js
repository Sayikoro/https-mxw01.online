/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Визуальная проверка v1.0.24: сложные генераторы (календарь, привычки, чек,
 * нумерация) при масштабе 100% и 200% — скриншоты для eyeball-сравнения.
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v124-typo-visual.js
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";

const makeTool = (id, tool, data, scale) => ({
  id,
  kind: "tool",
  x: 0,
  y: 0,
  tool,
  data,
  ...(scale ? { typo: { scale, fontFamily: "sans-serif" } } : {}),
});

const ITEMS = [
  makeTool("cal-1", "calendar", { year: 2026, month: 9, weekStart: 1, weekends: true }, null),
  makeTool("cal-2", "calendar", { year: 2026, month: 9, weekStart: 1, weekends: true }, 2),
  makeTool("hab-1", "habits", { year: 2026, month: 9, habits: ["Спорт", "Чтение", "Вода"] }, null),
  makeTool("hab-2", "habits", { year: 2026, month: 9, habits: ["Спорт", "Чтение", "Вода"] }, 2),
  makeTool("num-1", "numbers", { prefix: "SKU-", postfix: "", start: 1, count: 3, pad: 4, barcode: true }, null),
  makeTool("num-2", "numbers", { prefix: "SKU-", postfix: "", start: 1, count: 3, pad: 4, barcode: true }, 2),
  makeTool("rec-1", "receipt", { shop: "Продукты 24", showDate: true, items: [{ id: "r1", name: "Кофе", price: 250, qty: 2 }, { id: "r2", name: "Молоко", price: 89.9, qty: 1 }], discount: 10, footer: "Спасибо за покупку!" }, null),
  makeTool("rec-2", "receipt", { shop: "Продукты 24", showDate: true, items: [{ id: "r1", name: "Кофе", price: 250, qty: 2 }, { id: "r2", name: "Молоко", price: 89.9, qty: 1 }], discount: 10, footer: "Спасибо за покупку!" }, 1.5),
  makeTool("dat-1", "dates", { name: "Йогурт", made: "2026-09-14", amount: 14, unit: "day", showMade: true, showUntil: true, border: true }, null),
  makeTool("dat-2", "dates", { name: "Йогурт", made: "2026-09-14", amount: 14, unit: "day", showMade: true, showUntil: true, border: true }, 1.5),
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
  const page = await ctx.newPage();
  await page.addInitScript((items) => {
    window.localStorage.setItem("mxw01-lang", "ru");
    if (!window.localStorage.getItem("mxw01-seeded-v124v")) {
      window.localStorage.setItem("mxw01-seeded-v124v", "1");
      window.localStorage.setItem("mxw01-text-fields", items);
    }
  }, JSON.stringify(ITEMS));
  await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) {
    const dialog = page.locator('[role="dialog"][data-state="open"]');
    if ((await dialog.count()) > 0) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }
    const cookieBtn = page.locator("button", { hasText: /хорошо|ok/i }).first();
    if ((await cookieBtn.count()) > 0 && (await cookieBtn.isVisible().catch(() => false))) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  const metrics = await page.evaluate(() =>
    Array.from(document.querySelectorAll('canvas[aria-label="Предпросмотр"]')).map((c) => ({
      w: c.width,
      h: c.height,
      data: c.toDataURL("image/png"),
    }))
  );
  const fs = require("fs");
  fs.mkdirSync("work/v124-pages", { recursive: true });
  metrics.forEach((m, i) => {
    fs.writeFileSync(`work/v124-pages/page-${i + 1}.png`, Buffer.from(m.data.split(",")[1], "base64"));
  });
  console.log(
    "pages:",
    JSON.stringify(metrics.map((m) => ({ w: m.w, h: m.h })))
  );
  await browser.close();
})();
