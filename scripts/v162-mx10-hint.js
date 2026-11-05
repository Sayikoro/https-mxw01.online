/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.63 — подсказка «это не MXW01, а котиковый принтер».
 * Запуск: NODE_PATH=$(npm root -g) timeout 180 node scripts/v162-mx10-hint.js
 * (BASE_URL по умолчанию http://localhost:3000 — поднимите php -S -t .next-static)
 *
 * Реальный сценарий пользователя: MX10-подобный клон попадает в MXW01-диалог
 * (рекламирует ae30), подключение «успешно» (драйвер глотает ошибку статуса),
 * но при ПЕЧАТИ requestStatus (0xa1) молчит 5 с → «Timeout waiting for
 * notification 0xa1» в тосте. В v1.0.63:
 *   1. printCanvas распознаёт фирменный таймаут и вместо сырой ошибки
 *      показывает подсказку pc.maybeCatHint;
 *   2. в шапке баннер «Похоже, это котиковый принтер» с кнопкой
 *      «Переключиться на MX10 (cat)» и крестиком;
 *   3. по кнопке — MXW01-соединение разрывается, транспорт переключается на
 *      cat и сразу открывается подключение (в тесте — фейковый GATT);
 *   4. при ОБЫЧНОЙ ошибке (отказ выбора устройства) баннера НЕТ;
 *   5. нет pageerror.
 *
 * Фейковый Bluetooth: стаб-устройство с сервисом ae30 и характеристиками
 * ae01/ae02/ae03, которые ничего не отвечают — ровно поведение «котикового»
 * клона в MXW01-драйвере (печать падает через ~5 с по таймауту статуса).
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
  const sels = ['[data-testid="cookie-accept"]'];
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
  for (let i = 0; i < 4; i++) {
    await dismissPopups(page);
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
      if (btn) btn.click();
    });
    try {
      await page.waitForSelector('[data-testid="test-page"]', { timeout: 6000 });
      return;
    } catch {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }
  throw new Error("Не удалось открыть Настройки");
}

/* Стаб «котикового клона в MXW01-драйвере»: сервис ae30 есть, характеристики
 * есть, но ни один статус-запрос не отвечает (нотификации не приходят). */
const FAKE_BT = `
(() => {
  const mkChar = () => ({
    properties: { write: true, writeWithoutResponse: true, read: true, notify: false, indicate: false },
    uuid: "0000ae01-0000-1000-8000-00805f9b34fb",
    value: null,
    writeValue: async () => {},
    writeValueWithoutResponse: async () => {},
    writeValueWithResponse: async () => {},
    readValue: async () => new DataView(new ArrayBuffer(1)),
    startNotifications: async () => mkChar(),
    stopNotifications: async () => mkChar(),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const chars = { control: mkChar(), notify: mkChar(), data: mkChar() };
  const service = {
    uuid: "0000ae30-0000-1000-8000-00805f9b34fb",
    getCharacteristic: async (uuid) => {
      const u = String(uuid).toLowerCase();
      if (u.includes("ae02")) return chars.notify;
      if (u.includes("ae03")) return chars.data;
      return chars.control; // ae01 и всё прочее
    },
  };
  const server = {
    connected: true,
    connect: async () => server,
    disconnect: () => { server.connected = false; },
    getPrimaryService: async () => service,
    getServices: async () => [service],
  };
  const device = {
    id: "fake-mx10-clone",
    name: "MX10",
    addEventListener: () => {},
    removeEventListener: () => {},
    gatt: { connected: true, connect: () => Promise.resolve(server), disconnect: () => {} },
  };
  try {
    Object.defineProperty(navigator, "bluetooth", {
      value: { requestDevice: () => Promise.resolve(device) },
      configurable: true,
    });
  } catch {}
})();
`;

/* Стаб «пользователь отменил выбор устройства» — обычная ошибка без таймаута */
const CANCEL_BT = `
(() => {
  try {
    Object.defineProperty(navigator, "bluetooth", {
      value: { requestDevice: () => Promise.reject(new Error("User canceled")) },
      configurable: true,
    });
  } catch {}
})();
`;

