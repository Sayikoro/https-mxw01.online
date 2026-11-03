/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка v1.0.24 «Типографика у блоков-генераторов» (шрифт + масштаб текста
 * в раскрытой карточке под «Ещё», рендер с учётом typo, персист, EN, мобайл).
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v124-tool-typo.js
 * Сервер: http://localhost:3000 (bun run dev).
 */
const { chromium, devices } = require("playwright");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const consoleErrors = [];
// Шум песочницы: телеметрия Яндекса, не имеет отношения к приложению
const NOISE = /yandex\.net|ERR_CERT_AUTHORITY_INVALID/i;

function isNoise(text) {
  return NOISE.test(text);
}

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

/** Суммарная высота холстов предпросмотра (px печати) и ширина первого */
async function previewMetrics(page) {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('canvas[aria-label="Предпросмотр"]'));
    return {
      height: list.reduce((s, c) => s + c.height, 0),
      width: list.length ? list[0].width : 0,
      pages: list.length,
    };
  });
}

/** Есть ли чёрные пиксели на каком-нибудь канвасе превью */
async function canvasHasInk(page) {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll("canvas"));
    return list.some((c) => {
      if (!c.width || !c.height) return false;
      try {
        const ctx = c.getContext("2d");
        const d = ctx.getImageData(0, 0, c.width, Math.min(c.height, 720)).data;
        for (let i = 0; i < d.length; i += 40) {
          if (d[i] < 100) return true;
        }
      } catch {
        return false;
      }
      return false;
    });
  });
}

