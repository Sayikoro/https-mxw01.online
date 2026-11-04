/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.58 — ссылка «Разработчик» (Telegram) + самоходная телеметрия.
 * Запуск: NODE_PATH=$(npm root -g) timeout 180 node scripts/v158-dev-link.js
 * (BASE_URL по умолчанию http://localhost:3000 — поднимите php -S -t .next-static)
 *
 * Кейсы:
 *   1. В Настройках видна ссылка «Разработчик» на https://t.me/The_Sovereign_o_f_Dawn
 *      (target=_blank, иконка, подпись локализована RU/EN);
 *   1b. В ФУТЕРЕ (сторона пользователя, v1.0.60) видна та же ссылка —
 *      без открытия настроек, с иконкой и локализованной подписью;
 *   2. Версия в Настройках — v1.0.60;
 *   3. Телеметрия: на /admin/hit.php ушёл POST с JSON (type=page, vid, p)
 *      — navigator.sendBeacon перехватывается как request POST;
 *   4. Ссылка открывает адрес Telegram в новой вкладке (проверка href/target);
 *   5. Нет pageerror.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "work");
if (!fs.existsSync(WORK)) fs.mkdirSync(WORK, { recursive: true });

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

async function dismissPopups(page) {
  try {
    await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 2500 });
    await page.waitForTimeout(250);
  } catch {}
  const sels = [
    '[data-testid="cookie-accept"]',
    'button:has-text("Принять")',
    'button:has-text("Accept")',
  ];
  for (const sel of sels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 })) {
        await el.click({ force: true });
        await page.waitForTimeout(250);
      }
    } catch {}
  }
}

async function openSettings(page) {
  await dismissPopups(page);
  for (let i = 0; i < 4; i++) {
    await dismissPopups(page);
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
      if (btn) btn.click();
    });
    try {
      await page.waitForSelector('[data-testid="check-updates"]', { timeout: 6000 });
      return;
    } catch {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissPopups(page);
  await page.evaluate(() => {
    const btn = document.querySelector('header button[title="Настройки"], header button[title="Settings"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('[data-testid="check-updates"]', { timeout: 6000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  /* Перехват телеметрии: /admin/hit.php — считаем POST-хиты и пишем тела */
  const HIT_URL = /\/admin\/hit\.php$/;
  const hits = [];
  await page.route(HIT_URL, async (r) => {
    let body = "";
    try { body = r.request().postData() || ""; } catch {}
    hits.push({ method: r.request().method(), body });
    await r.fulfill({ status: 204, body: "" });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30000 });

  // 1b. Футер: кредит разработчика на стороне пользователя (v1.0.60)
  const fdev = page.locator('[data-testid="footer-developer-link"]');
  await fdev.scrollIntoViewIfNeeded();
  ok((await fdev.count()) === 1 && (await fdev.isVisible()),
    "футер: ссылка «Разработчик» видна без открытия настроек");
  ok(((await fdev.getAttribute("href")) ?? "") === "https://t.me/The_Sovereign_o_f_Dawn",
    "футер: href ведёт на Telegram");
  ok((await fdev.getAttribute("target")) === "_blank" && /noopener/.test((await fdev.getAttribute("rel")) ?? ""),
    "футер: ссылка в новой вкладке с noopener");
  ok(/Разработчик|Developer/.test((await fdev.innerText()).replace(/\s+/g, " ")) &&
     /@The_Sovereign_o_f_Dawn/.test((await fdev.innerText()).replace(/\s+/g, " ")),
    "футер: подпись «Разработчик: @The_Sovereign_o_f_Dawn»");
  ok((await fdev.locator("svg").count()) >= 1, "футер: у ссылки есть иконка");

  await openSettings(page);

  // 1. Ссылка «Разработчик»
  const link = page.locator('[data-testid="developer-link"]');
  ok((await link.count()) === 1 && (await link.isVisible()),
    "ссылка «Разработчик» видна в Настройках");
  const href = (await link.getAttribute("href")) ?? "";
  ok(href === "https://t.me/The_Sovereign_o_f_Dawn",
    `href ведёт на Telegram (${href})`);
  ok((await link.getAttribute("target")) === "_blank" && /noreferrer/.test((await link.getAttribute("rel")) ?? ""),
    "ссылка в новой вкладке с noreferrer");
  const label = await link.innerText();
  ok(/Разработчик|Developer/.test(label) && /@The_Sovereign_o_f_Dawn/.test(label),
    `подпись «Разработчик: @The_Sovereign_o_f_Dawn» (${label.replace(/\s+/g, " ").trim().slice(0, 50)}…)`);
  ok((await link.locator("svg").count()) >= 1, "у ссылки есть иконка");

  // 2. Версия
  const ver = await page.locator('[data-testid="app-version"]').innerText();
  ok(ver.includes("1.0.60"), `в Настройках версия 1.0.60 (${ver.trim()})`);

  // 3. Телеметрия: page-хит ушёл на /admin/hit.php
  await page.waitForTimeout(1200);
  const pageHits = hits.filter((h) => h.method === "POST" && /"type":"page"/.test(h.body));
  ok(pageHits.length >= 1, `на /admin/hit.php ушёл page-хит (${hits.length} всего)`);
  if (pageHits.length) {
    let j = {};
    try { j = JSON.parse(pageHits[0].body); } catch {}
    ok(/^[0-9a-f]{8,32}$/.test(j.vid || ""), `в хите есть vid (${String(j.vid).slice(0, 6)}…)`);
    ok(typeof j.p === "string" && j.p.length > 0, `в хите есть путь страницы (${j.p})`);
    ok(typeof j.w === "number" && typeof j.h === "number", "в хите есть размер окна");
  }

  // 4. Никаких утечек: в хите нет referrer-полного URL с http
  if (pageHits.length) {
    let j = {};
    try { j = JSON.parse(pageHits[0].body); } catch {}
    ok(j.ref === "" || j.ref === undefined || !/^https?:\/\//.test(j.ref || ""),
      "реферер урезан до host/path (без протокола)");
  }

  await page.screenshot({ path: path.join(WORK, "v158-dev-link.png") });
  await browser.close();

  ok(errors.length === 0, `нет pageerror (${errors.length})`);
  if (errors.length) console.error(errors.join("\n"));

  console.log(failures === 0 ? "\n✓ v158: все проверки пройдены" : `\n✗ v158: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
