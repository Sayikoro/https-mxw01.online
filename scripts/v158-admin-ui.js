/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.58 — UI админки /admin в браузере (живой дашборд).
 * Запуск: bash-стенд в scripts/v158-admin-ui.sh поднимает сайт+хиты,
 * затем: node scripts/v158-admin-ui.js
 *
 * Кейсы:
 *   1. Первый запуск → создание пароля → дашборд;
 *   2. KPI ожили: «сейчас на сайте» > 0, просмотры сегодня > 0 (твин отработал);
 *   3. SVG-графики нарисованы (rect-ы в часах и за 30 дней, линия polyline);
 *   4. Лента визитов заполнена, топ-строки есть;
 *   5. Повторный опрос API живёт (fetch 5 с) — счётчик «обновлено» тикает;
 *   6. Нет pageerror.
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8107";
const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "work");

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures += 1; console.error(`  ✗ ${msg}`); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE + "/admin/", { waitUntil: "domcontentloaded" });

  // 1. Создание пароля
  await page.waitForSelector('input[name="password"]', { timeout: 10000 });
  await page.fill('input[name="password"]', "adminpass99");
  await page.fill('input[name="password2"]', "adminpass99");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#v-vt", { timeout: 10000 });
  ok(true, "пароль создан — открылся дашборд");

  // 2. KPI ожили (первый poll)
  await page.waitForFunction(() => {
    const vt = document.querySelector("#v-vt");
    const live = document.querySelector("#v-live");
    return vt && live && Number(vt.textContent.replace(/\D/g, "")) > 0 && Number(live.textContent) > 0;
  }, { timeout: 12000 });
  const vt = await page.locator("#v-vt").innerText();
  const live = await page.locator("#v-live").innerText();
  ok(Number(vt.replace(/\D/g, "")) > 0, `просмотры сегодня посчитаны (${vt})`);
  ok(Number(live) > 0, `«сейчас на сайте» > 0 (${live})`);

  // 3. Графики
  const rectsH = await page.locator("#ch-hours rect").count();
  const rectsD = await page.locator("#ch-days rect").count();
  const line = await page.locator("#ch-days polyline").count();
  const spark = await page.locator("#ch-spark rect").count();
  ok(rectsH === 24, `часовой график: 24 столбца (${rectsH})`);
  ok(rectsD === 30 && line === 1, `30-дневный график: 30 столбцов + линия (${rectsD}/${line})`);
  ok(spark === 30, `спарклайн: 30 столбцов (${spark})`);

  // 4. Лента и топы
  const feedRows = await page.locator("#feed .frow").count();
  ok(feedRows > 0, `лента визитов заполнена (${feedRows} строк)`);
  const topRows = await page.locator("#t-pages .trow").count();
  ok(topRows > 0, `топ страниц заполнен (${topRows} строк)`);
  const tagText = await page.locator("#feed .tag").first().innerText();
  ok(/просмотр|пинг/.test(tagText), `тип события в ленте (${tagText})`);

  // 5. Живой опрос: «обновлено» тикает
  const t1 = await page.locator("#upd").innerText();
  await page.waitForTimeout(5600);
  const t2 = await page.locator("#upd").innerText();
  ok(t1 !== t2 && /обновлено/.test(t2), `опрос живёт (${t1} → ${t2})`);

  // 6. Настройки на месте, пароль маскирован
  const masked = await page.locator("text=•••••••• — хранится только хеш").count();
  ok(masked >= 1, "пароль в настройках маскирован точками");

  await page.screenshot({ path: path.join(WORK, "v158-admin-ui.png"), fullPage: true });
  await browser.close();

  ok(errors.length === 0, `нет pageerror (${errors.length})`);
  if (errors.length) console.error(errors.join("\n"));
  console.log(failures === 0 ? "\n✓ v158-admin-ui: все проверки пройдены" : `\n✗ v158-admin-ui: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
