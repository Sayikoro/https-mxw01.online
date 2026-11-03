/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.38 — проверка секции «Печать по USB» в настройках:
 * переключатель «Инверсия цветов канваса» (usb-invert) виден, включается,
 * состояние живёт в localStorage (mxw01-usb-invert) и переживает перезагрузку.
 * Запуск: NODE_PATH=$(npm root -g) timeout 120 node scripts/v138-invert-ui.js
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Шум метрики песочницы ловим и по тексту, и по URL (500/503 от mc.yandex)
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (
      m.type() === "error" &&
      !/favicon|404|net::ERR|CERT|metrika|mc\.yandex|yandex\.net|googletagmanager/i.test(where)
    )
      errors.push(m.text());
  });
  // Тест на RU-текстах (язык в localStorage до загрузки страницы)
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("mxw01-lang", "ru");
    } catch {
      /* нет localStorage */
    }
  });

  // Закрыть всплывающие (BLE-предупреждение, cookie-баннер) — как в v134
  async function dismissPopups() {
    for (const act of [
      () => page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find(
          (x) => /понял|Понял|Got it|OK/i.test(x.textContent || "")
        );
        if (b) b.click();
      }),
      () => page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find(
          (x) => /принять|Принять|accept/i.test(x.textContent || "")
        );
        if (b) b.click();
      }),
    ]) {
      try {
        await act();
        await page.waitForTimeout(250);
      } catch {
        /* нет попапа — ладно */
      }
    }
  }

  // Открыть настройки: JS-клик по шестерёнке в шапке (овереи не перехватят)
  async function openSettings() {
    await dismissPopups();
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector(
          'header button[title="Настройки"], header button[title="Settings"]'
        );
        if (btn) btn.click();
      });
      try {
        await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 6000 });
        return;
      } catch {
        await page.waitForTimeout(700);
      }
    }
    throw new Error("Настройки не открылись");
  }

  await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await dismissPopups();
  await openSettings();
  await page.waitForTimeout(400);

  ok(
    (await page.getByText("Печать по USB", { exact: true }).count()) > 0,
    "секция «Печать по USB» в настройках"
  );
  const sw = page.locator('[data-testid="usb-invert"]');
  ok((await sw.count()) === 1, "переключатель usb-invert на месте");
  ok(
    (await page.getByText("Выключена", { exact: true }).count()) > 0,
    "статус «Выключена» по умолчанию"
  );

  await page.screenshot({ path: path.join(WORK, "v138-invert-off.png"), fullPage: false });

  await sw.click();
  await page.waitForTimeout(300);
  ok(
    (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-invert"))) === "1",
    "localStorage mxw01-usb-invert = 1 после включения"
  );
  ok(
    (await page.getByText("Включена — на принтер уходит негатив", { exact: true }).count()) > 0,
    "статус «Включена — на принтер уходит негатив»"
  );

  // Перезагрузка — настройка переживает reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await dismissPopups();
  await openSettings();
  await page.waitForTimeout(400);
  ok(
    (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-invert"))) === "1",
    "после перезагрузки инверсия включена (localStorage)"
  );
  ok(await page.locator('[data-testid="usb-invert"]').isVisible(), "переключатель снова виден");

  await page.screenshot({ path: path.join(WORK, "v138-invert-on.png"), fullPage: false });

  ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
  if (errors.length) console.error(errors.slice(0, 5));

  await browser.close();
  console.log(failures === 0 ? "\nИТОГ: все проверки v138 пройдены ✓" : `\nИТОГ: провалено ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