(async () => {
  const browser = await chromium.launch();

  /* ---------- Сценарий A: котиковый клон → таймаут при печати → баннер -- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(FAKE_BT);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await dismissPopups(page);

    ok((await page.locator('[data-testid="cat-hint-banner"]').count()) === 0,
      "A: до печати баннера нет");

    // Подключение через BLE (MXW01): стаб проходит — драйвер «подключился»
    await page.locator('[data-testid="ble-connect"]').click();
    await page.waitForFunction(
      () => document.querySelectorAll("header span.bg-green-500").length === 1,
      { timeout: 15000 }
    );
    ok(true, "A: подключение прошло (зелёный чип) — как с реальным клоном");

    // Печать тест-страницы: requestStatus (0xa1) молчит → таймаут ~5 с
    await openSettings(page);
    await page.locator('[data-testid="test-page"]').click();
    await page.waitForTimeout(7000);

    // Тост с понятной подсказкой (вместо сырого «Timeout waiting…»)
    const toastText = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[role="status"], [data-state] li, li[data-state]'));
      return els.map((e) => e.textContent || "").join(" | ");
    });
    ok(/did not answer MXW01 commands|не ответил на команды MXW01/.test(toastText),
      "A: в тосте понятная подсказка вместо сырого таймаута");
    ok(!/Timeout waiting for notification/.test(toastText),
      "A: сырой текст таймаута в тост не просачивается");

    // Закрыть Настройки (Escape может потребоваться дважды — фокус в тосте),
    // дождаться исчезновения overlay диалога, потом дать тосту уйти
    for (let i = 0; i < 3; i++) {
      const stillOpen = await page.evaluate(() => !!document.querySelector('[data-slot="dialog-overlay"]'));
      if (!stillOpen) break;
      await page.keyboard.press("Escape");
      try {
        await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-overlay"]'), { timeout: 3000 });
      } catch {}
    }
    await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-overlay"]'), { timeout: 8000 });
    await page.waitForTimeout(4500); // тост исчезает сам и не мешает клику
    const banner = page.locator('[data-testid="cat-hint-banner"]');
    await banner.waitFor({ state: "visible", timeout: 10000 });
    ok(true, "A: в шапке появился баннер-подсказка");
    const bannerText = (await banner.innerText()).replace(/\s+/g, " ");
    ok(/MX10/.test(bannerText) && /cat/i.test(bannerText),
      `A: текст баннера про MX10/cat («${bannerText.slice(0, 70)}…»)`);
    ok((await banner.locator('[data-testid="cat-hint-switch"]').count()) === 1,
      "A: в баннере есть кнопка переключения");
    ok((await banner.locator('[data-testid="cat-hint-close"]').count()) === 1,
      "A: в баннере есть крестик");

    await page.screenshot({ path: path.join(WORK, "v162-banner.png") });

    // Переключение на MX10 (cat) прямо из баннера: стаб → подключение проходит
    await banner.locator('[data-testid="cat-hint-switch"]').click();
    await page.waitForTimeout(3000);
    const selText = (await page.locator('[data-testid="transport-select"]').innerText()).replace(/\s+/g, " ");
    ok(/MX10 \(cat\)/.test(selText), `A: транспорт переключился на «MX10 (cat)» (${selText})`);
    ok((await page.locator('[data-testid="cat-hint-banner"]').count()) === 0,
      "A: баннер скрыт после переключения");
    // Фейковый GATT прошёл автопрофиль cat-транспорта → оранжевый чип «MX10»
    const catChip = page.locator("header span.bg-orange-600");
    ok((await catChip.count()) === 1, "A: cat-принтер подключён (оранжевый чип)");

    await page.screenshot({ path: path.join(WORK, "v162-switched.png") });
    await ctx.close();

    ok(errors.length === 0, `A: нет pageerror (${errors.length})`);
    if (errors.length) console.error(errors.join("\n"));
  }

  /* ---------- Сценарий B: обычная ошибка → баннера НЕТ ------------------ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(CANCEL_BT);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await dismissPopups(page);

    await page.locator('[data-testid="ble-connect"]').click();
    await page.waitForTimeout(3000);
    ok((await page.locator('[data-testid="cat-hint-banner"]').count()) === 0,
      "B: при обычной ошибке подключения баннера нет");

    await ctx.close();
    ok(errors.length === 0, `B: нет pageerror (${errors.length})`);
  }

  await browser.close();

  console.log(failures === 0 ? "\n✓ v162: все проверки пройдены" : `\n✗ v162: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
