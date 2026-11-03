/* v1.0.20: проверка плашки «Браузер не поддерживается» с Firefox UA
 * (десктоп Windows + Android) и текстов FAQ6 после перехода на рекомендацию
 * WebBT. Запуск: NODE_PATH=$(npm root -g) node scripts/v120-firefox-ua-check.js
 */
/* eslint-disable @typescript-eslint/no-require-imports -- служебный скрипт:
 * playwright резолвим из глобального npm через NODE_PATH, ESM так не умеет */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const UA_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";
const UA_ANDROID =
  "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0";

const results = [];
function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
}

/** Закрыть cookie-баннер (JS-клик, не перехватывая события BLE-плашки) */
async function closeCookie(page) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) =>
      /^(Понятно|Хорошо|Got it|OK)$/i.test((x.textContent || "").trim()),
    );
    if (b) b.click();
  });
}

/** BLE-диалог = [role=dialog] с заголовком про браузер */
function bleDialog(page) {
  return page
    .locator('[role="dialog"]')
    .filter({ hasText: /Браузер не поддерживается|Browser [Nn]ot [Ss]upported/ })
    .first();
}

async function dialogMetrics(page, dlg) {
  return dlg.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      scrollDiff: el.scrollHeight - el.clientHeight,
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
    };
  });
}

async function runScenario(name, { ua, viewport, lang, url, shot }) {
  console.log(`\n=== ${name} ===`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: ua,
    viewport,
    locale: lang === "ru" ? "ru-RU" : "en-US",
  });
  await ctx.addInitScript((l) => localStorage.setItem("mxw01-lang", l), lang);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await closeCookie(page);
  await page.waitForTimeout(400);

  const dlg = bleDialog(page);
  const visible = await dlg.isVisible().catch(() => false);
  ok(`${name}: плашка открылась`, visible);

  if (visible) {
    const text = await dlg.innerText();
    const m = await dialogMetrics(page, dlg);
    const vp = page.viewportSize();
    const fits = m.top >= 0 && m.bottom <= vp.height + 1;

    ok(`${name}: текст про WebBT`, /WebBT/.test(text) && /stevennyman\/webbt/.test(text));
    ok(
      `${name}: Firefox в «Вы используете»`,
      /Firefox/.test(text),
      text.split("\n").find((l) => /Firefox/.test(l))?.trim(),
    );
    ok(`${name}: без iOS-шагов`, !/Управление расширениями|Manage Extensions/.test(text));
    ok(
      `${name}: кнопка Chrome`,
      /Скачать Google Chrome|Get Google Chrome/.test(text),
    );

    console.log(`  box: top=${Math.round(m.top)} bottom=${Math.round(m.bottom)} vp=${vp.height} scrollDiff=${m.scrollDiff} (${m.clientH}/${m.scrollH})`);
    ok(`${name}: плашка в границах экрана`, fits);
    if (m.scrollDiff > 0) {
      // прокрутка до низа — кнопка «Понятно» должна стать доступна
      await dlg.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(300);
      const after = await dialogMetrics(page, dlg);
      const gotIt = dlg.locator("button", { hasText: /Понятно|Got it/ }).last();
      const gb = await gotIt.boundingBox().catch(() => null);
      ok(
        `${name}: скролл открывает нижние кнопки`,
        !!gb && gb.y + gb.height <= vp.height + 1,
        gb ? `btnBottom=${Math.round(gb.y + gb.height)}` : "btn not found",
      );
      await page.screenshot({ path: shot.replace(".png", "-scrolled.png") });
      await dlg.evaluate((el) => el.scrollTo(0, 0));
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: shot });

    // FAQ6 в футере
    await dlg.locator("button", { hasText: /Понятно|Got it/ }).last().click();
    await page.waitForTimeout(400);
  }

  const faq = page.getByText(/Работает ли это в Firefox\?|Does it work in Firefox\?/);
  await faq.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const faqCount = await faq.count();
  ok(`${name}: FAQ6 найден в футере`, faqCount > 0);
  if (faqCount > 0) {
    // FAQ — нативные <details>: раскрываем ответ кликом по summary
    const details = page.locator("details").filter({ has: faq.first() }).first();
    await details.locator("summary").click().catch(() => {});
    await page.waitForTimeout(300);
    const dText = await details.innerText().catch(() => "");
    ok(`${name}: FAQ6 упоминает WebBT`, /WebBT/.test(dText));
    await page.screenshot({ path: shot.replace(".png", "-faq6.png") });
  }

  await browser.close();
}

(async () => {
  await runScenario("A. Firefox Win desktop RU", {
    ua: UA_WIN,
    viewport: { width: 1280, height: 800 },
    lang: "ru",
    url: "/?nobt=1",
    shot: "work/v120-firefox-win-ru.png",
  });
  await runScenario("B. Firefox Android RU (узкий экран)", {
    ua: UA_ANDROID,
    viewport: { width: 390, height: 844 },
    lang: "ru",
    url: "/?nobt=1",
    shot: "work/v120-firefox-android-ru.png",
  });
  await runScenario("C. Firefox Win desktop EN", {
    ua: UA_WIN,
    viewport: { width: 1280, height: 800 },
    lang: "en",
    url: "/?nobt=1",
    shot: "work/v120-firefox-win-en.png",
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ИТОГ: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length) {
    console.log("Провалены:");
    failed.forEach((r) => console.log(" -", r.name, r.extra));
    process.exit(1);
  }
})().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
