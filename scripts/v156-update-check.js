/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.59 — кнопка «Проверить обновления» + мастер самообновления.
 * Запуск: NODE_PATH=$(npm root -g) timeout 180 node scripts/v156-update-check.js
 *
 * GITHUB_REPO вписан в site.ts — api.github.com перехватывается через page.route
 * (реальная сеть в тестах не участвует). Кейсы:
 *   1. Кнопка «Проверить обновления» в Настройках на месте;
 *   2. Клик при релизе, равном текущей версии → тихо уходит в SW-ветку
 *      (в dev — «проверять нечего»), мастер обновления НЕ показывается;
 *   3. Ссылка «Открыть панель обновлений» без нового релиза НЕ показывается;
 *   4. Версия в Настройках — v1.0.61;
 *   5. Повторный клик не ломает UI (статус снова показывается);
 *   6. Релиз НОВЕЕ (v1.0.99) → оранжевый статус «Доступна версия 1.0.99»,
 *      мастер самообновления: /update/ на localhost нет → честная инструкция
 *      + прямая ссылка на кит (releases/latest/download) + «Проверить снова»,
 *      ссылка «Открыть панель обновлений» → /update/ в новой вкладке;
 *   7. Релиз равен текущей → статус «проверять нечего», мастера нет;
 *   8. Репозиторий недоступен (404 — приватный) → молча, без ошибок в UI.
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
  /* Предупреждение Web Bluetooth (headless — «Browser not supported») */
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
  /* Ждём диалог НАСТРОЕК: в нём есть кнопка проверки обновлений.
     Внутри ждём именно [data-testid=check-updates] — любой другой диалог
     (BLE-предупреждение, cookie-баннер) считаем помехой и закрываем. */
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

  /* Перехват releases/latest — реальный api.github.com в тест не ходит.
     Паттерн-regex: owner/repo содержит слэш, glob-«*» через «/» не проходит.
     ghReply: JSON-ответ; ожидание статуса — опрос до совпадения с регэкспом
     (SW-ветка асинхронна, статус может задержаться). */
  const GH_URL = /api\.github\.com\/repos\/.+\/releases\/latest/;
  const ghReply = (body, code = 200) => ({
    status: code,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
  const mockRelease = async (tag, code = 200) =>
    await page.route(GH_URL, (r) => r.fulfill(ghReply(tag ? { tag_name: tag } : { message: "Not Found" }, code)));
  const unmock = async () => {
    await page.unroute(GH_URL); /* await обязателен: иначе снятие может догнать и удалить СЛЕДУЮЩИЙ мок */
  };
  const waitStatus = async (re, timeout = 9000) => {
    const deadline = Date.now() + timeout;
    let text = "";
    while (Date.now() < deadline) {
      try {
        if (await page.locator('[data-testid="updates-status"]').count()) {
          text = await page.locator('[data-testid="updates-status"]').innerText();
          if (re.test(text)) return text;
        }
      } catch {}
      await page.waitForTimeout(300);
    }
    return text;
  };

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30000 });
  await openSettings(page);

  // 1. Кнопка на месте
  const btn = page.locator('[data-testid="check-updates"]');
  ok(await btn.isVisible(), "кнопка «Проверить обновления» видна в Настройках");

  // 2. Клик при релизе, равном текущей версии → SW-ветка (в dev — «проверять нечего»)
  await mockRelease("v1.0.61");
  await btn.click();
  const st0 = await waitStatus(/проверять нечего|nothing to check|последнюю версию|latest version/i);
  ok(/проверять нечего|nothing to check|последнюю версию|latest version/i.test(st0),
    `релиз = текущей версии → честный статус (${st0.trim().slice(0, 60)}…)`);
  ok(!st0.includes("undefined") && !st0.includes("NaN"), "в статусе нет undefined/NaN");

  // 3. Мастер обновления и ссылки на панель без нового релиза быть не должно
  ok((await page.locator('[data-testid="updates-panel-link"]').count()) === 0,
    "ссылка «Открыть панель обновлений» скрыта (релиз не новее)");
  ok((await page.locator('[data-testid="update-wizard"]').count()) === 0,
    "мастер самообновления скрыт (релиз не новее)");

  // 4. Версия
  const ver = await page.locator('[data-testid="app-version"]').innerText();
  ok(ver.includes("1.0.61"), `в Настройках версия 1.0.61 (${ver.trim()})`);

  // 5. Повторный клик — UI жив
  await btn.click();
  await waitStatus(/проверять нечего|nothing to check|последнюю версию|latest version/i);
  ok((await page.locator('[data-testid="check-updates"]').count()) === 1,
    "повторная проверка не ломает UI");
  await unmock();

  // 6. Релиз новее → статус «Доступна версия 1.0.99» + мастер самообновления:
  //    панель /update на localhost отсутствует → инструкция + прямая ссылка на кит
  await mockRelease("v1.0.99");
  await btn.click();
  const stA = await waitStatus(/Доступна версия 1\.0\.99|Version 1\.0\.99 is available/);
  ok(/Доступна версия 1\.0\.99|Version 1\.0\.99 is available/.test(stA),
    `релиз новее → статус с новой версией (${stA.trim().slice(0, 55)}…)`);
  const wizard = page.locator('[data-testid="update-wizard"]');
  ok((await wizard.count()) === 1, "мастер самообновления показан");
  const kit = page.locator('[data-testid="upd-kit-link"]');
  try {
    await kit.waitFor({ state: "visible", timeout: 9000 });
    ok(true, "мастер: панель не найдена → инструкция с ссылкой на кит (прозвивание завершилось)");
  } catch {
    ok(false, "мастер: ссылка на кит не появилась за 9 с (пробing завис?)");
  }
  if ((await kit.count()) === 1) {
    const khref = (await kit.getAttribute("href")) ?? "";
    ok(khref === "https://github.com/Sayikoro/https-mxw01.online/releases/latest/download/mxw01-deploy-kit.zip",
      `прямая ссылка на кит с releases/latest/download (${khref})`);
  }
  ok((await page.locator('[data-testid="upd-reprobe"]').count()) === 1,
    "кнопка «Проверить снова» на месте");
  const link = page.locator('[data-testid="updates-panel-link"]');
  ok((await link.count()) === 1 && (await link.isVisible()),
    "ссылка «Открыть панель обновлений» показана");
  if ((await link.count()) === 1) {
    const href = (await link.getAttribute("href")) ?? "";
    const label = await link.innerText();
    ok(href === "/update/" && (await link.getAttribute("target")) === "_blank",
      `ссылка ведёт на /update/ в новой вкладке (${href})`);
    ok(/Открыть панель обновлений|Open the update panel/.test(label),
      `подпись ссылки локализована (${label.trim().slice(0, 45)}…)`);
  }
  await unmock();

  // 7. Релиз снова равен текущей → статус «проверять нечего», мастера нет
  await mockRelease("v1.0.61");
  await btn.click();
  const stB = await waitStatus(/проверять нечего|nothing to check|последнюю версию|latest version/i);
  ok(/проверять нечего|nothing to check|последнюю версию|latest version/i.test(stB) && !stB.includes("1.0.99"),
    "после отката релиза статус вернулся к обычному");
  ok((await page.locator('[data-testid="updates-panel-link"]').count()) === 0 &&
     (await page.locator('[data-testid="update-wizard"]').count()) === 0,
    "мастер и ссылка на панель снова скрыты");
  await unmock();

  // 8. Репозиторий недоступен (404 — приватный) → молча, без ошибки в UI
  await mockRelease(null, 404);
  await btn.click();
  const stC = await waitStatus(/проверять нечего|nothing to check|последнюю версию|latest version/i);
  ok(/проверять нечего|nothing to check|последнюю версию|latest version/i.test(stC),
    "404 от GitHub обрабатывается молча (переход к SW-ветке)");
  await unmock();

  await page.screenshot({ path: path.join(WORK, "v156-update-check.png") });
  await browser.close();

  ok(errors.length === 0, `нет pageerror (${errors.length})`);
  if (errors.length) console.error(errors.join("\n"));

  console.log(failures === 0 ? "\n✓ v156: все проверки пройдены" : `\n✗ v156: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
