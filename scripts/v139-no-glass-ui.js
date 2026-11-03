/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * v1.0.39 — контрольный скриншот меню настроек после удаления Liquid Glass:
 * секции «Экспериментально» быть не должно, вёрстка не уезжает вниз.
 */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("mxw01-lang", "ru");
      localStorage.setItem("mxw01-liquid-glass", "1"); // остаток от старой версии
    } catch (e) {}
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="tape-save-page"]', { timeout: 30000 });
  await page.evaluate(() => {
    const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 8000 });
  await page.waitForTimeout(600);
  const htmlCls = await page.evaluate(() => document.documentElement.className);
  const noGlassSwitch = (await page.locator('[data-testid="glass-switch"]').count()) === 0;
  const noExperimental = (await page.locator('[data-testid="experimental-toggle"]').count()) === 0;
  console.log(`классы <html>: "${htmlCls}"`);
  console.log(`секция «Экспериментально» удалена: ${noExperimental ? "✓" : "✗"}`);
  console.log(`переключатель стекла удалён: ${noGlassSwitch ? "✓" : "✗"}`);
  await page.screenshot({ path: path.join(__dirname, "..", "work", "v139-settings-no-glass.png"), fullPage: false });
  console.log("скриншот: work/v139-settings-no-glass.png");
  await browser.close();
  process.exit(noGlassSwitch && noExperimental && !/glass/.test(htmlCls) ? 0 : 1);
})();
