/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка v1.0.49 «Ценник: QR-код шорткодом {qr} — кодирует как вписано, всегда по центру».
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v149-qr-shortcode.js
 * Сервер: http://localhost:3000 (bun run dev).
 *
 * Чеки:
 *  1. RU/EN: чип {qr} в «Вставить:» (6 чипов), подсказка упоминает {qr};
 *  2. QR кодирует поле КАК ВПИСАНО — дифференциальная пиксель-проверка:
 *     qr=«{sku}» (sku=ART-9) vs qr=«ART-9» → разные матрицы QR
 *     (если бы подстановки остались, обе строки кодировали бы «ART-9» — пиксели совпали бы);
 *  3. строка {qr} рендерится шорткодом (одна строка {qr} — на холсте только QR);
 *  4. QR центрирован: при единственной строке {qr} и выключенных границах
 *     bbox тёмных пикселей центрирован по X;
 *  5. поле QR пусто + строка {qr} → QR не печатается (холст белый);
 *  6. автодобавления НЕТ: поле QR заполнено, строки {qr} нет → QR НЕ печатается
 *     (на холсте только текстовая строка — высота bbox мала, без крупного блока);
 *  7. чип {qr} вставляет шорткод в строку; консоль чистая.
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

/** Закрыть все оверлеи (BLE-плашка, куки) */
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

const SHOW_RU = 'button[aria-label="Показать доп. вкладки"]';
const SHOW_EN = 'button[aria-label="Show extra tabs"]';
const ANIM = 600;

/** Посев: один товар, стиль без границ; lang — язык интерфейса */
function seedInit(tagLines, qrValue, lang = "ru") {
  return `
    window.localStorage.setItem("mxw01-lang", "${lang}");
    window.localStorage.setItem("mxw01-pricetags-placeholders-seeded", "1");
    window.localStorage.setItem("mxw01-pricetag-style", JSON.stringify({ borders: false }));
    window.localStorage.setItem("mxw01-pricetags", JSON.stringify([
      { id: "t1", name: "Молоко", price: "89", oldPrice: "", qr: ${JSON.stringify(qrValue)}, sku: "ART-9", barcode: "", extraLines: ${JSON.stringify(tagLines)} }
    ]));
  `;
}

/** Статистика тёмных пикселей видимого канваса предпросмотра */
const SCAN = () => {
  const cs = [...document.querySelectorAll("canvas")].filter(
    (c) => c.offsetParent !== null && c.width > 100
  );
  const c = cs[0];
  if (!c) return null;
  const ctx = c.getContext("2d");
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;
  let hash = 0, dark = 0;
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] < 100) {
        dark++;
        hash = (hash * 31 + y * W + x) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { W, H, hash, dark, minX, maxX, minY, maxY, cx: (minX + maxX) / 2 };
};

