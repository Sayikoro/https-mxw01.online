/* eslint-disable @typescript-eslint/no-require-imports */
// Смоук-тест офлайн-версии (file://): загрузка, гидрация, чистая консоль;
// в настройках: версия приложения, «Разрешение печати (DPI)»,
// «Диагностика подключения». Язык форсируется RU (mxw01-lang), как в v141/v143.
const { chromium } = require('playwright');

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.addInitScript(() => {
    try { localStorage.setItem('mxw01-lang', 'ru'); } catch {}
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = `${m.text()} ${m.location()?.url || ''}`;
    if (/favicon|404|net::ERR|metrika|mc\.yandex|googletagmanager|Failed to load resource/i.test(where)) return;
    errors.push('console: ' + m.text());
  });

  await page.goto('file:///home/z/my-project/download/mxw01-offline.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => (document.body?.innerText || '').length > 200, undefined, { timeout: 20000 });

  // Закрыть BLE-предупреждение, если появилось
  try { await page.getByRole('button', { name: /Понятно|Got it/ }).click({ timeout: 4000 }); } catch {}

  // Открыть настройки
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
      if (btn) btn.click();
    });
    try { await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 6000 }); opened = true; }
    catch { await page.waitForTimeout(700); }
  }

  const dialogText = opened ? await page.locator('[role="dialog"][data-state="open"]').innerText() : '';
  const bodyText = await page.evaluate(() => document.body.innerText);

  const checks = {
    'заголовок содержит MXW01': /MXW01/i.test(await page.title()),
    'меню настроек открылось': opened,
    'версия приложения в настройках (1.0.x)': /1\.0\.\d+/.test(dialogText),
    '«Разрешение печати (DPI)» в настройках': dialogText.includes('Разрешение печати (DPI)'),
    '«Диагностика подключения» в настройках': dialogText.includes('Диагностика подключения'),
    'редактор ленты отрисован (RU)': /Лента/.test(bodyText),
    'нет ошибок консоли': errors.length === 0,
  };

  console.log('title:', await page.title());
  for (const [k, v] of Object.entries(checks)) console.log(v ? '✓' : '✗', k);
  if (errors.length) { console.log('ОШИБКИ:'); errors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200))); }

  await page.screenshot({ path: 'work/v144-offline-settings.png', fullPage: false });
  await browser.close();
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})();
