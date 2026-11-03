/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.45 — плотность POS-ветки от характеристик принтера
 * (запрос: «для BLE расчитывать плотность пикселей как щас считаем,
 * а для POS и так далее по другому. Для BP21: 203 dpi = 8 точек/мм,
 * макс. ширина печати 54 мм, ширина в точках 54 × (203/25.4) = 432»).
 * Запуск: NODE_PATH=$(npm root -g) timeout 190 node scripts/v146-pos-density.js
 *
 * Кейсы:
 *   1. Настройки (USB): подпись «Головка: 432 точки · 54 мм» при 203 dpi;
 *      клик 300 → «638 точек», возврат на 203;
 *   2. Диагностика подключения: строка «Ширина печати» = 432 точки · 54 мм;
 *   3. TSPL с этикеткой 60 мм (> головки): в потоке SIZE 54 mm (не 60!),
 *      BITMAP 0,0,48,H — растр 384 точки ≤ 432;
 *   4. ESC/POS с бумагой 576: растр ужимается до головки — xL = 54 байта
 *      (432 точки); бумага 384 остаётся 48 байт (WYSIWYG с превью);
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

/** Мок navigator.usb: transferOut пишет в window.__usbLog (как в v141–v145) */
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

    // Контент для печати: чёрный 192×128 на вкладке «Изображение»
    await page.getByRole("button", { name: "Показать доп. вкладки" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("tab", { name: /Изображение/ }).click();
    await page.waitForTimeout(300);
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 192;
      c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = "#000000";
      x.fillRect(0, 0, 192, 128);
      return c.toDataURL("image/png");
    });
    const tmp = path.join(WORK, "v146-source-192.png");
    fs.writeFileSync(tmp, Buffer.from(dataUrl.split(",")[1], "base64"));
    await page.setInputFiles('input[type="file"][accept="image/*"]', tmp);
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas[style*="pixelated"]');
        return c && c.width > 0;
      },
      undefined,
      { timeout: 10000 }
    );

    await connectMock(page);

    // --- Кейс 3: TSPL, этикетка 60 мм (шире головки 54 мм) → SIZE 54 mm ---
    await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
    await page.locator('[data-testid="usb-label-w"]').fill("60");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Печать", exact: true }).click();
    await page.waitForFunction(() => window.__usbLog && window.__usbLog.length > 0, undefined, { timeout: 20000 });
    await page.waitForTimeout(400);
    const tspl = await readStream(page);
    ok(/SIZE 54 mm,/.test(tspl), `TSPL 60 мм: SIZE 54 mm (ужата до головки): ${/SIZE [^\\r\\n]+/.exec(tspl)?.[0]}`);
    ok(!/SIZE 60 mm/.test(tspl), "TSPL: SIZE 60 mm отсутствует (старое поведение ушло)");
    ok(/BITMAP 0,0,48,/.test(tspl), "TSPL: BITMAP 0,0,48,H — 384 точки ≤ 432 головки");

    // --- Кейс 4: ESC/POS, бумага 576 → головка 432 (54 байта/строку) ---
    await page.evaluate(() => { window.__usbLog.length = 0; });
    await page.locator('[data-testid="usb-lang"]').selectOption("escpos");
    await page.locator('[data-testid="usb-width"]').selectOption("576");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Печать", exact: true }).click();
    await page.waitForFunction(() => window.__usbLog && window.__usbLog.length > 0, undefined, { timeout: 20000 });
    await page.waitForTimeout(400);
    let raw = await page.evaluate(() => window.__usbLog.flat());
    // ESC @ (1b 40) затем GS v 0 (1d 76 30 00) xL xH
    const i0 = raw.findIndex((b, i) => b === 0x1b && raw[i + 1] === 0x40 && raw[i + 2] === 0x1d);
    ok(i0 >= 0, "ESC/POS: найден заголовок ESC @ + GS v 0");
    ok(raw[i0 + 5] === 0x00 && raw[i0 + 6] === 54 && raw[i0 + 7] === 0,
      `ESC/POS 576: растр ${raw[i0 + 6]}×256+${raw[i0 + 7]} → xL=54 (432 точки)`);
    ok(raw[i0 + 6] !== 72, "ESC/POS: xL ≠ 72 (576 точек больше не уходят в головку BP21)");

    // --- Кейс 4b: бумага 384 — WYSIWYG не изменился (48 байт) ---
    await page.evaluate(() => { window.__usbLog.length = 0; });
    await page.locator('[data-testid="usb-width"]').selectOption("384");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Печать", exact: true }).click();
    await page.waitForFunction(() => window.__usbLog && window.__usbLog.length > 0, undefined, { timeout: 20000 });
    await page.waitForTimeout(400);
    raw = await page.evaluate(() => window.__usbLog.flat());
    const j0 = raw.findIndex((b, i) => b === 0x1b && raw[i + 1] === 0x40 && raw[i + 2] === 0x1d);
    ok(raw[j0 + 6] === 48 && raw[j0 + 7] === 0,
      `ESC/POS 384: xL=48 (384 точки — как раньше, WYSIWYG с превью), получено ${raw[j0 + 6]}`);

    // --- Кейс 1+2: настройки и диагностика ---
    await page.locator('header button[title="Настройки"], header button[title="Settings"]').first().click();
    await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 5000 });
    const dlg = page.locator('[role="dialog"][data-state="open"]');
    await page.waitForTimeout(500);
    const headLine = (await dlg.locator('[data-testid="usb-head-dots"]').textContent()) || "";
    ok(/Головка:\s*432\s*точки\s*·\s*54\s*мм/.test(headLine),
      `Настройки 203 dpi: «Головка: 432 точки · 54 мм» (получено: «${headLine.trim()}»)`);
    const diagHead = (await dlg.locator('[data-testid="diag-usb-head"]').textContent()) || "";
    ok(/432\s*точки\s*·\s*54\s*мм/.test(diagHead),
      `Диагностика: «Ширина печати 432 точки · 54 мм» (получено: «${diagHead.trim()}»)`);
    // DPI 300 → головка 638 точек (54 × 300/25.4 = 637.8)
    await dlg.locator('[data-testid="usb-dpi-300"]').click();
    await page.waitForTimeout(400);
    const diagHead300 = (await dlg.locator('[data-testid="diag-usb-head"]').textContent()) || "";
    ok(/638\s*точек\s*·\s*54\s*мм/.test(diagHead300),
      `Диагностика 300 dpi: «638 точек · 54 мм» (получено: «${diagHead300.trim()}»)`);
    await dlg.locator('[data-testid="usb-dpi-203"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(WORK, "v146-pos-density.png"), fullPage: false });
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
