/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.46 — экономия ленты TSPL: режим «Непрерывная лента»
 * (запрос: «Перед печатью картинки он около 20см ленты выплевывает и только
 * потом печатает … вообще посмотри где может лента мотаться еще лишняя»).
 * Запуск: NODE_PATH=$(npm root -g) timeout 190 node scripts/v147-tape-waste.js
 *
 * Кейсы:
 *   1. Дефолт (этикетки с зазором): в потоке GAP 2 mm,0 mm, SIZE 40 mm,30 mm
 *      (минимум высоты из настройки применяется — поведение как раньше);
 *   2. «Носитель → Непрерывная лента»: GAP 0 mm,0 mm (нет поиска зазора),
 *      SIZE 40 mm,27 mm — ровно по содержимому (213 рядов / 8 точек/мм);
 *      поле «Зазор» задизейблено, подсказка сменилась;
 *   3. Картинка с белыми полями (192×192, полоса чёрного в середине):
 *      в непрерывном режиме поля обрезаются — BITMAP 160 рядов, SIZE 20 мм;
 *   4. Диагностика подключения: «… · непрерывная лента»;
 *   5. Консоль без ошибок.
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
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

/** Мок navigator.usb: transferOut пишет в window.__usbLog (как в v141–v146) */
function usbMockInit() {
  window.localStorage.setItem("mxw01-lang", "ru");
  // - v1.0.48: POS скрыт за экспериментальным флагом — тесты USB включают его -
  window.localStorage.setItem("mxw01-pos-beta", "1");
  const log = [];
  window.__usbLog = log;
  const device = {
    vendorId: 0x0483,
    productId: 0x5742,
    productName: "Mock POS-58",
    manufacturerName: "Mock",
    opened: false,
    open: async () => {
      device.opened = true;
    },
    close: async () => {
      device.opened = false;
    },
    selectConfiguration: async () => {},
    claimInterface: async () => {},
    selectAlternateInterface: async () => {},
    transferOut: async (_ep, data) => {
      log.push(Array.from(new Uint8Array(data)));
      return { bytesWritten: data.byteLength, status: "ok" };
    },
    forget: async () => {},
    configuration: {
      interfaces: [
        {
          interfaceNumber: 0,
          alternate: {
            interfaceNumber: 0,
            endpoints: [{ endpointNumber: 1, direction: "out", type: "bulk" }],
          },
          alternates: [
            {
              interfaceNumber: 0,
              endpoints: [{ endpointNumber: 1, direction: "out", type: "bulk" }],
            },
          ],
        },
      ],
    },
  };
  Object.defineProperty(navigator, "usb", {
    configurable: true,
    get() {
      return {
        requestDevice: async () => {
          window.__usbPaired = true;
          return device;
        },
        getDevices: async () => (window.__usbPaired ? [device] : []),
      };
    },
  });
}

async function collectErrors(page, bucket) {
  page.on("pageerror", (e) => bucket.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (
      m.type() === "error" &&
      !/favicon|404|net::ERR|CERT|metrika|mc\.yandex|yandex\.net|googletagmanager/i.test(where)
    ) {
      bucket.push(`console: ${m.text()}`);
    }
  });
}

async function connectMock(page) {
  await page.locator('[data-testid="transport-select"]').click();
  await page.locator('[data-testid="transport-usb"]').click();
  await page.locator('[data-testid="usb-connect"]').click();
  await page.waitForFunction(
    () => document.body?.innerText.includes("Mock POS-58"),
    undefined,
    { timeout: 5000 }
  );
}

/** Склеенный текст всего USB-потока (команды ASCII) */
function readStream(page) {
  return page.evaluate(() =>
    window.__usbLog.flat().map((b) => String.fromCharCode(b)).join("")
  );
}

