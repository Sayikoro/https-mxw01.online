/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка v1.0.23 «Генераторы в ленте + список ценников + PWA-установка».
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v123-tools-in-tape.js
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

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. Десктоп RU: вкладки, палитра, миграция ценника ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      // Старый одиночный ценник из v1.0.21 — должен мигрировать в список.
      // Сидим ОДИН РАЗ: addInitScript выполняется и при перезагрузке,
      // повторный посев стёр бы добавленные в тесте элементы
      if (!window.localStorage.getItem("mxw01-seeded-v123")) {
        window.localStorage.setItem("mxw01-seeded-v123", "1");
        window.localStorage.setItem(
          "mxw01-text-fields",
          JSON.stringify([
            {
              id: "legacy-pt",
              kind: "pricetag",
              x: 16,
              y: 0,
              name: "Старый ценник",
              price: "199",
              oldPrice: "",
              sku: "",
              qr: "",
              barcode: "",
              extraLines: ["{name}", "{price}"],
              fontSize: 48,
              frame: true,
            },
          ])
        );
      }
    });
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await closeOverlays(page);

    const tabTitles = await page.locator('[role="tab"] span').allInnerTexts();
    ok(!tabTitles.some((s) => s.includes("Инструменты")), "вкладки: «Инструменты» больше нет");
    ok(tabTitles.join(",").includes("Лента"), "вкладки: Лента/Ценник/Изображение");

    const hasBlocks = await page.getByText("Блоки", { exact: true }).first().isVisible().catch(() => false);
    const hasGen = await page.getByText("Генераторы", { exact: true }).first().isVisible().catch(() => false);
    ok(hasBlocks && hasGen, "палитра: секции «Блоки» и «Генераторы»");

    for (const name of ["QR-код", "Wi-Fi", "Чек-лист", "Чек", "Сроки годности", "Нумерация", "Календарь", "Трекер привычек"]) {
      const btn = page.locator(`button[aria-label="${name}"]`);
      ok((await btn.count()) === 1, `палитра: кнопка «${name}»`);
    }

    // Миграция старого ценника: карточка-список с одним тегом
    const legacyRow = page.locator("span", { hasText: "1. Старый ценник — 199" }).first();
    ok(await legacyRow.isVisible().catch(() => false), "миграция: старый ценник стал тегом списка");
    ok(await canvasHasInk(page), "миграция: превью ценника напечатано");

    // Раскрыть тег списка → поля ввода
    await legacyRow.click();
    await page.waitForTimeout(300);
    const nameInput = page.locator('input[aria-label="Название товара"]').first();
    ok((await nameInput.count()) > 0 && (await nameInput.inputValue()) === "Старый ценник", "тег: поля ввода в раскрытом ценнике");

    // Добавить второй ценник списка
    const addTag = page.locator("button", { hasText: "Добавить ценник" }).first();
    await addTag.click();
    await page.waitForTimeout(300);
    const tagRows = await page.locator("span", { hasText: /^\d+\. / }).count();
    ok(tagRows >= 2, "список: добавлен второй ценник");

    // Иконки CSV на месте
    ok((await page.locator('button[aria-label="Экспорт ценников в CSV"]').count()) >= 1, "список: кнопка экспорта CSV");

    // ---------- QR-генератор в ленте ----------
    await page.locator('button[aria-label="QR-код"]').click();
    await page.waitForTimeout(300);
    const qrTextarea = page.locator('textarea[aria-label="Данные"]').first();
    ok((await qrTextarea.count()) === 1, "QR: карточка с формой добавлена");
    await qrTextarea.fill("https://mxw01.online");
    await page.waitForTimeout(600);
    ok(await canvasHasInk(page), "QR: превью с чёрными пикселями (модули нарисованы)");

    // ---------- Чек в ленте: позиция + итог ----------
    await page.locator('button[aria-label="Чек"]').click();
    await page.waitForTimeout(300);
    const addPos = page.locator("button", { hasText: "Добавить позицию" }).last();
    await addPos.click();
    const nameField = page.locator('input[placeholder="Название"]').last();
    await nameField.fill("Кофе");
    const priceField = page.locator('input[placeholder="Цена"]').last();
    await priceField.fill("250");
    await page.waitForTimeout(600);
    const total = await page.getByText("К оплате: 250.00").first().isVisible().catch(() => false);
    ok(total, "чек: итог посчитан в карточке");
    ok(await canvasHasInk(page), "чек: превью напечатано");

    // Персист после перезагрузки
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);
    const qrAfter = await page.locator('textarea[aria-label="Данные"]').first().inputValue();
    ok(qrAfter === "https://mxw01.online", "персист: QR-данные после перезагрузки");
    const tagsAfter = await page.locator("span", { hasText: /^\d+\. / }).count();
    ok(tagsAfter >= 2, "персист: ценники списка на месте");

    await page.screenshot({ path: "work/v123-tape-tools-ru.png", fullPage: false });
    await ctx.close();
  }

  /* ---------- 2. Установка PWA: Android-путь (нативный диалог) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => window.localStorage.setItem("mxw01-lang", "ru"));
    await page.goto(`${BASE}/?nobt=1&install=1`, { waitUntil: "networkidle" });
    await closeOverlays(page);

    // Баннер без beforeinstallprompt ещё не показан (iOS-таймер не для десктопа)
    // Диспатчим настоящее событие — как это делает Chrome
    await page.evaluate(() => {
      const ev = new Event("beforeinstallprompt");
      ev.prompt = async () => ({ outcome: "accepted" });
      window.dispatchEvent(ev);
    });
    await page.waitForTimeout(400);
    const banner = page.getByText("Установить как приложение").first();
    ok(await banner.isVisible().catch(() => false), "PWA: баннер после beforeinstallprompt");
    await page.screenshot({ path: "work/v123-install-banner.png" });
    await page.locator("button", { hasText: "Установить" }).first().click();
    await page.waitForTimeout(400);
    ok(!(await banner.isVisible().catch(() => false)), "PWA: баннер скрыт после установки");
    await ctx.close();
  }

  /* ---------- 3. Установка PWA: iPhone (пошаговая инструкция) ---------- */
  {
    const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => window.localStorage.setItem("mxw01-lang", "ru"));
    await page.goto(`${BASE}/?nobt=1&install=1`, { waitUntil: "networkidle" });
    await closeOverlays(page);
    const banner = page.getByText("Установить как приложение").first();
    await banner.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    ok(await banner.isVisible().catch(() => false), "iOS: баннер появился на iPhone");
    await page.locator("button", { hasText: "Установить" }).first().click();
    await page.waitForTimeout(400);
    const dlg = page.locator('[role="dialog"]', { hasText: "Установка на iPhone / iPad" });
    ok((await dlg.count()) === 1, "iOS: диалог с пошаговой инструкцией");
    for (const step of ["Откройте сайт в Safari", "Нажмите «Поделиться»", "На экран „Домой“", "Нажмите «Добавить»"]) {
      ok((await dlg.getByText(step).count()) > 0, `iOS: шаг «${step}»`);
    }
    ok((await dlg.getByText(/настройки/i).count()) > 0, "iOS: примечание про настройки");
    await page.screenshot({ path: "work/v123-install-ios-steps.png" });
    await ctx.close();
  }

  /* ---------- 4. Мобильная вёрстка 390px ---------- */
  {
    const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !isNoise(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !isNoise(String(e)) && consoleErrors.push(String(e)));
    await page.addInitScript(() => window.localStorage.setItem("mxw01-lang", "ru"));
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await closeOverlays(page);
    const noOverflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth <= el.clientWidth + 1;
    });
    ok(noOverflow, "мобильная 390px: без горизонтального overflow");
    ok(await canvasHasInk(page), "мобильная: мигрировавший ценник в превью");
    await page.screenshot({ path: "work/v123-mobile-tape.png" });
    await ctx.close();
  }

  /* ---------- Итоги ---------- */
  ok(consoleErrors.length === 0, `консоль без ошибок (${consoleErrors.length})`);
  if (consoleErrors.length) console.error("  errors:", consoleErrors.slice(0, 5));

  console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
