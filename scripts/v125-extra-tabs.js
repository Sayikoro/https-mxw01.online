/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка v1.0.25 «Скрытые вкладки Ценник/Изображение + стрелка доп. полей».
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v125-extra-tabs.js
 * Сервер: http://localhost:3000 (bun run dev).
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const consoleErrors = [];
// Шум песочницы: телеметрия Яндекса, не имеет отношения к приложению
const NOISE = /yandex\.net|ERR_CERT_AUTHORITY_INVALID/i;

function isNoise(text) {
  return NOISE.test(text);
}

function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

/** Закрыть все оверлеи (BLE-плашка, куки) */
async function closeOverlays(page) {
  for (let i = 0; i < 6; i++) {
    const dialog = page.locator('[role="dialog"][data-state="open"]');
    if ((await dialog.count()) > 0) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
      continue;
    }
    const cookieBtn = page.locator("button", { hasText: /принять|accept/i }).first();
    if ((await cookieBtn.count()) > 0 && (await cookieBtn.isVisible().catch(() => false))) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }
    break;
  }
}

const SHOW_RU = 'button[aria-label="Показать доп. вкладки"]';
const HIDE_RU = 'button[aria-label="Скрыть доп. вкладки"]';
const SHOW_EN = 'button[aria-label="Show extra tabs"]';
const HIDE_EN = 'button[aria-label="Hide extra tabs"]';

/** Анимация выезда — 300мс, ждём с запасом */
const ANIM = 500;

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. Десктоп RU: свернуто по умолчанию → раскрытие → выбор → схлопывание ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);

    const tabTape = page.getByRole("tab", { name: /Лента/ });
    const tabPt = page.getByRole("tab", { name: /Ценник/ });
    const tabImg = page.getByRole("tab", { name: /Изображение/ });

    ok(await tabTape.isVisible(), "RU: «Лента» видна всегда");
    ok(!(await tabPt.isVisible()), "RU: «Ценник» скрыта по умолчанию");
    ok(!(await tabImg.isVisible()), "RU: «Изображение» скрыта по умолчанию");

    const arrow = page.locator(SHOW_RU);
    ok((await arrow.count()) === 1, "RU: стрелка «Показать доп. вкладки» на месте");
    ok((await arrow.getAttribute("aria-expanded")) === "false", "RU: aria-expanded=false у стрелки");
    await page.screenshot({ path: "work/v125-ru-collapsed.png" });

    // Раскрытие
    await arrow.click();
    const hideArrow = page.locator(HIDE_RU);
    await hideArrow.waitFor({ state: "visible", timeout: 3000 });
    ok(true, "RU: подписка стрелки сменилась на «Скрыть доп. вкладки»");
    await page.waitForTimeout(ANIM);
    ok(await tabPt.isVisible(), "RU: «Ценник» выехала");
    ok(await tabImg.isVisible(), "RU: «Изображение» выехала");
    const cls = (await page.locator(HIDE_RU + " svg").getAttribute("class")) || "";
    ok(/rotate-180/.test(cls), "RU: шеврон повернулся (rotate-180)");
    await page.screenshot({ path: "work/v125-ru-expanded.png" });

    // Выбор скрытой вкладки → её поля
    await tabPt.click();
    await page.getByText("Товары", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
    ok(true, "RU: контент «Ценника» открылся (секция «Товары»)");

    // Схлопывание при активной скрытой: активная остаётся видимой
    await hideArrow.click();
    await page.waitForTimeout(ANIM);
    ok(!(await tabImg.isVisible()), "RU: «Изображение» спряталась обратно");
    ok(await tabPt.isVisible(), "RU: активная «Ценник» осталась видимой");
    ok(await page.getByText("Товары", { exact: true }).first().isVisible(), "RU: контент ценника не сбросился");

    // Возврат на «Ленту», раскрыть и снова схлопнуть (активная = «Лента»)
    await tabTape.click();
    await page.waitForTimeout(300);
    await page.locator(SHOW_RU).click();
    await page.waitForTimeout(ANIM);
    ok(await tabPt.isVisible() && await tabImg.isVisible(), "RU: повторное раскрытие работает");
    await page.locator(HIDE_RU).click();
    await page.waitForTimeout(ANIM);
    ok(!(await tabPt.isVisible()) && !(await tabImg.isVisible()), "RU: обе доп. вкладки спрятаны, осталась «Лента»");
    await page.locator(SHOW_RU).waitFor({ state: "visible", timeout: 3000 });
    ok(true, "RU: стрелка вернулась в состояние «Показать»");
    await ctx.close();
  }

  /* ---------- 2. Десктоп EN ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "en");
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);

    const arrow = page.locator(SHOW_EN);
    ok((await arrow.count()) === 1, "EN: стрелка «Show extra tabs» на месте");
    await arrow.click();
    await page.locator(HIDE_EN).waitFor({ state: "visible", timeout: 3000 });
    await page.waitForTimeout(ANIM);
    const tabPtEn = page.getByRole("tab", { name: /Price Tag/ });
    const tabImgEn = page.getByRole("tab", { name: /Image/ });
    ok(await tabPtEn.isVisible() && await tabImgEn.isVisible(), "EN: «Price Tag» и «Image» выехали");
    await tabPtEn.click();
    await page.getByText("Products", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
    ok(true, "EN: контент ценника открылся (Products)");
    await page.screenshot({ path: "work/v125-en-expanded.png" });
    await ctx.close();
  }

  /* ---------- 3. Мобильный 390px RU: переполнений нет ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ru",
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);

    const w1 = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(w1 <= 390, `RU mobile: свернуто — без гориз. переполнения (scrollW=${w1})`);
    await page.locator(SHOW_RU).click();
    await page.waitForTimeout(ANIM);
    const w2 = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(w2 <= 390, `RU mobile: раскрыто — без переполнения (scrollW=${w2})`);
    ok(await page.getByRole("tab", { name: /Ценник/ }).isVisible(), "RU mobile: «Ценник» видна после раскрытия");
    ok(await page.getByRole("tab", { name: /Изображение/ }).isVisible(), "RU mobile: «Изображение» видна после раскрытия");
    await page.screenshot({ path: "work/v125-mobile-expanded.png" });
    await ctx.close();
  }

  await browser.close();

  console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
  if (consoleErrors.length) {
    console.error("Ошибки консоли:");
    consoleErrors.forEach((e) => console.error("  " + e));
  }
  process.exit(failed || consoleErrors.length ? 1 : 0);
})();