async function printAndRead(page) {
  await page.evaluate(() => {
    if (window.__usbLog) window.__usbLog.length = 0;
  });
  await page.getByRole("button", { name: "Печать", exact: true }).click();
  await page.waitForFunction(
    () => window.__usbLog && window.__usbLog.length > 0,
    undefined,
    { timeout: 20000 }
  );
  await page.waitForTimeout(400);
  return readStream(page);
}

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(usbMockInit);
  await collectErrors(page, errors);

  try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => (document.body?.innerText || "").length > 200, undefined, { timeout: 20000 });
    try { await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 4000 }); } catch {}

    // Вкладка «Изображение» (спрятана за «Показать доп. вкладки»)
    await page.getByRole("button", { name: "Показать доп. вкладки" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("tab", { name: /Изображение/ }).click();
    await page.waitForTimeout(300);

    // --- Кейсы 1–2: сплошной чёрный 192×128 (превью 384×256, растр 320×213) ---
    const solid = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 192;
      c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = "#000000";
      x.fillRect(0, 0, 192, 128);
      return c.toDataURL("image/png");
    });
    const solidPath = path.join(WORK, "v147-solid-192x128.png");
    fs.writeFileSync(solidPath, Buffer.from(solid.split(",")[1], "base64"));
    await page.setInputFiles('input[type="file"][accept="image/*"]', solidPath);
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas[style*="pixelated"]');
        return c && c.width > 0;
      },
      undefined,
      { timeout: 10000 }
    );

    await connectMock(page);
    await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
    await page.waitForTimeout(300);

    // Кейс 1: дефолт — этикетки с зазором, GAP 2, минимум высоты 30 мм
    const gapStream = await printAndRead(page);
    ok(/GAP 2 mm,0 mm/.test(gapStream), `Дефолт: GAP 2 mm,0 mm (зазор из настройки)`);
    ok(/SIZE 40 mm,30 mm/.test(gapStream), `Дефолт: SIZE 40 mm,30 mm (минимум высоты работает, получено ${/SIZE [^\r\n]+/.exec(gapStream)?.[0]})`);

    // Кейс 2: непрерывная лента — GAP 0, длина ровно по содержимому
    const mediaSelect = page.locator('[data-testid="usb-media"]');
    ok(await mediaSelect.isVisible(), "Дока печати: селектор «Носитель» виден");
    await mediaSelect.selectOption("continuous");
    await page.waitForTimeout(400);
    const contStream = await printAndRead(page);
    ok(/GAP 0 mm,0 mm/.test(contStream), "Continuous: GAP 0 mm,0 mm (поиск зазора выключен)");
    ok(!/GAP 2 mm/.test(contStream), "Continuous: GAP 2 отсутствует");
    ok(/SIZE 40 mm,27 mm/.test(contStream), `Continuous: SIZE 40 mm,27 mm — ровно содержимое (213/8 = 27), получено ${/SIZE [^\r\n]+/.exec(contStream)?.[0]}`);
    ok(await page.locator('[data-testid="usb-gap"]').isDisabled(), "Continuous: поле «Зазор» задизейблено");
    const hint = await page.locator('[data-testid="usb-label-auto-hint"]').textContent();
    ok(/Непрерывная лента/.test(hint || ""), `Continuous: подсказка сменилась (получено «${(hint || "").slice(0, 40)}…»)`);

    // --- Кейс 3: картинка с белыми полями — обрезка перед печатью ---
    // 192×192: белый верх/низ по 48 px, чёрная полоса 96 px в середине
    const padded = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 192;
      c.height = 192;
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, 192, 192);
      x.fillStyle = "#000000";
      x.fillRect(0, 48, 192, 96);
      return c.toDataURL("image/png");
    });
    const paddedPath = path.join(WORK, "v147-padded-192x192.png");
    fs.writeFileSync(paddedPath, Buffer.from(padded.split(",")[1], "base64"));
    await page.setInputFiles('input[type="file"][accept="image/*"]', paddedPath);
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas[style*="pixelated"]');
        return c && c.height === 384;
      },
      undefined,
      { timeout: 10000 }
    );
    const paddedStream = await printAndRead(page);
    // Превью 384×384 → растр 320×320 → после обрезки ~160 рядов → SIZE 20 мм
    ok(/SIZE 40 mm,20 mm/.test(paddedStream), `Continuous + поля: SIZE 40 mm,20 mm (белые поля обрезаны, получено ${/SIZE [^\r\n]+/.exec(paddedStream)?.[0]})`);
    ok(/BITMAP 0,0,40,160,0,/.test(paddedStream), "Continuous + поля: BITMAP 0,0,40,160,0 — 160 рядов вместо 320");
    ok(!/SIZE 40 mm,40 mm/.test(paddedStream), "Continuous + поля: нет печати всего холста 40 мм");

    // --- Кейс 4: диагностика показывает «непрерывная лента» ---
    await page.locator('header button[title="Настройки"], header button[title="Settings"]').first().click();
    await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 5000 });
    const dlg = page.locator('[role="dialog"][data-state="open"]');
    await page.waitForTimeout(500);
    const diagText = (await dlg.innerText()) || "";
    ok(/непрерывная лента/i.test(diagText), "Диагностика: «… · непрерывная лента» вместо зазора");
    await page.screenshot({ path: path.join(WORK, "v147-tape-waste.png"), fullPage: false });
    await page.keyboard.press("Escape");

    // Возврат в режим зазора — поведение должно вернуться к прежнему
    await mediaSelect.selectOption("gap");
    await page.waitForTimeout(300);
    ok(!(await page.locator('[data-testid="usb-gap"]').isDisabled()), "Возврат на «С зазором»: поле «Зазор» снова активно");
    const backStream = await printAndRead(page);
    ok(/GAP 2 mm,0 mm/.test(backStream), "Возврат на «С зазором»: GAP 2 mm,0 mm как раньше");
    ok(/SIZE 40 mm,30 mm/.test(backStream), `Возврат на «С зазором»: SIZE 40 mm,30 mm (поля обрезаны и в gap — v1.0.47, минимум высоты 30 мм), получено ${/SIZE [^\r\n]+/.exec(backStream)?.[0]}`);
  } catch (e) {
    failures += 1;
    console.error("  ✗ исключение:", e.message?.slice(0, 300));
  }

  ok(errors.length === 0, "консоль без ошибок");
  if (errors.length) errors.slice(0, 8).forEach((e) => console.error("    -", e.slice(0, 200)));

  await browser.close();
  console.log(failures === 0 ? "\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `\nПРОВАЛОВ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
