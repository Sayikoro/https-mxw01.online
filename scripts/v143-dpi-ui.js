/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.43 — «Разрешение печати (DPI)» в настройках: пресеты
 * 203/300/600, влияние на растеризацию TSPL (точек на мм) и строку
 * «Разрешение» в «Диагностике подключения». ESC/POS от DPI не зависит
 * (растр всегда подгоняется под ширину головки).
 * Запуск: NODE_PATH=$(npm root -g) timeout 190 node scripts/v143-dpi-ui.js
 *
 * Кейсы:
 *   1. Дефолт 203 dpi: бейдж активен, mxw01-usb-dpi пуст, в диагностике
 *      «203 dpi»; печать TSPL 40 мм → BITMAP 0,0,40,H (320 точек — как в v142);
 *   2. Выбор 300 dpi: localStorage = 300, в диагностике «300 dpi», подпись
 *      «11.8 точек/мм»; печать 40 мм → BITMAP шириной 59/60 байт (≈473 точки);
 *      после перезагрузки 300 dpi сохранён;
 *   3. ESC/POS при 300 dpi: GS v 0 по-прежнему 48 байт/строку (384, DPI не
 *      влияет), в диагностике «300 dpi» + «58 мм (384)».
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

/** Мок navigator.usb: transferOut пишет в window.__usbLog (как в v141/v142) */
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

