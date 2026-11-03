/**
 * v1.0.39 — регрессия после удаления Liquid Glass.
 * Проверяемые кейсы (RU, headless Chromium):
 *  0. /versions.md отдаётся сайтом
 *  1. Сохранение страницы ленты картинкой (PNG-магия, имя файла, тост)
 *  2. Качество превью: переключение и пиксели
 *  3. Рамки текста: селект в «Ещё» → пиксели в превью
 *  4. Инструмент «Замена»: карточка → пиксели в превью
 *  5. Тема: Тёмная/Светлая + персист после перезагрузки
 *  6. «Изменения по версиям»: окно рендерит versions.md
 *  7. EN-ключи настроек
 *  8. Мобайл 390px без переполнения
 *  9. Бэкап v2 (version: 2) + «Сбросить всё»
 * Liquid Glass удалён в v1.0.39: секции «Экспериментально», классов
 * glass/glass-engine и SVG-фильтра больше нет — потому не проверяем.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const WORK = path.join(__dirname, "..", "work");

let passed = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (cond) passed++;
}

async function dismissPopups(page) {
  // Надёжно закрываем BLE-диалог и cookie-баннер. Cookie-баннер — тоже
  // role=dialog, но без data-state; его перекрывает оверлей BLE (z-50),
  // поэтому кликаем по JS (мимо actionability) и сперва BLE, затем cookie.
  for (let i = 0; i < 12; i++) {
    const st = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const has = (re) => btns.some((b) => re.test(b.textContent.trim()));
      return {
        ble: has(/^(Понятно|Got it)$/),
        cookie: has(/^(Хорошо|Got it)$/),
        overlayOpen: !!document.querySelector('[data-slot="dialog-overlay"][data-state="open"]'),
      };
    });
    if (!st.ble && !st.cookie && !st.overlayOpen) return;
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const tryClick = (re) => {
        const b = btns.find((x) => re.test(x.textContent.trim()));
        if (b) {
          b.click();
          return true;
        }
        return false;
      };
      return tryClick(/^(Понятно|Got it)$/) || tryClick(/^(Хорошо|Got it)$/);
    });
    if (!clicked) await page.waitForTimeout(500);
    else await page.waitForTimeout(350);
  }
}

async function openSettings(page) {
  // На случай, если после dismiss ещё что-то всплыло (cookie-баннер
  // появляется после гидратации с задержкой) — закрываем заново
  await dismissPopups(page);
  // Клик по шестерёнке через JS — оверлеи не перехватят; до 3 попыток
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
      if (btn) btn.click();
    });
    try {
      await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 6000 });
      return;
    } catch {
      await page.waitForTimeout(700);
    }
  }
  // Аварийный путь: перезагрузка (сбрасывает зависшие оверлеи Radix)
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 30000 });
  await dismissPopups(page);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
      if (btn) btn.click();
    });
    try {
      await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 6000 });
      return;
    } catch {
      await page.waitForTimeout(700);
    }
  }
  const dump = await page
    .evaluate(() => ({
      header: !!document.querySelector("header"),
      headerBtns: Array.from(document.querySelectorAll("header button")).map(
        (b) => b.getAttribute("title") || b.textContent.trim().slice(0, 16)
      ),
      bodyText: document.body.innerText.replace(/\n+/g, "|").slice(0, 120),
      htmlCls: document.documentElement.className,
      overlays: Array.from(document.querySelectorAll("[data-slot=dialog-overlay]")).map((e) =>
        e.getAttribute("data-state")
      ),
      dialogs: Array.from(document.querySelectorAll("[role=dialog]")).map((e) =>
        (e.getAttribute("data-state") || "no-state") + ":" + e.textContent.slice(0, 40)
      ),
      saveBtn: !!document.querySelector('[data-testid="tape-save-page"]'),
    }))
    .catch(() => null);
  console.log("  · openSettings FAIL dump:", JSON.stringify(dump));
  throw new Error("Настройки не открылись");
}

async function collectErrors(page, bucket) {
  page.on("pageerror", (e) => bucket.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Шум метрики песочницы ловим и по тексту, и по URL: при недоступности
    // mc.yandex текст — просто «Failed to load resource … 500/503»
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (
      m.type() === "error" &&
      !/favicon|404|net::ERR|CERT|metrika|mc\.yandex|googletagmanager/i.test(where)
    ) {
      bucket.push(`console: ${m.text()} @ ${m.location()?.url || "?"}`);
    }
  });
}

function pngMagic(bytes) {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Язык RU по умолчанию: headless-браузер en-US. НЕ перетираем, если язык
  // уже выставлен (кейсы EN/сброса меняют его явно)
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem("mxw01-lang")) localStorage.setItem("mxw01-lang", "ru");
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  fs.mkdirSync(WORK, { recursive: true });

  /* ---------------- 0. /versions.md отдаётся сайтом ---------------- */
  console.log("Кейс 0: роут /versions.md");
  {
    const resp = await page.request.get(`${BASE}/versions.md`);
    ok(resp.status() === 200, `/versions.md — 200 (получено ${resp.status()})`);
    ok(
      (resp.headers()["content-type"] || "").includes("text/markdown"),
      `content-type text/markdown (${resp.headers()["content-type"]})`
    );
    const body = await resp.text();
    ok(body.includes("Текущая версия"), "в versions.md есть «Текущая версия»");
  }

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Ждём гидратацию (кнопка сохранения рендерится только клиентом),
  // лишь затем закрываем попапы — иначе закрывать нечего
  await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 30000 });
  await dismissPopups(page);

  /* ---------------- 1. Сохранение страницы картинкой ---------------- */
  console.log("Кейс 1: сохранить страницу картинкой");
  {
    await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 20000 });
    await page.waitForTimeout(800); // гидратация обработчика
    // JS-клик: стабильнее, чем actionability-клик (оверлеи/анимации)
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.evaluate(() => document.querySelector('[data-testid="tape-save-page"]').click()),
    ]);
    const name = download.suggestedFilename();
    ok(/^mxw01-page-\d+-\d{8}-\d{6}\.png$/.test(name), `имя файла ${name}`);
    const fp = path.join(WORK, "v134-download.png");
    await download.saveAs(fp);
    const bytes = fs.readFileSync(fp);
    ok(pngMagic(bytes), `PNG-магия на месте (${bytes.length} байт)`);
    ok(bytes.length > 1000, "PNG непустой (>1 КБ)");
    await page.waitForFunction(
      () => document.body.innerText.includes("Картинка сохранена"),
      undefined,
      { timeout: 5000 }
    );
    ok(true, "тост «Картинка сохранена» показан");
  }

  /* ---------------- 2. Качество превью ---------------- */
  console.log("Кейс 2: качество превью");
  {
    const before = await page.evaluate(() => {
      const c = document.querySelector('canvas[width="384"]');
      return c ? c.getContext("2d").getImageData(0, 0, 384, Math.min(c.height, 300)).data.slice(0, 40000).join(",") : "";
    });
    await openSettings(page);
    await page.locator('[data-testid="quality-fast"]').click();
    await page.waitForFunction(
      () => localStorage.getItem("mxw01-preview-quality") === "fast",
      undefined,
      { timeout: 5000 }
    );
    ok(true, "mxw01-preview-quality = fast");
    await page.keyboard.press("Escape");
    // Дождаться перерисовки превью в 1× и сравнить картинку
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => {
      const c = document.querySelector('canvas[width="384"]');
      return c ? c.getContext("2d").getImageData(0, 0, 384, Math.min(c.height, 300)).data.slice(0, 40000).join(",") : "";
    });
    ok(before !== after, "пиксели превью изменились (рендер в 1× vs 4×)");
    // Вернуть точное
    await openSettings(page);
    await page.locator('[data-testid="quality-exact"]').click();
    await page.keyboard.press("Escape");
  }

  /* ---------------- 3. Рамка текста ---------------- */
  console.log("Кейс 3: рамки текста");
  {
    // Первая карточка — текст по умолчанию; раскрыть «Ещё»
    await page.getByRole("button", { name: /Ещё|More/ }).first().click();
    const frameSelect = page.locator('select[aria-label="Рамка вокруг текстового блока"]');
    ok((await frameSelect.count()) === 1, "селект «Рамка» в карточке текста");
    const canvasBefore = await page.evaluate(() => {
      const c = document.querySelector('canvas[width="384"]');
      return c ? c.getContext("2d").getImageData(0, 0, 384, Math.min(c.height, 300)).data.slice(0, 40000).join(",") : "";
    });
    await frameSelect.selectOption("dashed");
    await page.waitForTimeout(700);
    const canvasAfter = await page.evaluate(() => {
      const c = document.querySelector('canvas[width="384"]');
      return c ? c.getContext("2d").getImageData(0, 0, 384, Math.min(c.height, 300)).data.slice(0, 40000).join(",") : "";
    });
    ok(canvasBefore !== canvasAfter, "пунктирная рамка появилась в превью");
    const saved = await page.evaluate(() => {
      try {
        const items = JSON.parse(localStorage.getItem("mxw01-text-fields") || "[]");
        return items.some((it) => it.frame === "dashed");
      } catch {
        return false;
      }
    });
    ok(saved, "рамка сохранилась в localStorage (mxw01-text-fields, frame=dashed)");
  }

  /* ---------------- 4. Инструмент «Замена» ---------------- */
  console.log("Кейс 4: инструмент «Замена»");
  {
    await page.getByRole("button", { name: "Замена", exact: true }).click();
    await page.waitForTimeout(400);
    ok(await page.getByPlaceholder("Фильтр, картридж…").count() === 1, "карточка «Замена» с полями формы");
    await page.getByPlaceholder("Фильтр, картридж…").fill("Фильтр");
    await page.waitForTimeout(700);
    const ink = await page.evaluate(() => {
      const c = document.querySelector('canvas[width="384"]');
      if (!c) return 0;
      const d = c.getContext("2d").getImageData(0, 0, 384, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
      return dark;
    });
    ok(ink > 200, `этикетка «Замена» напечатана в превью (${ink} тёмных px)`);
    await page.screenshot({ path: path.join(WORK, "v134-replacement.png") });
  }

  /* ---------------- 5. Тема ---------------- */
  console.log("Кейс 5: тема");
  {
    await openSettings(page);
    await page.locator('[data-testid="theme-dark"]').click();
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"), undefined, { timeout: 5000 });
    ok(true, "Тёмная: класс dark на <html>");
    await page.screenshot({ path: path.join(WORK, "v134-dark.png") });
    await page.locator('[data-testid="theme-light"]').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"), undefined, { timeout: 5000 });
    ok(true, "Светлая: класс dark снят");
    await page.locator('[data-testid="theme-dark"]').click();
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 30000 });
    await dismissPopups(page);
    const darkAfterReload = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    ok(darkAfterReload, "после перезагрузки тёмная тема сохранена (инлайн-скрипт)");
    // Вернуть светлую
    await openSettings(page);
    console.log("  · настройки открыты (возврат светлой)");
    await page.locator('[data-testid="theme-light"]').click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  /* ---------------- 6. История версий ---------------- */
  console.log("Кейс 6: «Изменения по версиям»");
  {
    await openSettings(page);
    console.log("  · настройки открыты (история)");
    await page.locator('[data-testid="changelog-open"]').click();
    console.log("  · кнопка истории нажата");
    await page.waitForFunction(
      () => document.body.innerText.includes("Текущая версия") && document.body.innerText.includes("1.0."),
      undefined,
      { timeout: 8000 }
    );
    ok(true, "окно истории рендерит versions.md (заголовки версий на месте)");
    await page.screenshot({ path: path.join(WORK, "v134-changelog.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  /* ---------------- 7. EN-ключи ---------------- */
  console.log("Кейс 7: EN-ключи настроек");
  {
    await openSettings(page);
    await page.evaluate(() => localStorage.setItem("mxw01-lang", "en"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 30000 });
    await dismissPopups(page);
    await openSettings(page);
    const hasEn = await page.evaluate(() => document.body.innerText.includes("Version history"));
    ok(hasEn, "в EN-настройках есть Version history");
    await page.keyboard.press("Escape");
  }

  /* ---------------- 8. Мобайл 390 ---------------- */
  console.log("Кейс 8: мобайл 390px");
  {
    const mp = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mp.newPage();
    const merr = [];
    collectErrors(mpage, merr);
    await mpage.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await dismissPopups(mpage);
    const scroll = await mpage.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth,
    }));
    ok(scroll.w <= scroll.c + 1, `без горизонтального переполнения (${scroll.w} ≤ ${scroll.c})`);
    ok(merr.length === 0, `моб. консоль без ошибок (${merr.length})`);
    await mp.close();
  }

  /* ---------------- 9. Бэкап v2 и «Сбросить всё» ---------------- */
  console.log("Кейс 9: бэкап v2 + сброс");
  {
    await page.evaluate(() => localStorage.setItem("mxw01-lang", "ru"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 30000 });
    await dismissPopups(page);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      (async () => {
        await openSettings(page);
        // Кнопка «Скачать бэкап» — в настройках (v1.0.35: перенесена из шапки)
        await page.locator('[data-testid="backup-download"]').click();
      })(),
    ]);
    const name = download.suggestedFilename();
    ok(/^mxw01-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name), `имя бэкапа ${name}`);
    const fp = path.join(WORK, "v134-backup.json");
    await download.saveAs(fp);
    const backup = JSON.parse(fs.readFileSync(fp, "utf8"));
    ok(backup.version === 2, `формат v2 (version=${backup.version})`);
    ok(!!backup.keys["mxw01-text-fields"], "в бэкапе лента (mxw01-text-fields)");
    ok(backup.keys["mxw01-theme"] === "light", "в бэкапе настройки (mxw01-theme=light)");
    ok(!("mxw01-cookie-consent" in backup.keys), "служебные ключи (cookie) в бэкап не входят");
    await page.keyboard.press("Escape");

    // Сброс: первый клик — подтверждение, второй — удаление + перезагрузка
    await openSettings(page);
    await page.locator('[data-testid="reset-all"]').click();
    ok(
      await page.evaluate(() => document.body.innerText.includes("Точно удалить все данные?")),
      "первый клик — подтверждение"
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {}),
      page.locator('[data-testid="reset-all"]').click(),
    ]);
    await page.waitForTimeout(800);
    const left = await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) =>
          k.startsWith("mxw01-") &&
          k !== "mxw01-cookie-consent" &&
          // mxw01-lang проставляет тестовый addInitScript на перезагрузке
          k !== "mxw01-lang"
      )
    );
    ok(!left.includes("mxw01-theme"), "настройки сброшены (mxw01-theme удалён)");
    // Лента: приложение пересеивает пример на чистом старте — старые данные
    // (рамка dashed) должны исчезнуть
    const frameGone = await page.evaluate(() => {
      try {
        const items = JSON.parse(localStorage.getItem("mxw01-text-fields") || "[]");
        return !items.some((it) => it.frame === "dashed");
      } catch {
        return true;
      }
    });
    ok(frameGone, "лента сброшена (рамка из старых данных исчезла)");
  }

  if (errors.length) console.log("  Ошибки консоли:", errors.join(" | "));
  ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);

  console.log(`\nИТОГ: пройдено ${passed} проверок`);
  await browser.close();
  process.exit(0);
})();
