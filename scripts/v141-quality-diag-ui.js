/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.41 — «Чёткая печать» (усиление контраста) + SPEED/DENSITY
 * TSPL в доке печати + «Диагностика подключения» по активному транспорту.
 * Запуск: NODE_PATH=$(npm root -g) timeout 170 node scripts/v141-quality-diag-ui.js
 *
 * Кейсы:
 *   1. Мок navigator.usb → POS-USB → в доке чекбокс «Чёткая печать»
 *      (usb-hq): по умолчанию выключен, включение пишется в localStorage
 *      и переживает перезагрузку; TSPL: поля «Плотность»/«Скорость»
 *      (usb-density/usb-speed) с рабочими 8/4, правки пишутся в localStorage;
 *      «Настройки» → «Диагностика подключения»: при транспорте USB показаны
 *      WebUSB-строки (драйвер/транспорт/язык команд/этикетка или бумага/
 *      устройство/статус «Подключён»), при переключении языка меняется
 *      строка «Язык команд» и появляются поля бумаги/этикетки;
 *   2. Транспорт Bluetooth → в диагностике прежние BLE-строки
 *      (Web Bluetooth LE (service ae30)), USB-строк нет.
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

/** Мок navigator.usb (как в v133): transferOut пишет в window.__usbLog */
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

async function dismissBleWarning(page) {
  try {
    await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 4000 });
  } catch {
    /* не появлялось */
  }
}

async function main() {
  const browser = await chromium.launch();

  /* ------------- Кейс 1: USB-мок, качество + диагностика USB ------------- */
  console.log("Кейс 1: чёткая печать, TSPL скорость/плотность, диагностика USB");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(usbMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);

    await page.locator('[data-testid="transport-select"]').click();
    await page.locator('[data-testid="transport-usb"]').click();
    await page.locator('[data-testid="usb-connect"]').click();
    await page.waitForFunction(
      () => document.body?.innerText.includes("Mock POS-58"),
      undefined,
      { timeout: 5000 }
    );
    ok(true, "мок-принтер подключён (Mock POS-58)");

    // Чёткая печать: есть, по умолчанию выключена
    const hq = page.locator('[data-testid="usb-hq"]');
    ok((await hq.count()) === 1, "чекбокс «Чёткая печать» в доке (usb-hq)");
    ok(!(await hq.isChecked()), "чёткая печать по умолчанию выключена");
    await hq.check();
    await page.waitForTimeout(200);
    ok(
      (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-hq"))) === "1",
      "после включения mxw01-usb-hq = 1"
    );

    // TSPL: поля плотности/скорости с рабочими значениями BP21 (8 и 4)
    await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
    await page.waitForTimeout(200);
    const density = page.locator('[data-testid="usb-density"]');
    const speed = page.locator('[data-testid="usb-speed"]');
    ok((await density.count()) === 1, "поле «Плотность» (usb-density) для TSPL");
    ok((await speed.count()) === 1, "поле «Скорость» (usb-speed) для TSPL");
    ok((await density.inputValue()) === "8", "плотность по умолчанию 8 (BP21)");
    ok((await speed.inputValue()) === "4", "скорость по умолчанию 4 (BP21)");
    await density.fill("12");
    await speed.fill("2");
    await page.waitForTimeout(200);
    ok(
      (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-density"))) === "12",
      "mxw01-usb-density = 12 сохранён"
    );
    ok(
      (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-speed"))) === "2",
      "mxw01-usb-speed = 2 сохранён"
    );

    // Диагностика (транспорт USB, язык TSPL)
    async function openSettings() {
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
    await openSettings();
    await page.waitForTimeout(300);
    ok(
      (await page.getByText("Диагностика подключения", { exact: true }).count()) > 0,
      "секция «Диагностика подключения» открыта"
    );
    ok(
      (await page.getByText("WebUSB (bulk-out 512 Б)", { exact: true }).count()) > 0,
      "транспорт: WebUSB (bulk-out)"
    );
    ok(
      (await page.getByText("TSPL · этикетки", { exact: true }).count()) > 0,
      "язык команд: TSPL · этикетки"
    );
    ok(
      (await page.getByText(/40 × 30 mm/).count()) > 0,
      "размер этикетки в диагностике (40 × 30 mm)"
    );
    ok(
      (await page.getByText("Mock POS-58", { exact: true }).count()) > 1,
      "устройство: Mock POS-58 (и в шапке, и в диагностике)"
    );
    ok(
      (await page.getByText("Подключён", { exact: true }).count()) > 0,
      "статус: Подключён"
    );
    await page.screenshot({ path: path.join(WORK, "v141-diag-usb-tspl.png") });

    // Переключаем язык на ESC/POS — диагностика показывает ширину бумаги
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.locator('[data-testid="usb-lang"]').selectOption("escpos");
    await page.waitForTimeout(200);
    await openSettings();
    await page.waitForTimeout(300);
    ok(
      (await page.getByText("ESC/POS · чековые", { exact: true }).count()) > 0,
      "язык команд: ESC/POS · чековые"
    );
    ok(
      (await page.getByText(/58 мм \(384\)/).count()) > 0,
      "ширина бумаги: 58 мм (384)"
    );
    await page.screenshot({ path: path.join(WORK, "v141-diag-usb-escpos.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Перезагрузка: чёткая печать и настройки TSPL переживают reload
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await dismissBleWarning(page);
    ok(
      (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-hq"))) === "1",
      "после перезагрузки mxw01-usb-hq = 1"
    );
    ok(await page.locator('[data-testid="usb-hq"]').isChecked(), "чекбокс «Чёткая печать» включён после reload");

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ------------- Кейс 2: транспорт Bluetooth — прежняя диагностика ------------- */
  console.log("Кейс 2: диагностика при Bluetooth-транспорте");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      window.localStorage.setItem("mxw01-transport", "ble");
    });
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector(
          'header button[title="Настройки"], header button[title="Settings"]'
        );
        if (btn) btn.click();
      });
      try {
        await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 6000 });
        break;
      } catch {
        await page.waitForTimeout(700);
      }
    }
    await page.waitForTimeout(300);
    ok(
      (await page.getByText("Web Bluetooth LE (service ae30)", { exact: true }).count()) > 0,
      "транспорт: Web Bluetooth LE (service ae30)"
    );
    ok(
      (await page.getByText("mxw01-thermal-printer v0.1.0", { exact: true }).count()) > 0,
      "драйвер BLE: mxw01-thermal-printer v0.1.0"
    );
    ok(
      (await page.getByText("WebUSB (bulk-out 512 Б)", { exact: true }).count()) === 0,
      "USB-строк в диагностике нет при BLE-транспорте"
    );
    await page.screenshot({ path: path.join(WORK, "v141-diag-ble.png") });

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  console.log(
    failures === 0
      ? "\nИТОГ: все проверки v141 пройдены ✓"
      : `\nИТОГ: упало проверок: ${failures}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
