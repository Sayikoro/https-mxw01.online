/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Смоук статической сборки v1.0.26 (после чистки неиспользуемого кода).
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v126-static-smoke.js
 * Предварительно: python3 -m http.server 8090 -d .next-static
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:8090";
let passed = 0;
let failed = 0;
const consoleErrors = [];
const badAssets = [];
const NOISE = /yandex\.net|ERR_CERT_AUTHORITY_INVALID/i;

function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

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

(async () => {
  // --- HTTP-проверки ---
  const index = await fetch(`${BASE}/`).then((r) => r.text());
  ok(index.includes("Показать доп. вкладки"), "SSR: стрелка доп. вкладок (v1.0.25) на месте");
  ok(index.includes("Печатать без интернета") || index.includes("WebBT"), "SSR: свежие FAQ-тексты (v1.0.20-21)");
  ok(!index.includes("mxw01lib"), "SSR: маркеров старого дерева нет");

  const robots = await fetch(`${BASE}/robots.txt`).then((r) => r.text());
  ok(robots.includes("GPTBot") && robots.includes("ClaudeBot"), "robots.txt: сгенерированная версия (ИИ-краулеры), не удалённая заглушка");
  ok(robots.includes("Sitemap"), "robots.txt: строка Sitemap");

  const manifest = await fetch(`${BASE}/manifest.webmanifest`).then((r) => r.json());
  ok(manifest && manifest.icons && manifest.icons.length === 4, "manifest.webmanifest: 4 иконки PWA");

  const llms = await fetch(`${BASE}/llms.txt`);
  ok(llms.status === 200, "llms.txt: отдаётся (200)");

  const api = await fetch(`${BASE}/api/`);
  ok(api.status === 404 || api.status === 403, `api-роут удалён (${api.status})`);

  // --- браузерная проверка ---
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));
  page.on("response", (r) => {
    if ((r.status() === 404 || r.status() === 500) && !NOISE.test(r.url())) badAssets.push(`${r.status()} ${r.url()}`);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("mxw01-lang", "ru");
  });
  await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await closeOverlays(page);

  ok(await page.getByRole("tab", { name: /Лента/ }).isVisible(), "приложение: вкладка «Лента» видна");
  const arrow = page.locator('button[aria-label="Показать доп. вкладки"]');
  ok((await arrow.count()) === 1, "приложение: стрелка доп. вкладок работает");
  await arrow.click();
  await page.waitForTimeout(500);
  ok(await page.getByRole("tab", { name: /Ценник/ }).isVisible(), "приложение: доп. вкладки выехали");
  await ctx.close();
  await browser.close();

  ok(badAssets.length === 0, `битых ассетов нет${badAssets.length ? ": " + badAssets.join(", ") : ""}`);
  ok(consoleErrors.length === 0, `консоль без ошибок (${consoleErrors.length})`);

  console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
  if (consoleErrors.length) consoleErrors.forEach((e) => console.error("  console: " + e));
  process.exit(failed ? 1 : 0);
})();
