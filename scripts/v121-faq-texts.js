/* v1.0.21: проверка новых текстов FAQ (1, 2, 3, 6) и многоабзацного ответа
 * FAQ6. Ответы читаем через textContent — видно даже внутри закрытого
 * <details>. Запуск: NODE_PATH=$(npm root -g) node scripts/v121-faq-texts.js
 */
/* eslint-disable @typescript-eslint/no-require-imports -- служебный скрипт:
 * playwright резолвим из глобального npm через NODE_PATH, ESM так не умеет */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";

const results = [];
function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
}

/** Закрыть ВСЕ оверлеи (cookie-баннер и BLE-плашку на без-BT браузере):
 * жмём видимые закрывающие кнопки, пока они есть */
async function closeCookie(page) {
  for (let i = 0; i < 4; i++) {
    const clicked = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find(
        (x) =>
          /^(Понятно|Хорошо|Got it|OK)$/i.test((x.textContent || "").trim()) &&
          vis(x),
      );
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    if (!clicked) break;
    await page.waitForTimeout(450);
  }
}

/** Текст ответа FAQ по номеру (textContent закрытого <details> тоже видно) */
async function faqAnswer(page, qRe) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const sum = [...document.querySelectorAll("details > summary")].find((s) =>
      re.test(s.textContent || ""),
    );
    if (!sum) return null;
    const det = sum.parentElement;
    const ps = [...det.querySelectorAll(":scope > div > p")];
    return { text: det.textContent || "", paragraphs: ps.map((p) => p.textContent) };
  }, qRe.source);
}

async function runScenario(name, lang) {
  console.log(`\n=== ${name} ===`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: lang === "ru" ? "ru-RU" : "en-US",
  });
  await ctx.addInitScript((l) => localStorage.setItem("mxw01-lang", l), lang);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await closeCookie(page);
  await page.waitForTimeout(600);

  const ru = lang === "ru";

  const a1 = await faqAnswer(page, /печать оффлайн|offline printing/);
  ok(`${name}: FAQ1 новый текст`, !!a1 && a1.text.includes(ru
    ? "Печатать без интернета тоже можно. Для этого просто скачайте портативную версию"
    : "You can print offline, too. Simply download the portable version"));

  const a2 = await faqAnswer(page, /Какие принтеры|Which printers/);
  ok(`${name}: FAQ2 новый текст`, !!a2 && a2.text.includes(ru
    ? "Терминал подходит для переносных Bluetooth-принтеров с лентой шириной 58 мм"
    : "The terminal is a fit for portable Bluetooth printers with 58 mm paper width"));

  const a3 = await faqAnswer(page, /драйверы|drivers/i);
  ok(`${name}: FAQ3 новый текст`, !!a3 && a3.text.includes(ru
    ? "Нет. Печать работает прямо из браузеров Chrome, Edge или Opera"
    : "No. Printing works right from the Chrome, Edge or Opera browsers"));

  const a6 = await faqAnswer(page, /Работает ли это в Firefox|work in Firefox/);
  ok(`${name}: FAQ6 десктоп-абзац`, !!a6 && a6.text.includes(ru
    ? "На настольном компьютере Firefox теперь тоже можно печатать с помощью WebBT"
    : "On a desktop computer, Firefox can now print too, thanks to WebBT"));
  ok(`${name}: FAQ6 абзац про Android`, !!a6 && a6.text.includes(ru
    ? "В Firefox для Android технология Web Bluetooth не поддерживается"
    : "Firefox for Android does not support Web Bluetooth"));
  ok(`${name}: FAQ6 = 2 абзаца`, !!a6 && a6.paragraphs.length === 2, `p=${a6 ? a6.paragraphs.length : 0}`);
  ok(`${name}: FAQ6 без упоминания iPhone/beacio`, !!a6 && !/beacio|iPhone/i.test(a6.text));

  if (ru) {
    const a6n = await faqAnswer(page, /Работает ли это в Firefox/);
    // раскрываем FAQ6 и снимаем скриншот секции FAQ
    await page.evaluate(() => {
      const sum = [...document.querySelectorAll("details > summary")].find((s) =>
        /Работает ли это в Firefox/.test(s.textContent || ""),
      );
      if (sum) sum.scrollIntoView({ block: "center" });
    });
    await page.getByText("Работает ли это в Firefox?").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "work/v121-faq6-open-ru.png" });
  }

  await browser.close();
}

(async () => {
  await runScenario("RU", "ru");
  await runScenario("EN", "en");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ИТОГ: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length) {
    failed.forEach((r) => console.log(" -", r.name));
    process.exit(1);
  }
})().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
