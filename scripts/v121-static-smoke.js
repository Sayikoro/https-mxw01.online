/* Смоук статического экспорта (.next-static на :8090): плашка ?nobt=1,
 * FAQ6 в футере, язык RU. Запуск: NODE_PATH=$(npm root -g) node scripts/v121-static-smoke.js */
/* eslint-disable @typescript-eslint/no-require-imports -- глобальный playwright */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  let fails = 0;
  const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) fails++; };

  await page.goto("http://localhost:8090/?nobt=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const dlg = page.locator('[role="dialog"]').filter({ hasText: /Браузер не поддерживается/ }).first();
  ok("плашка открылась (статический билд)", await dlg.isVisible().catch(() => false));
  const dtext = (await dlg.innerText().catch(() => "")) || "";
  ok("в плашке Chrome-кнопка (десктоп)", /Скачать Google Chrome/.test(dtext));
  // закрываем оверлеи
  for (let i = 0; i < 4; i++) {
    const clicked = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const b = [...document.querySelectorAll("button")].find(
        (x) => /^(Понятно|Хорошо|Got it|OK)$/i.test((x.textContent || "").trim()) && vis(x));
      if (b) { b.click(); return true; } return false;
    });
    if (!clicked) break;
    await page.waitForTimeout(400);
  }
  const faq = page.getByText("Работает ли это в Firefox?");
  await faq.scrollIntoViewIfNeeded().catch(() => {});
  ok("FAQ6 в футере", (await faq.count()) > 0);
  const details = page.locator("details").filter({ has: faq.first() }).first();
  await details.locator("summary").click().catch(() => {});
  await page.waitForTimeout(300);
  const d6 = await details.evaluate((el) => [...el.querySelectorAll(":scope > div > p")].map((p) => p.textContent));
  ok("FAQ6 = 2 абзаца с WebBT", d6.length === 2 && d6.join(" ").includes("WebBT"));

  const assets = [];
  page.on("response", (r) => { if (r.status() >= 400) assets.push(r.status() + " " + r.url()); });
  await page.reload({ waitUntil: "networkidle" });
  ok("нет битых ассетов (4xx/5xx)", assets.length === 0, assets.join(", "));

  await browser.close();
  console.log(fails ? `ИТОГ: ${fails} FAIL` : "ИТОГ: всё PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
