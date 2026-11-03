/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.47 — печать с ВЕДУЩЕГО КРАЯ + обрезка пустых полей в обоих
 * режимах носителя и в ESC/POS (запрос: «все еще на некоторых генераторах
 * оно выплвывает 20см ленты, а так же когда я меняю инструменты то тоже
 * сначала выплевывает а потом печатает»).
 * Запуск: NODE_PATH=$(npm root -g) timeout 190 node scripts/v148-leading-feed.js
 *
 * Кейсы:
 *   1. Картинка с полями, режим «С зазором» (дефолт): поля ОБРЕЗАНЫ и в gap —
 *      SIZE 40 mm,20 mm, BITMAP 0,0,40,160,0 (в v1.0.46 обрезка была только
 *      в «Непрерывной ленте»);
 *   2. Минимум высоты (labelH 60 мм при контенте 20 мм): BITMAP y = 320 —
 *      контент у ВЕДУЩЕГО края (печатается сразу), запас длины — после;
 *      раньше y = 0 и весь запас (40 мм) протягивался ПУСТЫМ до картинки;
 *   3. ESC/POS: GS v 0 растр 160 строк (поля обрезаны с 384), ширина 48 байт;
 *   4. Лента с фиксированной этикеткой 90 мм и разделителем («генераторы»):
 *      пустой хвост страницы обрезан (BITMAP несколько строк), контент у
 *      ведущего края (y + rows = 240); в continuous — SIZE 1 мм;
 *   5. Подсказка gap-режима советует «Непрерывную ленту» для рулона;
 *   6. Консоль без ошибок.
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

/** Мок navigator.usb: transferOut пишет в window.__usbLog (как в v141–v147) */
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

/** x,y,wBytes,rows из команды BITMAP TSPL */
function bitmapHeader(stream) {
  const m = /BITMAP (\d+),(\d+),(\d+),(\d+),0,/.exec(stream);
  return m
    ? { x: Number(m[1]), y: Number(m[2]), wBytes: Number(m[3]), rows: Number(m[4]) }
    : null;
}

