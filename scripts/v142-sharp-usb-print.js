/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.42 — чёткая печать бинарного контента по USB (чеки как
 * картинки): детекция строго ч/б источника → дизеринг выключен, ресемпл
 * без размазни (box+порог при уменьшении, nearest при увеличении).
 * Запуск: NODE_PATH=$(npm root -g) timeout 170 node scripts/v142-sharp-usb-print.js
 *
 * Кейсы (разводка e2e; чёткость растра доказана юнит-тестами usb-raster):
 *   1. TSPL, этикетка 40 мм (320 точек): печать с «Текста» → BITMAP 0,0,40,H
 *      (384→320 даунскейл), SIZE — авто-высота, поток валиден;
 *   2. TSPL, этикетка 48 мм (384 точки): BITMAP 0,0,48,H — растр 1:1;
 *   3. ESC/POS, бумага 80 мм (576): GS v 0 c 54 байта/строку (432 точки —
 *      v1.0.45: растр POS не шире головки BP21 54 мм · 203/25.4);
 *      бумага 58 мм: 48 байт/строку (1:1 — кейс v133 не сломан).
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

/** Мок navigator.usb: transferOut пишет в window.__usbLog */
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

/** Склеить все передачи bulk-out в один массив байт */
async function flatLog(page) {
  return page.evaluate(() => window.__usbLog.flat());
}

/** Найти подпоследовательность */
function hasSubseq(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Распарсить TSPL-поток: вернуть { widthBytes, height, raster, y } первого
 * BITMAP (формат «BITMAP x,y,widthBytes,height,mode,» + данные).
 * v1.0.47: y больше не 0 — растр прижат к ведущему краю (y = labelPxH − rows).
 */
function parseTsplBitmap(bytes) {
  const head = Buffer.from(bytes.slice(0, 400)).toString("latin1");
  const m = head.match(/BITMAP 0,(\d+),(\d+),(\d+),0,/);
  if (!m) return null;
  const y = Number(m[1]);
  const widthBytes = Number(m[2]);
  const height = Number(m[3]);
  const cmdEnd = head.indexOf(m[0]) + m[0].length;
  const raster = bytes.slice(cmdEnd, cmdEnd + widthBytes * height);
  return { y, widthBytes, height, raster };
}

/** Смещение сразу после первой команды PRINT 1,1 (отрезать первую печать) */
function tailAfterFirstPrint(bytes) {
  const s = Buffer.from(bytes).toString("latin1");
  const i = s.indexOf("PRINT 1,1\r\n");
  return i >= 0 ? i + 11 : 0;
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

async function main() {
  const browser = await chromium.launch();

  /* ------- Кейс 1+2: TSPL, даунскейл 40 мм и 1:1 при 48 мм ------- */
  console.log("Кейс 1/2: TSPL — этикетка 40 мм (даунскейл) и 48 мм (1:1)");
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

    await printFromTextTab(page);
    const flat = await flatLog(page);
    ok(flat.length > 200, `TSPL-поток получен (${flat.length} байт)`);
    const bmp = parseTsplBitmap(flat);
    ok(bmp !== null, "в потоке есть команда BITMAP 0,y,W,H,0, (v1.0.47: y = labelPxH − rows)");
    ok(
      bmp && bmp.widthBytes === 40,
      `BITMAP шириной 40 байт = 320 точек (384→320)`,
      bmp && String(bmp.widthBytes)
    );
    ok(bmp && bmp.height > 8, `высота растра > 8 строк (${bmp && bmp.height})`);
    ok(
      bmp && bmp.raster.length === bmp.widthBytes * bmp.height,
      "данные BITMAP целиком в потоке (40·H байт)"
    );
    await page.screenshot({ path: path.join(WORK, "v142-tspl-40.png") });

    // Этикетка 48 мм → растр 384 (1:1), BITMAP 48 байт
    await page.locator('[data-testid="usb-label-w"]').fill("48");
    await page.waitForTimeout(250);
    await printFromTextTab(page);
    const flat2 = await flatLog(page);
    const bmp2 = parseTsplBitmap(flat2.slice(tailAfterFirstPrint(flat)));
    ok(
      bmp2 !== null && bmp2.widthBytes === 48,
      "этикетка 48 мм: BITMAP 48 байт (384 точки, 1:1)"
    );
    await page.screenshot({ path: path.join(WORK, "v142-tspl-48.png") });

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ------- Кейс 3: ESC/POS — бумага 80 мм (576) и 58 мм (384) ------- */
  console.log("Кейс 3: ESC/POS — 576 (384→576) и 384 (1:1)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(usbMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await connectMock(page);
    // язык остаётся escpos (дефолт); ширина бумаги 80 мм
    await page.locator('[data-testid="usb-width"]').selectOption("576");
    await page.waitForTimeout(250);

    await printFromTextTab(page);
    const flat = await flatLog(page);
    ok(flat.length > 200, `ESC/POS-поток получен (${flat.length} байт)`);
    ok(
      hasSubseq(flat, [0x1d, 0x76, 0x30, 0x00, 0x36, 0x00]),
      "GS v 0 с 54 байта/строку (432 точки — v1.0.45: не шире головки BP21 54 мм)"
    );

    // 58 мм: 48 байт/строку (кейс v133 не сломан)
    await page.locator('[data-testid="usb-width"]').selectOption("384");
    await page.waitForTimeout(250);
    await printFromTextTab(page);
    const flat2 = await flatLog(page);
    ok(
      hasSubseq(flat2, [0x1d, 0x76, 0x30, 0x00, 0x30, 0x00]),
      "GS v 0 с 48 байт/строку (384, 1:1 — прежнее поведение)"
    );
    await page.screenshot({ path: path.join(WORK, "v142-escpos.png") });

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  console.log(
    failures === 0
      ? "\nИТОГ: все проверки v142 пройдены ✓"
      : `\nИТОГ: упало проверок: ${failures}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