/** typo элемента-генератора из localStorage */
async function storedTypo(page) {
  return page.evaluate(() => {
    try {
      const items = JSON.parse(window.localStorage.getItem("mxw01-text-fields") || "[]");
      const tool = items.find((it) => it.kind === "tool");
      return tool ? tool.typo ?? null : null;
    } catch {
      return null;
    }
  });
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. Десктоп RU: чек-лист + типографика ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      if (!window.localStorage.getItem("mxw01-seeded-v124")) {
        window.localStorage.setItem("mxw01-seeded-v124", "1");
        window.localStorage.setItem("mxw01-text-fields", "[]");
      }
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await closeOverlays(page);

    // Чек-лист: добавление, заполнение
    await page.locator('button[aria-label="Чек-лист"]').click();
    await page.waitForTimeout(400);
    const titleInput = page.locator('input[aria-label="Заголовок"]').first();
    ok((await titleInput.count()) === 1, "чек-лист: карточка добавлена и раскрыта");
    await titleInput.fill("Покупки");
    await page.locator("button", { hasText: "Добавить пункт" }).first().click();
    await page.locator("button", { hasText: "Добавить пункт" }).first().click();
    const itemInputs = page.locator('input[aria-label="Текст пункта"]');
    await itemInputs.nth(0).fill("Молоко");
    await itemInputs.nth(1).fill("Хлеб");
    await page.waitForTimeout(900);
    ok(await canvasHasInk(page), "чек-лист: превью напечатано");

    // Типографика генератора видна в раскрытой карточке (автораскрытие)
    const fontSel = page.locator('select[aria-label="Шрифт генератора"]').first();
    const scaleSel = page.locator('select[aria-label="Масштаб текста генератора"]').first();
    ok((await fontSel.count()) === 1, "типографика: селект шрифта на месте");
    ok((await scaleSel.count()) === 1, "типографика: селект масштаба на месте");
    ok((await fontSel.inputValue()) === "", "типографика: шрифт по умолчанию («По умолчанию»)");
    ok((await scaleSel.inputValue()) === "1", "типографика: масштаб по умолчанию 100%");
    ok(
      (await page.getByText("QR-код, штрихкод и рамки остаются прежними").count()) === 1,
      "типографика: подсказка про QR/штрихкод"
    );
    ok((await storedTypo(page)) === null, "typо в данных не хранится, пока ничего не меняли");

    // Масштаб 150% → холст выше
    const m1 = await previewMetrics(page);
    await scaleSel.selectOption("1.5");
    await page.waitForTimeout(900);
    const m2 = await previewMetrics(page);
    ok(m2.height > m1.height, `масштаб 150%: холст вырос (${m1.height} → ${m2.height} px)`);

    // Масштаб без выбора шрифта: fontFamily не прописывается — ролевые шрифты
    // сохраняются (чек остаётся моноширинным)
    const typoScaleOnly = await storedTypo(page);
    ok(
      !!typoScaleOnly && typoScaleOnly.scale === 1.5 && typoScaleOnly.fontFamily === undefined,
      "масштаб 150% без шрифта: в typо только scale, семья не прописана"
    );

    // Шрифт Georgia → перерисовка, данные в localStorage
    await fontSel.selectOption("Georgia, serif");
    await page.waitForTimeout(900);
    ok(await canvasHasInk(page), "шрифт Georgia: превью перерисовано");
    const typo = await storedTypo(page);
    ok(
      !!typo && typo.scale === 1.5 && typo.fontFamily === "Georgia, serif",
      "typо сохранён в элементе ленты (scale 1.5, Georgia)"
    );

    // Персист после перезагрузки: карточки свёрнуты — раскрываем «Ещё» чек-листа
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);
    await page.locator('button[aria-label="Ещё"]').last().click();
    await page.waitForTimeout(400);
    ok(
      (await page.locator('select[aria-label="Шрифт генератора"]').first().inputValue()) === "Georgia, serif",
      "персист: шрифт после перезагрузки"
    );
    const scaleAfter = await page.locator('select[aria-label="Масштаб текста генератора"]').first().inputValue();
    ok(scaleAfter === "1.5", "персист: масштаб после перезагрузки");
    const m3 = await previewMetrics(page);
    ok(m3.height === m2.height, `персист: высота холста воспроизвелась (${m3.height} px)`);

    await page.screenshot({ path: "work/v124-checklist-typo-ru.png" });
    await ctx.close();
  }

  /* ---------- 2. QR с масштабом 200%: ширина 384 сохраняется ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      if (!window.localStorage.getItem("mxw01-seeded-v124b")) {
        window.localStorage.setItem("mxw01-seeded-v124b", "1");
        window.localStorage.setItem("mxw01-text-fields", "[]");
      }
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);

    await page.locator('button[aria-label="QR-код"]').click();
    await page.waitForTimeout(400);
    await page.locator('textarea[aria-label="Данные"]').first().fill("https://mxw01.online");
    await page.locator('input[aria-label="Подпись под кодом"]').first().fill("Наш сайт");
    await page.waitForTimeout(900);
    const m1 = await previewMetrics(page);
    ok(m1.width === 384, "QR: ширина холста печати 384");
    await page.locator('select[aria-label="Масштаб текста генератора"]').first().selectOption("2");
    await page.waitForTimeout(900);
    const m2 = await previewMetrics(page);
    ok(m2.width === 384, "QR при 200%: ширина холста осталась 384");
    ok(m2.height > m1.height, `QR при 200%: подпись крупнее, холст вырос (${m1.height} → ${m2.height})`);
    ok(await canvasHasInk(page), "QR при 200%: модули и подпись напечатаны");

    // Чек с масштабом: моношрифт меняется на выбранный, итог на месте
    await page.locator('button[aria-label="Чек"]').click();
    await page.waitForTimeout(400);
    await page.locator("button", { hasText: "Добавить позицию" }).last().click();
    await page.locator('input[placeholder="Название"]').last().fill("Кофе");
    await page.locator('input[placeholder="Цена"]').last().fill("250");
    await page.waitForTimeout(900);
    ok(
      (await page.getByText("К оплате: 250.00").first().isVisible().catch(() => false)),
      "чек при типографике по умолчанию: итог посчитан"
    );
    await page.screenshot({ path: "work/v124-qr-receipt-typo.png" });
    await ctx.close();
  }

  /* ---------- 3. EN: подписи и персист ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "en");
      if (!window.localStorage.getItem("mxw01-seeded-v124c")) {
        window.localStorage.setItem("mxw01-seeded-v124c", "1");
        window.localStorage.setItem("mxw01-text-fields", "[]");
      }
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);
    await page.locator('button[aria-label="Checklist"]').click();
    await page.waitForTimeout(400);
    ok(
      (await page.locator('select[aria-label="Generator font"]').count()) === 1,
      "EN: селект шрифта (Generator font)"
    );
    ok(
      (await page.locator('select[aria-label="Generator text scale"]').count()) === 1,
      "EN: селект масштаба (Generator text scale)"
    );
    ok(
      (await page.getByText("QR codes, barcodes and frames stay unchanged.").count()) === 1,
      "EN: подсказка переведена"
    );
    await ctx.close();
  }

  /* ---------- 4. Мобильная вёрстка 390px ---------- */
  {
    const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      if (!window.localStorage.getItem("mxw01-seeded-v124d")) {
        window.localStorage.setItem("mxw01-seeded-v124d", "1");
        window.localStorage.setItem(
          "mxw01-text-fields",
          JSON.stringify([
            {
              id: "tool-typo-1",
              kind: "tool",
              x: 0,
              y: 0,
              tool: "checklist",
              data: { title: "Покупки", items: [{ id: "a", text: "Молоко", done: false }] },
              typo: { scale: 1.3, fontFamily: "Verdana, sans-serif" },
            },
          ])
        );
      }
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await closeOverlays(page);
    const noOverflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth <= el.clientWidth + 1;
    });
    ok(noOverflow, "мобильная 390px: без горизонтального overflow");
    ok(await canvasHasInk(page), "мобильная: чек-лист с typo напечатан");
    // Карточка свёрнута — раскрываем «Ещё», чтобы прочитать селекты
    await page.locator('button[aria-label="Ещё"]').last().click();
    await page.waitForTimeout(400);
    const typoSeen =
      (await page.locator('select[aria-label="Масштаб текста генератора"]').first().inputValue().catch(() => "")) ===
      "1.3";
    ok(typoSeen, "мобильная: масштаб 130% подхвачен из localStorage");
    await page.screenshot({ path: "work/v124-mobile-typo.png" });
    await ctx.close();
  }

  /* ---------- Итоги ---------- */
  ok(consoleErrors.length === 0, `консоль без ошибок (${consoleErrors.length})`);
  if (consoleErrors.length) console.error("  errors:", consoleErrors.slice(0, 5));

  console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