(async () => {
  const errors = [];
  const browser = await chromium.launch();

  /* ---------- Кейсы 1–3, 5: вкладка «Изображение», дефолтные настройки ---------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(usbMockInit);
    await collectErrors(page, errors);
    try {
      await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => (document.body?.innerText || "").length > 200, undefined, { timeout: 20000 });
      try { await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 4000 }); } catch {}

      await page.getByRole("button", { name: "Показать доп. вкладки" }).click();
      await page.waitForTimeout(300);
      await page.getByRole("tab", { name: /Изображение/ }).click();
      await page.waitForTimeout(300);

      // Картинка 192×192: белые поля по 48 px, чёрная полоса 96 px в середине
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
      const paddedPath = path.join(WORK, "v148-padded-192x192.png");
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

      await connectMock(page);
      await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
      await page.waitForTimeout(300);

      // --- Кейс 1: gap-режим — поля обрезаны и здесь (v1.0.47), минимум 30 мм работает ---
      const gapStream = await printAndRead(page);
      ok(/GAP 2 mm,0 mm/.test(gapStream), "Gap-режим: GAP 2 mm,0 mm (дефолт)");
      ok(/SIZE 40 mm,30 mm/.test(gapStream), `Gap-режим: SIZE 40 mm,30 mm (минимум высоты для этикеток, как раньше), получено ${/SIZE [^\r\n]+/.exec(gapStream)?.[0]}`);
      const bm1 = bitmapHeader(gapStream);
      ok(!!bm1 && bm1.rows === 160, `Gap-режим: BITMAP 160 рядов — поля обрезаны и в gap (было 320), получено ${bm1?.rows}`);
      ok(!!bm1 && bm1.y === 80 && bm1.y + bm1.rows === 240, `Gap-режим: y = 80, y + rows = 240 — контент у ведущего края, печать сразу (было y = 0 → 20 мм пустой протяжки), получено ${bm1?.y}`);

      // --- Кейс 5: подсказка gap-режима советует «Непрерывную ленту» (пока lang = tspl) ---
      const hint = (await page.locator('[data-testid="usb-label-auto-hint"]').textContent()) || "";
      ok(/Непрерывная лента/.test(hint), `Подсказка gap-режима упоминает «Непрерывную ленту» (получено «${hint.slice(0, 44)}…»)`);

      // --- Кейс 2: минимум высоты 60 мм — контент у ведущего края ---
      await page.locator('[data-testid="usb-label-h"]').fill("60");
      await page.waitForTimeout(300);
      const gap60 = await printAndRead(page);
      ok(/SIZE 40 mm,60 mm/.test(gap60), `Минимум 60 мм: SIZE 40 mm,60 mm, получено ${/SIZE [^\r\n]+/.exec(gap60)?.[0]}`);
      const bm2 = bitmapHeader(gap60);
      ok(!!bm2 && bm2.y === 480 - 160, `Минимум 60 мм: BITMAP y = 320 (ведущий край — печать сразу; было y=0 → 40 мм пустой протяжки), получено ${bm2?.y}`);
      ok(!!bm2 && bm2.y + bm2.rows === 480, "Минимум 60 мм: y + rows = 480 точек (края этикетки)");
      await page.locator('[data-testid="usb-label-h"]').fill("30");
      await page.waitForTimeout(300);

      // --- Кейс 3: ESC/POS — поля обрезаны (384→160 строк) ---
      await page.locator('[data-testid="usb-lang"]').selectOption("escpos");
      await page.waitForTimeout(300);
      const esc = await printAndRead(page);
      const escHeader = await page.evaluate(() => {
        const all = window.__usbLog.flat();
        // GS v 0 уходит чанками по 64 строки (chunkRows) — суммируем высоты
        let rows = 0;
        let bytesPerRow = 0;
        for (let i = 0; i < all.length - 8; i++) {
          if (all[i] === 0x1d && all[i + 1] === 0x76 && all[i + 2] === 0x30 && all[i + 3] === 0x00) {
            bytesPerRow = all[i + 4] + 256 * all[i + 5];
            rows += all[i + 6] + 256 * all[i + 7];
            i += 8;
          }
        }
        return { bytesPerRow, rows };
      });
      ok(!!escHeader && escHeader.bytesPerRow > 0, "ESC/POS: заголовок GS v 0 найден");
      ok(escHeader.bytesPerRow === 48, `ESC/POS: ширина 48 байт (384 точки), получено ${escHeader.bytesPerRow}`);
      ok(escHeader.rows === 192, `ESC/POS: суммарно 192 строки (поля обрезаны с 384; растр 1:1 384 px, в отличие от TSPL 320), получено ${escHeader.rows}`);

      await context.close();
    } catch (e) {
      failures += 1;
      console.error("  ✗ исключение (кейсы 1–3,5):", e.message?.slice(0, 300));
      await context.close().catch(() => {});
    }
  }

  /* ---------- Кейс 4: лента, фиксированная этикетка 90 мм + разделитель ---------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      // Фиксированная этикетка 90 мм (пресет «Настроек → Этикетка»)
      window.localStorage.setItem("mxw01-label-size", JSON.stringify({ mode: "fixed", heightMm: 90 }));
      // Один разделитель: страница 90 мм, контент — линия 2 px, остальное — пустой хвост
      window.localStorage.setItem(
        "mxw01-text-fields",
        JSON.stringify([
          { id: "d1", kind: "divider", x: 0, y: 0, width: 384, thickness: 2, style: "solid", height: 2 },
        ])
      );
    });
    await page.addInitScript(usbMockInit);
    await collectErrors(page, errors);
    try {
      await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => (document.body?.innerText || "").length > 200, undefined, { timeout: 20000 });
      try { await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 4000 }); } catch {}
      await page.waitForTimeout(500);

      await connectMock(page);
      await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
      await page.waitForTimeout(300);
      const stream = await printAndRead(page);
      ok(/SIZE 40 mm,30 mm/.test(stream), `Фикс-лента: SIZE 40 mm,30 mm (минимум USB-настройки), получено ${/SIZE [^\r\n]+/.exec(stream)?.[0]}`);
      const bm = bitmapHeader(stream);
      ok(!!bm && bm.rows < 50, `Фикс-лента: пустой хвост страницы (90 мм) ОБРЕЗАН — BITMAP ${bm?.rows} рядов вместо 720`);
      ok(!!bm && bm.y + bm.rows === 240, `Фикс-лента: контент у ведущего края — y + rows = 240 (получено y=${bm?.y}, rows=${bm?.rows})`);

      // Continuous: длина ровно по разделителю (≤ 8 рядов → 1 мм)
      await page.locator('[data-testid="usb-media"]').selectOption("continuous");
      await page.waitForTimeout(300);
      const cont = await printAndRead(page);
      ok(/GAP 0 mm,0 mm/.test(cont), "Фикс-лента continuous: GAP 0 mm,0 mm");
      ok(/SIZE 40 mm,1 mm/.test(cont), `Фикс-лента continuous: SIZE 40 mm,1 мм — только линия, получено ${/SIZE [^\r\n]+/.exec(cont)?.[0]}`);
      await page.screenshot({ path: path.join(WORK, "v148-leading-feed.png"), fullPage: false });
      await context.close();
    } catch (e) {
      failures += 1;
      console.error("  ✗ исключение (кейс 4):", e.message?.slice(0, 300));
      await context.close().catch(() => {});
    }
  }

  ok(errors.length === 0, "консоль без ошибок");
  if (errors.length) errors.slice(0, 8).forEach((e) => console.error("    -", e.slice(0, 200)));

  await browser.close();
  console.log(failures === 0 ? "\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `\nПРОВАЛОВ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