async function flatLog(page) {
  return page.evaluate(() => window.__usbLog.flat());
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

async function printFromTextTab(page) {
  const printBtn = page.getByRole("button", { name: "Печать", exact: true });
  await printBtn.click();
  await page.waitForFunction(() => window.__usbLog && window.__usbLog.length > 0, undefined, {
    timeout: 20000,
  });
  await page.waitForTimeout(400);
}

async function openSettings(page) {
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

/** Распарсить TSPL-поток: { widthBytes, height, y } первого BITMAP (v1.0.47: y — ведущий край) */
function parseTsplBitmap(bytes) {
  const head = Buffer.from(bytes.slice(0, 400)).toString("latin1");
  const m = head.match(/BITMAP 0,(\d+),(\d+),(\d+),0,/);
  if (!m) return null;
  return { y: Number(m[1]), widthBytes: Number(m[2]), height: Number(m[3]) };
}

/** Смещение сразу после первой команды PRINT 1,1 (отрезать первую печать) */
function tailAfterFirstPrint(bytes) {
  const s = Buffer.from(bytes).toString("latin1");
  const i = s.indexOf("PRINT 1,1\r\n");
  return i >= 0 ? i + 11 : 0;
}

async function main() {
  const browser = await chromium.launch();

  /* ------- Кейс 1: дефолт 203 dpi, TSPL 40 мм → 320 точек ------- */
  console.log("Кейс 1: дефолт 203 dpi — бейдж, диагностика, BITMAP 40 байт");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(usbMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await connectMock(page);
    ok(true, "мок-принтер подключён (Mock POS-58)");

    await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
    await page.locator('[data-testid="usb-label-w"]').fill("40");
    await page.waitForTimeout(250);

    // Настройки: бейдж 203 активен, 300/600 — нет; ключ в localStorage ещё пуст
    await openSettings(page);
    await page.waitForTimeout(300);
    ok(
      (await page.locator('[data-testid="usb-dpi-203"]').getAttribute("aria-pressed")) === "true",
      "бейдж 203 активен по умолчанию"
    );
    ok(
      (await page.locator('[data-testid="usb-dpi-300"]').getAttribute("aria-pressed")) === "false",
      "бейдж 300 неактивен по умолчанию"
    );
    ok(
      (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-dpi"))) === null,
      "mxw01-usb-dpi ещё не записан (дефолт без записи)"
    );
    const diagDpi = page.locator('[data-testid="diag-usb-dpi"]');
    ok((await diagDpi.innerText()).includes("203"), `в диагностике «203 dpi» (${await diagDpi.innerText()})`);
    await page.screenshot({ path: path.join(WORK, "v143-dpi-203.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await printFromTextTab(page);
    const flat = await flatLog(page);
    const bmp = parseTsplBitmap(flat);
    ok(bmp !== null && bmp.widthBytes === 40, `TSPL 203 dpi: BITMAP 40 байт = 320 точек (${bmp && bmp.widthBytes})`);
    await ctx.close();
  }

  /* ------- Кейс 2: 300 dpi → ≈473 точки, сохранение после reload ------- */
  console.log("Кейс 2: 300 dpi — BITMAP ≈473 точки, диагностика, персистентность");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(usbMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await connectMock(page);
    await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
    await page.locator('[data-testid="usb-label-w"]').fill("40");
    await page.waitForTimeout(250);

    await openSettings(page);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="usb-dpi-300"]').click();
    await page.waitForTimeout(200);
    ok(
      (await page.evaluate(() => window.localStorage.getItem("mxw01-usb-dpi"))) === "300",
      "выбор 300 dpi записан в mxw01-usb-dpi"
    );
    const diagDpi = page.locator('[data-testid="diag-usb-dpi"]');
    ok((await diagDpi.innerText()).includes("300"), `в диагностике «300 dpi» (${await diagDpi.innerText()})`);
    ok(
      (await page.getByText(/11\.8 точек\/мм/).count()) > 0,
      "подпись пересчёта: 11.8 точек/мм"
    );
    await page.screenshot({ path: path.join(WORK, "v143-dpi-300.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await printFromTextTab(page);
    const flat = await flatLog(page);
    const bmp = parseTsplBitmap(flat);
    ok(
      bmp !== null && (bmp.widthBytes === 59 || bmp.widthBytes === 60),
      `TSPL 300 dpi: BITMAP ≈473 точки → 59/60 байт (${bmp && bmp.widthBytes})`
    );
    ok(bmp !== null && bmp.widthBytes !== 40, "ширина растра изменилась относительно 203 dpi");

    // Перезагрузка: 300 dpi восстановлен из localStorage (без подключения)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await dismissBleWarning(page);
    await openSettings(page);
    await page.waitForTimeout(300);
    ok(
      (await page.locator('[data-testid="usb-dpi-300"]').getAttribute("aria-pressed")) === "true",
      "после перезагрузки бейдж 300 активен"
    );
    ok(
      (await page.locator('[data-testid="diag-usb-dpi"]').innerText()).includes("300"),
      "в диагностике после reload «300 dpi»"
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ------- Кейс 3: ESC/POS не зависит от DPI (48 байт/строку) ------- */
  console.log("Кейс 3: ESC/POS при 300 dpi — GS v 0 по-прежнему 384 точки");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(usbMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await connectMock(page);
    // язык escpos (дефолт), бумага 58 мм (384)
    await openSettings(page);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="usb-dpi-300"]').click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await printFromTextTab(page);
    const flat = await flatLog(page);
    const gs = flat.findIndex((b, i) =>
      b === 0x1d && flat[i + 1] === 0x76 && flat[i + 2] === 0x30 && flat[i + 3] === 0x00
    );
    ok(gs >= 0, "GS v 0 в потоке ESC/POS");
    ok(
      gs >= 0 && flat[gs + 4] === 0x30 && flat[gs + 5] === 0x00,
      "ширина строки 48 байт = 384 точки (DPI на ESC/POS не влияет)"
    );

    await openSettings(page);
    await page.waitForTimeout(300);
    ok(
      (await page.locator('[data-testid="diag-usb-dpi"]').innerText()).includes("300"),
      "в диагностике «300 dpi» (строка есть и для ESC/POS)"
    );
    ok(
      (await page.getByText(/58 мм \(384\)/).count()) > 0,
      "ширина бумаги: 58 мм (384)"
    );
    await page.screenshot({ path: path.join(WORK, "v143-escpos-dpi.png") });

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  console.log(
    failures === 0
      ? "\nИТОГ: все проверки v143 пройдены ✓"
      : `\nИТОГ: упало проверок: ${failures}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