async function openPricetag(page, initScript) {
  await page.addInitScript(initScript);
  await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await closeOverlays(page);
  const show = page.locator(SHOW_RU);
  if (await show.isVisible().catch(() => false)) {
    await show.click();
    await page.waitForTimeout(ANIM);
  }
  await page.getByRole("tab", { name: /Ценник/ }).click();
  await page.waitForTimeout(ANIM);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. RU: чип {qr}, дифференциальная кодировка, центр ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));

    // Сценарий A: qr=«{sku}» (литерал), строки: {name} + {qr}
    await openPricetag(page, seedInit(["{name}", "{qr}"], "{sku}"));
    await page.waitForTimeout(400);

    const chipQr = page.locator('button', { hasText: /^\{qr\}$/ });
    ok((await chipQr.count()) === 1, "RU: чип {qr} присутствует в «Вставить:»");
    ok((await page.locator("text=Вставить:").count()) > 0, "RU: панель подстановок видна");
    const chips = await page.locator("text=Вставить:").locator("xpath=following-sibling::button").count();

    const scanA = await page.evaluate(SCAN);
    ok(!!scanA && scanA.dark > 2000, "A: QR отрисован (тёмных пикселей достаточно)");

    // Сценарий B: то же, но qr=«ART-9» — матрица должна отличаться
    await page.locator('input[aria-label="QR-код"]').fill("ART-9");
    await page.waitForTimeout(500);
    const scanB = await page.evaluate(SCAN);
    ok(!!scanB && scanB.dark > 2000, "B: QR отрисован");
    ok(scanA.hash !== scanB.hash, "QR кодирует поле КАК ВПИСАНО: «{sku}» и «ART-9» дают разные матрицы");

    // Центр: оставляем единственную строку {qr}
    await page.locator('input[aria-label="Строка 1"]').fill("{qr}");
    await page.locator('div:has(> input[aria-label="Строка 2"]) button[aria-label="Удалить строку"]').first().click();
    await page.waitForTimeout(500);
    const scanC = await page.evaluate(SCAN);
    ok(!!scanC && scanC.dark > 2000, "Шорткод: единственная строка {qr} рендерит QR");
    if (scanC && scanC.dark > 0) {
      const off = Math.abs(scanC.cx - scanC.W / 2);
      ok(off <= 8, `QR центрирован (смещение центра bbox ${off.toFixed(1)} px ≤ 8)`);
      ok(scanC.maxY - scanC.minY > scanC.H * 0.25, "QR занимает значимую долю высоты (блок, не текст)");
    }

    // Пустое поле QR + строка {qr} → холст белый
    await page.locator('input[aria-label="QR-код"]').fill("");
    await page.waitForTimeout(500);
    const scanD = await page.evaluate(SCAN);
    ok(!!scanD && scanD.dark === 0, "Пустое поле QR + строка {qr} → QR не печатается");

    // Чип вставляет шорткод в строку (очищаем строку, затем клик чипа)
    await page.locator('input[aria-label="Строка 1"]').fill("");
    await page.locator('input[aria-label="Строка 1"]').click();
    await chipQr.first().click();
    await page.waitForTimeout(300);
    const lineVal = await page.locator('input[aria-label="Строка 1"]').inputValue();
    ok(lineVal === "{qr}", `Чип {qr} вставил шорткод в строку (значение: «${lineVal}»)`);

    // Автодобавления НЕТ: поле QR заполнено, строки {qr} нет — QR не печатается
    await page.locator('input[aria-label="Строка 1"]').fill("Арт: {sku}");
    await page.locator('input[aria-label="QR-код"]').fill("BACKCOMPAT-1");
    await page.waitForTimeout(500);
    const scanE = await page.evaluate(SCAN);
    ok(!!scanE && scanE.dark > 0, "Только шорткод: текстовая строка «Арт: {sku}» напечатана");
    ok(!!scanE && scanE.maxY - scanE.minY < 120, `Только шорткод: QR-блока на холсте нет — высота тёмной зоны ${(scanE ? scanE.maxY - scanE.minY : -1)} px < 120 (QR был бы ≈200 px)`);
    ok(!!scanE && scanE.dark < 4000, "Только шорткод: тёмных пикселей мало (QR дал бы крупный тёмный блок)");
    ok(chips === 6, "RU: всего 6 чипов подстановок");
    await ctx.close();
  }

  /* ---------- 2. EN: чип {qr} и подсказка ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));

    await page.addInitScript(seedInit(["{name}", "{qr}"], "EN-QR-1", "en"));
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);
    const show = page.locator(SHOW_EN);
    if (await show.isVisible().catch(() => false)) {
      await show.click();
      await page.waitForTimeout(ANIM);
    }
    await page.getByRole("tab", { name: /Price Tag|Ценник/ }).click();
    await page.waitForTimeout(ANIM);

    const chipQrEn = page.locator('button', { hasText: /^\{qr\}$/ });
    ok((await chipQrEn.count()) === 1, "EN: чип {qr} присутствует");
    const chipsEn = await page.locator("text=Insert:").locator("xpath=following-sibling::button").count();
    ok(chipsEn === 6, "EN: всего 6 чипов");
    ok((await page.locator("text=the QR code centered").count()) > 0, "EN: подсказка упоминает центрированный QR");
    const scanEn = await page.evaluate(SCAN);
    ok(!!scanEn && scanEn.dark > 2000, "EN: QR отрисован по строке {qr}");
    // Изолируем QR: единственная строка {qr} — bbox только QR-кода
    await page.locator('input[aria-label="Line 1"]').fill("");
    await page.waitForTimeout(500);
    const scanEnQr = await page.evaluate(SCAN);
    ok(!!scanEnQr && scanEnQr.dark > 2000, "EN: единственная строка {qr} рендерит QR");
    if (scanEnQr && scanEnQr.dark > 0) {
      const off = Math.abs(scanEnQr.cx - scanEnQr.W / 2);
      ok(off <= 8, `EN: QR центрирован (смещение ${off.toFixed(1)} px ≤ 8)`);
    }
    await ctx.close();
  }

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
