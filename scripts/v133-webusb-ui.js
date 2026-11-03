/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.35 — проверка WebUSB-печати (POS-принтеры ESC/POS)
 * и новой шапки: выпадающий список типа принтера + цветная кнопка
 * «Подключить» (BT — зелёная, POS — синяя).
 * Запуск: NODE_PATH=$(npm root -g) timeout 170 node scripts/v133-webusb-ui.js
 *
 * Кейсы:
 *   1. Браузер с WebUSB (мок navigator.usb): в шапке список типа принтера;
 *      выбор «POS-USB» → синяя кнопка «Подключить» → мок-принтер → печать
 *      с вкладки «Текст» уходит в USB — captured stream содержит ESC @,
 *      GS v 0 (48 байт/строка = 384 px) и НЕ содержит ESC a 1 (v1.0.38 —
 *      выравнивание всегда по левому краю); скриншоты;
 *   2. Браузер БЕЗ WebUSB: вариант POS-USB в списке недоступен (disabled);
 *   3. Реальный headless Chromium: navigator.usb существует, но устройств
 *      нет — в шапке кнопка «Подключить» (без клика).
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

/** Мок navigator.usb: один принтер, transferOut пишет в window.__usbLog */
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

/** navigator.usb отсутствует (Firefox/Safari) */
function noUsbInit() {
  window.localStorage.setItem("mxw01-lang", "ru");
  // - v1.0.48: POS скрыт за экспериментальным флагом; кейс проверяет именно
  //   деградацию БЕЗ WebUSB, поэтому флаг включён — опция видна, но disabled -
  window.localStorage.setItem("mxw01-pos-beta", "1");
  Object.defineProperty(navigator, "usb", {
    configurable: true,
    get() {
      return undefined;
    },
  });
}

function hasSubseq(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

async function dismissBleWarning(page) {
  try {
    await page
      .getByRole("button", { name: /Понятно|Got it/ })
      .click({ timeout: 4000 });
    console.log("  • BLE-предупреждение закрыто");
  } catch {
    console.log("  • BLE-предупреждение не появилось");
  }
}

async function collectErrors(page, bucket) {
  page.on("pageerror", (e) => bucket.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Шум метрики песочницы ловим и по тексту, и по URL (500/503 от mc.yandex)
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (
      m.type() === "error" &&
      !/favicon|404|net::ERR|CERT|metrika|mc\.yandex|yandex\.net|googletagmanager/i.test(where)
    ) {
      bucket.push(`console: ${m.text()}`);
    }
  });
}

async function main() {
  const browser = await chromium.launch();

  /* ---------------- Кейс 1: WebUSB есть, печать через мок ---------------- */
  console.log("Кейс 1: печать по USB (мок navigator.usb)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(usbMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);

    ok(
      (await page.locator('[data-testid="transport-select"]').count()) === 1,
      "в шапке есть выпадающий список типа принтера"
    );
    ok(
      (await page.locator('[data-testid="usb-connect"]').count()) === 0,
      "USB-устройств ещё нет — кнопки «Подключить» USB в шапке не было до переключения"
    );

    // Открываем список и выбираем POS-USB
    await page.locator('[data-testid="transport-select"]').click();
    ok(
      await page.locator('[data-testid="transport-usb"]').isVisible(),
      "в списке есть вариант POS-USB (ESC/POS)"
    );
    await page.locator('[data-testid="transport-usb"]').click();
    ok(
      (await page.locator('[data-testid="usb-connect"]').isVisible()),
      "после выбора POS-USB в шапке синяя кнопка «Подключить»"
    );
    await page.locator('[data-testid="usb-connect"]').click();
    await page.waitForFunction(
      () => document.body?.innerText.includes("Mock POS-58"),
      undefined,
      { timeout: 5000 }
    );
    ok(true, "мок-принтер подключён: в шапке синий чип «Mock POS-58»");

    await page.screenshot({ path: path.join(WORK, "v133-usb-dock.png") });

    // Печать с вкладки «Текст» (поле по умолчанию уже есть)
    const printBtn = page.getByRole("button", { name: "Печать", exact: true });
    await printBtn.click();
    await page.waitForFunction(() => window.__usbLog && window.__usbLog.length > 0, undefined, {
      timeout: 20000,
    });
    const flat = await page.evaluate(() => window.__usbLog.flat());
    ok(flat.length > 100, `поток печати получен (${flat.length} байт)`);
    ok(hasSubseq(flat, [0x1b, 0x40]), "ESC @ (инициализация) в потоке");
    ok(
      hasSubseq(flat, [0x1b, 0x61, 0x01]) === false,
      "центрирования нет: ESC a 1 отсутствует (выравнивание — левый край, v1.0.38)"
    );
    ok(
      hasSubseq(flat, [0x1d, 0x76, 0x30, 0x00, 0x30, 0x00]),
      "GS v 0 с 48 байт/строку (384 px) в потоке"
    );
    ok(hasSubseq(flat, [0x1d, 0x56, 0x00]) === false, "отрез по умолчанию выключен");

    await page.screenshot({ path: path.join(WORK, "v133-usb-full.png") });

    // Включаем отрез и печатаем ещё раз — GS V 0 должен появиться
    await page.locator('[data-testid="usb-cut"]').check();
    await printBtn.click();
    await page.waitForFunction(
      (n) => window.__usbLog.flat().length > n,
      flat.length,
      { timeout: 20000 }
    );
    const flat2 = await page.evaluate(() => window.__usbLog.flat());
    ok(hasSubseq(flat2, [0x1d, 0x56, 0x00]), "после включения тумблера GS V 0 (отрез) в потоке");

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ---------------- Кейс 2: WebUSB нет (как Safari/Firefox) ---------------- */
  console.log("Кейс 2: браузер без WebUSB — интерфейс прежний");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(noUsbInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);

    ok(
      (await page.locator('[data-testid="transport-select"]').count()) === 1,
      "список типа принтера в шапке есть (Bluetooth доступен всегда)"
    );
    await page.locator('[data-testid="transport-select"]').click();
    ok(
      await page.locator('[data-testid="transport-usb"]').isDisabled(),
      "без WebUSB вариант POS-USB недоступен (disabled)"
    );
    await page.keyboard.press("Escape");
    ok(
      (await page.locator('[data-testid="usb-width"]').count()) === 0,
      "настроек USB-бумаги нет"
    );
    await page.screenshot({ path: path.join(WORK, "v133-usb-hidden.png") });
    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ------------- Кейс 3: WebUSB есть, но принтер не выбран ---------------- */
  console.log("Кейс 3: WebUSB есть, устройство не выбрано — кнопка выбора");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Мок без пары: requestDevice есть, getDevices() пуст
    await ctx.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      // - v1.0.48: POS за экспериментальным флагом — кейс выбирает POS-USB -
      window.localStorage.setItem("mxw01-pos-beta", "1");
      Object.defineProperty(navigator, "usb", {
        configurable: true,
        get() {
          return {
            requestDevice: async () => {
              throw new Error("no chooser in test");
            },
            getDevices: async () => [],
          };
        },
      });
    });
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await page.locator('[data-testid="transport-select"]').click();
    await page.locator('[data-testid="transport-usb"]').click();
    ok(
      (await page.locator('[data-testid="usb-connect"]').isVisible()),
      "в шапке показана кнопка «Подключить» для POS-USB"
    );
    await page.screenshot({ path: path.join(WORK, "v133-usb-choose.png") });
    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();

  console.log(
    failures === 0
      ? "\nИТОГ: все проверки v133 пройдены ✓"
      : `\nИТОГ: упавших проверок: ${failures}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
