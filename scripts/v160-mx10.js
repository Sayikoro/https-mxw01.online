/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.61 — транспорт MX10 (cat-протокол, порт thermy).
 * Запуск: NODE_PATH=$(npm root -g) timeout 180 node scripts/v160-mx10.js
 * (BASE_URL по умолчанию http://localhost:3000 — поднимите php -S -t .next-static)
 *
 * Кейсы (BLE-железо в CI недоступно — проверяем UI и настройки):
 *   1. В списке типов принтера есть вариант «MX10 (cat)» (иконка, подпись
 *      локализована RU/EN);
 *   2. После выбора MX10 кнопка подключения — cat-connect (оранжевая),
 *      с ?nobt=1 она задизейблена с честной подсказкой;
 *   3. В Настройках появился блок MX10: скорость/энергия/прогон; значения
 *      из полей пишутся в localStorage (mxw01-cat-speed и др.) и клампятся;
 *   4. Кнопка «Диагностика Bluetooth» из блока MX10 открывает общий диалог;
 *   5. Переключение обратно на BLE возвращает прежнюю кнопку;
 *   6. Нет pageerror.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "work");
if (!fs.existsSync(WORK)) fs.mkdirSync(WORK, { recursive: true });

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

async function dismissPopups(page) {
  try {
    await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 2500 });
    await page.waitForTimeout(250);
  } catch {}
  const sels = [
    '[data-testid="cookie-accept"]',
    'button:has-text("Принять")',
    'button:has-text("Accept")',
  ];
  for (const sel of sels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 })) {
        await el.click({ force: true });
        await page.waitForTimeout(250);
      }
    } catch {}
  }
}

async function openSettings(page) {
  await dismissPopups(page);
  for (let i = 0; i < 4; i++) {
    await dismissPopups(page);
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
      if (btn) btn.click();
    });
    try {
      await page.waitForSelector('[data-testid="check-updates"]', { timeout: 6000 });
      return;
    } catch {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissPopups(page);
  await page.evaluate(() => {
    const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('[data-testid="check-updates"]', { timeout: 6000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30000 });
  await dismissPopups(page);

  // 1. Вариант «MX10 (cat)» в списке типов принтера
  await page.locator('[data-testid="transport-select"]').click();
  const opt = page.locator('[data-testid="transport-cat"]');
  await opt.waitFor({ state: "visible", timeout: 5000 });
  ok((await opt.count()) === 1, "в списке есть вариант «MX10 (cat)» (transport-cat)");
  const optText = (await opt.innerText()).replace(/\s+/g, " ").trim();
  ok(/MX10/.test(optText), `подпись варианта с MX10 (${optText.slice(0, 40)}…)`);

  // 2. Выбор MX10: кнопка cat-connect, с ?nobt=1 — задизейблена
  await opt.click();
  const btn = page.locator('[data-testid="cat-connect"]');
  await btn.waitFor({ state: "visible", timeout: 5000 });
  ok((await btn.count()) === 1, "после выбора MX10 кнопка стала cat-connect");
  ok(await btn.isDisabled(), "?nobt=1: cat-connect задизейблена (Web Bluetooth нет)");
  const title = (await btn.getAttribute("title")) ?? "";
  ok(/Web Bluetooth/.test(title), `подсказка честно про Web Bluetooth (${title.slice(0, 45)}…)`);

  // 3. Настройки: блок MX10 (скорость/энергия/прогон)
  await openSettings(page);
  const speed = page.locator('[data-testid="cat-speed"]');
  const energy = page.locator('[data-testid="cat-energy"]');
  const feed = page.locator('[data-testid="cat-feed"]');
  ok((await speed.count()) === 1 && (await energy.count()) === 1 && (await feed.count()) === 1,
    "в Настройках есть блок MX10 (скорость, энергия, прогон)");
  // Значения по умолчанию thermy: 35 / 8000 / 50
  ok((await speed.inputValue()) === "32", `скорость по умолчанию 32 (kitty-web) (${await speed.inputValue()})`);
  ok((await energy.inputValue()) === "24000", `энергия по умолчанию 24000 (kitty-web) (${await energy.inputValue()})`);
  // Кламп и запись в localStorage
  await speed.fill("999");
  await speed.blur();
  await page.waitForTimeout(200);
  const lsSpeed = await page.evaluate(() => window.localStorage.getItem("mxw01-cat-speed"));
  ok(lsSpeed === "127", `скорость клампится до 127 и пишется в localStorage (${lsSpeed})`);
  await speed.fill("40");
  await speed.blur();
  await page.waitForTimeout(200);
  const lsSpeed2 = await page.evaluate(() => window.localStorage.getItem("mxw01-cat-speed"));
  ok(lsSpeed2 === "40", `скорость 40 сохранена (${lsSpeed2})`);
  await energy.fill("6000");
  await energy.blur();
  await page.waitForTimeout(200);
  const lsEnergy = await page.evaluate(() => window.localStorage.getItem("mxw01-cat-energy"));
  ok(lsEnergy === "6000", `энергия 6000 сохранена (${lsEnergy})`);

  // 4. Кнопка диагностики из блока MX10 открывает общий диалог
  await page.locator('[data-testid="cat-diagnostics-open"]').click();
  await page.waitForTimeout(400);
  const diagVisible = await page
    .locator('[data-testid="hprt-diagnostics"], .max-w-\\[90vw\\] h2, [role="dialog"]')
    .first()
    .isVisible()
    .catch(() => false);
  ok(diagVisible, "кнопка «Диагностика Bluetooth» из блока MX10 открывает диалог");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 5. Обратно на BLE — кнопка возвращается в обычный вид
  await page.keyboard.press("Escape"); // закрыть настройки
  await page.waitForTimeout(300);
  await page.locator('[data-testid="transport-select"]').click();
  await page.locator('[data-testid="transport-ble"]').click();
  await page.waitForTimeout(300);
  ok((await page.locator('[data-testid="cat-connect"]').count()) === 0,
    "после возврата на BLE кнопка cat-connect исчезла");

  await page.screenshot({ path: path.join(WORK, "v160-mx10.png") });
  await browser.close();

  ok(errors.length === 0, `нет pageerror (${errors.length})`);
  if (errors.length) console.error(errors.join("\n"));

  console.log(failures === 0 ? "\n✓ v160: все проверки пройдены" : `\n✗ v160: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
