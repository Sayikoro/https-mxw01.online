/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.44 — «Масштаб» картинки на вкладке «Изображение» +
 * минимальные поля слева/справа (запрос: «сделаем слева и справа минимальные
 * отступы… давай масштаб добавим картинке»).
 * Запуск: NODE_PATH=$(npm root -g) timeout 190 node scripts/v145-image-scale.js
 *
 * Кейсы:
 *   1. Дефолт 100%: превью 384 px ширины, чёрный контент-исходник 192×128
 *      растянут на ВСЮ ширину печати (тёмные пиксели x≈0…383) — белые поля
 *      слева/справа исчезли;
 *   2. Масштаб 50% (слайдер): контент ≈192 px ПО ЦЕНТРУ ленты (x≈96…287),
 *      подпись слайдера «50%», «В ряд» у копий стал доступен;
 *   3. Печать по USB (TSPL, этикетка 40 мм): BITMAP 0,0,40,H — холст 384
 *      → 320 точек, поля в потоке — белые точки (печать = превью);
 *   4. Консоль без ошибок.
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

/** Мок navigator.usb: transferOut пишет в window.__usbLog (как в v141–v143) */
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

/** Диапазон тёмных пикселей по центру холста: {minX, maxX, dark} */
function darkSpan(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas[style*="pixelated"]');
    if (!c) return null;
    const ctx = c.getContext("2d");
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = -1;
    let maxX = -1;
    let dark = 0;
    for (let y = Math.floor(c.height * 0.25); y < c.height * 0.75; y++) {
      for (let x = 0; x < c.width; x++) {
        const p = (y * c.width + x) * 4;
        if (img[p] < 128) {
          dark += 1;
          if (minX < 0 || x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    return { w: c.width, h: c.height, minX, maxX, dark };
  });
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

    // --- Вкладка «Изображение» (спрятана за стрелкой «Показать доп. вкладки») ---
    await page.getByRole("button", { name: "Показать доп. вкладки" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("tab", { name: /Изображение/ }).click();
    await page.waitForTimeout(400);

    // Кейс-исходник: чёрный 192×128 (уже ленты — раньше дал бы белые поля)
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 192;
      c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = "#000000";
      x.fillRect(0, 0, 192, 128);
      return c.toDataURL("image/png");
    });
    const tmp = path.join(WORK, "v145-source-192.png");
    fs.writeFileSync(tmp, Buffer.from(dataUrl.split(",")[1], "base64"));
    await page.setInputFiles('input[type="file"][accept="image/*"]', tmp);
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas[style*="pixelated"]');
        return c && c.width > 0 && c.height > 0;
      },
      undefined,
      { timeout: 10000 }
    );

    // Кейс 1: дефолт 100% — контент на всю ширину, поля минимальные
    const s1 = await darkSpan(page);
    ok(!!s1 && s1.w === 384, `превью 384 px ширины (получено ${s1?.w})`);
    ok(!!s1 && s1.minX <= 2, `100%: контент от левого края (minX=${s1?.minX})`);
    ok(!!s1 && s1.maxX >= 381, `100%: контент до правого края (maxX=${s1?.maxX})`);
    ok(!!s1 && s1.h === 256, `100%: высота 256 (192×128 растянута до 384×256), получено ${s1?.h}`);

    // Кейс 2: слайдер «Масштаб» → 50% (4-й слайдер панели; шаг 5, 10 нажатий)
    const thumb = page.locator('[role="slider"]').nth(3);
    await thumb.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    const bodyText = await page.evaluate(() => document.body.innerText);
    ok(/Масштаб\s*\n?\s*50%/.test(bodyText) || bodyText.includes("50%"), "подпись слайдера «Масштаб 50%»");
    const s2 = await darkSpan(page);
    ok(!!s2 && s2.w === 384, "50%: холст по-прежнему 384 px (лента)");
    ok(!!s2 && s2.minX >= 90 && s2.minX <= 102, `50%: контент начинается ≈96 (minX=${s2?.minX})`);
    ok(!!s2 && s2.maxX >= 281 && s2.maxX <= 293, `50%: контент заканчивается ≈287 (maxX=${s2?.maxX})`);
    ok(!!s2 && s2.maxX - s2.minX + 1 <= 200, "50%: поля слева и справа симметричны");

    // «В ряд» стал доступен при копиях > 1
    await page.locator('button[title="Больше копий"]').click();
    await page.waitForTimeout(200);
    const rowBtn = page.getByRole("button", { name: "В ряд", exact: true });
    ok(await rowBtn.count() > 0 && (await rowBtn.isEnabled()), "50%: «В ряд» доступен");

    // Кейс 3: печать по USB (TSPL) — холст 384 → BITMAP 40 байт (320 точек)
    await connectMock(page);
    await page.locator('[data-testid="usb-lang"]').selectOption("tspl");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Печать", exact: true }).click();
    await page.waitForFunction(() => window.__usbLog && window.__usbLog.length > 0, undefined, { timeout: 20000 });
    await page.waitForTimeout(400);
    const stream = await page.evaluate(() =>
      window.__usbLog.flat().map((b) => String.fromCharCode(b)).join("")
    );
    ok(/SIZE 40 mm,\d+ mm/.test(stream), "TSPL: SIZE 40 mm,..");
    // v1.0.47: растр прижат к ВЕДУЩЕМУ краю этикетки — y + rows = labelPxH.
    // Ширина по-прежнему 40 байт (320 точек этикетки 40 мм)
    const bm145 = /BITMAP 0,(\d+),40,(\d+),0,/.exec(stream);
    ok(!!bm145 && Number(bm145[1]) + Number(bm145[2]) === 240, `TSPL: BITMAP у ведущего края — y + rows = 240 (получено ${bm145 ? `y=${bm145[1]}, rows=${bm145[2]}` : "нет BITMAP"})`);
    ok(!!bm145, "TSPL: BITMAP шириной 40 байт (320 точек)");

    await page.screenshot({ path: path.join(WORK, "v145-image-scale.png"), fullPage: false });
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
