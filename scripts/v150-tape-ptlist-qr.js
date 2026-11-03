/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка v1.0.49 «Блок „Ценник“ в ленте = вкладка „Ценник“: шорткод {qr}, центр».
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v150-tape-ptlist-qr.js
 * Сервер: http://localhost:3000 (bun run dev).
 *
 * Чеки:
 *  1. блок «Ценник» на ленте: панель «Вставить:» содержит 6 чипов, включая {qr};
 *  2. поле QR блока + строка {qr} → QR отрисован на холсте страницы;
 *  3. QR центрирован по ширине ленты (bbox тёмных пикселей);
 *  4. пустое поле QR + строка {qr} → блок не рисуется (холст чистый);
 *  5. консоль чистая.
 *
 * Рендер у блока общий с вкладкой (tape-pricetag.ts → renderPricetagToCanvas),
 * здесь проверяется СЦЕПКА UI ленты (чипы/поля) с этим рендерером.
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const consoleErrors = [];
const NOISE = /yandex\.net|ERR_CERT_AUTHORITY_INVALID/i;

function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

async function closeOverlays(page) {
  for (let i = 0; i < 6; i++) {
    const dialog = page.locator('[role="dialog"][data-state="open"]');
    if ((await dialog.count()) > 0) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
      continue;
    }
    const cookieBtn = page.locator("button", { hasText: /принять|accept/i }).first();
    if ((await cookieBtn.count()) > 0 && (await cookieBtn.isVisible().catch(() => false))) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }
    break;
  }
}

/** Статистика ТЁМНО-ЧЁРНЫХ пикселей (порог по всем каналам — отсекает синюю рамку выделения) */
const SCAN = () => {
  const cs = [...document.querySelectorAll("canvas")].filter(
    (c) => c.offsetParent !== null && c.width > 100
  );
  const c = cs[0];
  if (!c) return null;
  const ctx = c.getContext("2d");
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;
  let dark = 0;
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) {
        dark++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { W, H, dark, minX, maxX, minY, maxY, cx: (minX + maxX) / 2 };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));

  await page.addInitScript(() => {
    window.localStorage.setItem("mxw01-lang", "ru");
  });
  await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await closeOverlays(page);

  // Вкладка «Лента» + блок «Ценник» (карточка раскрывается автоматически)
  await page.getByRole("tab", { name: /Лента/ }).click();
  await page.waitForTimeout(600);
  // Базовая линия: графика самой страницы (пустая лента) — вычитается далее
  const baseline = await page.evaluate(SCAN);
  const baselineDark = baseline ? baseline.dark : -1;
  console.log(`    (базовая линия пустой страницы: ${baselineDark} тёмных px)`);
  await page.locator('button[aria-label="Ценник"]').first().click();
  await page.waitForTimeout(600);

  // Раскрыть поля тега: строка «1. Товар — 100» (aria-expanded)
  const tagRow = page.locator('button[aria-expanded="false"]', { hasText: /^1\. / }).first();
  ok((await tagRow.count()) > 0, "Лента: карточка блока ценника добавлена (тег «1.» на месте)");
  await tagRow.click();
  await page.waitForTimeout(500);

  // Панель подстановок блока: 6 чипов, включая {qr}
  const insertRows = await page.locator("text=Вставить:").count();
  ok(insertRows === 1, "Лента: панель «Вставить:» только у блока ценника (вкладка размонтирована)");
  const chipQr = page.locator('button', { hasText: /^\{qr\}$/ });
  ok((await chipQr.count()) === 1, "Лента: чип {qr} присутствует в блоке ценника");
  const chips = await page.locator("text=Вставить:").first().locator("xpath=following-sibling::button").count();
  ok(chips === 6, `Лента: всего 6 чипов (факт: ${chips})`);

  // Данные товара: только QR-поле
  await page.locator('input[aria-label="QR-код"]').first().fill("TAPE-QR-123");
  await page.waitForTimeout(400);

  // Строки: единственная {qr}
  await page.locator('input[aria-label="Строка 1"]').first().fill("{qr}");
  const row2 = page.locator('div:has(> input[aria-label="Строка 2"]) button[aria-label="Удалить строку"]').first();
  if ((await row2.count()) > 0) {
    await row2.click();
    await page.waitForTimeout(300);
  }

  // Выключить рамку блока (создаётся с frame:true; иначе bbox = рамка,
  // и центр-проверка и «чистый холст» теряют смысл)
  const frameBtn = page.locator('button[title="Рамка вокруг ценника"]').first();
  ok((await frameBtn.count()) > 0, "Лента: тумблер рамки доступен");
  await frameBtn.click();
  await page.waitForTimeout(400);
  await page.waitForTimeout(600);

  // QR отрисован и центрирован
  const scan = await page.evaluate(SCAN);
  ok(!!scan && scan.dark > 2000, "Лента: QR отрисован на холсте страницы по строке {qr}");
  if (scan && scan.dark > 0) {
    const off = Math.abs(scan.cx - scan.W / 2);
    ok(off <= 8, `Лента: QR центрирован по ширине ленты (смещение ${off.toFixed(1)} px ≤ 8)`);
    ok(scan.maxY - scan.minY > scan.H * 0.2, "Лента: QR занимает значимую долю высоты (блок, не текст)");
  }

  // Пустое поле QR + строка {qr} → блок не добавляет ни пикселя к базовой графике страницы
  await page.locator('input[aria-label="QR-код"]').first().fill("");
  await page.waitForTimeout(600);
  const scanEmpty = await page.evaluate(SCAN);
  ok(!!scanEmpty && Math.abs(scanEmpty.dark - baselineDark) <= 50,
    `Лента: пустое поле QR + строка {qr} → блок не рисуется (${scanEmpty ? scanEmpty.dark : "?"} px ≈ базалину ${baselineDark})`);

  // Чип вставляет шорткод в строку
  await page.locator('input[aria-label="Строка 1"]').first().fill("");
  await page.locator('input[aria-label="Строка 1"]').first().click();
  await chipQr.first().click();
  await page.waitForTimeout(300);
  const lineVal = await page.locator('input[aria-label="Строка 1"]').first().inputValue();
  ok(lineVal === "{qr}", `Лента: чип {qr} вставил шорткод (значение: «${lineVal}»)`);

  await ctx.close();
  await browser.close();

  console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
  if (consoleErrors.length) {
    console.error("Ошибки консоли:");
    consoleErrors.forEach((e) => console.error("  " + e));
  }
  process.exit(failed || consoleErrors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
