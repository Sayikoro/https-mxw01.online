/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.59 — мастер самообновления (кнопка «Обновить сейчас до vX»).
 * Запуск: NODE_PATH=$(npm root -g) timeout 240 node scripts/v159-self-update.js
 *
 * Реальная панель /update недостижима из dev-сервера, поэтому внутри страницы
 * (addInitScript) перехватывается window.fetch для /update/: виртуальная панель
 * с семантикой настоящей (CSRF в форме, POST → redirect → GET со flash,
 * сессия, «MXW01 updater vX» в футере). GitHub-проверка мокается через
 * page.route как в v156. Проверяются РЕАЛЬНЫЕ функции мастера:
 *   1. Панель готова (v1.0.59), но не авторизованы → поле пароля + кнопка;
 *   2. Неверный пароль → upd-error, установка не идёт;
 *   3. Верный пароль → фазы вход/установка → upd-done «Готово! Сайт обновлён»;
 *   4. Пароль запомнился в localStorage (mxw01.updpass);
 *   5. Панель устарела (v1.0.57) → инструкция + ссылка на кит;
 *   6. Панель без пароля (форма setup) → два поля, пароль создаётся, установка.
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
  for (const sel of ['[data-testid="cookie-accept"]', 'button:has-text("Принять")', 'button:has-text("Accept")']) {
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

  const GH_URL = /api\.github\.com\/repos\/.+\/releases\/latest/;
  const ghReply = (tag) => ({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(tag ? { tag_name: tag } : { message: "Not Found" }),
  });

  /* ---------- Сценарий A: панель готова, вход по паролю ---------- */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(`
      (() => {
        const state = { csrf: "T0KEN-ABC123", authed: false, hasPass: true, pass: "secret123", installFail: false };
        const realFetch = window.fetch.bind(window);
        const render = (kind) => {
          const flash = kind === "err-login"
            ? '<div class="flash err">Неверный пароль (неудачных попыток: 1)</div>'
            : kind === "ok-install"
              ? '<div class="flash ok">Обновлено с GitHub (testuser/mxw01): файлов 68. Версия: 1.0.59 → 1.0.99. Резервная копия: backup-1.0.59.zip</div>'
              : "";
          const csrf = '<input type="hidden" name="csrf" value="' + state.csrf + '">';
          const forms = state.authed
            ? '<form method="post">' + csrf + '<input type="hidden" name="action" value="git_install"><button>Обновить</button></form>'
            : '<form method="post">' + csrf + '<input type="hidden" name="action" value="login"><input type="password" name="password"></form>';
          return '<html><head><title>Обновление сайта MXW01</title></head><body>' + flash + forms +
                 '<p class="muted">MXW01 updater v1.0.59 · деплой-кит поставляется с этой панелью</p></body></html>';
        };
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (!url.includes("/update/")) return realFetch(input, init);
          const method = ((init && init.method) || "GET").toUpperCase();
          const body = new URLSearchParams((init && init.body) || "");
          const respond = (html) => Promise.resolve(new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
          if (method === "POST") {
            const action = body.get("action");
            if (action === "login") {
              if (body.get("password") === state.pass) { state.authed = true; return respond(render("idle")); }
              return respond(render("err-login"));
            }
            if (action === "git_install") {
              if (!state.authed) return respond(render("err-login"));
              return respond(render("ok-install"));
            }
          }
          return respond(render("idle"));
        };
      })();
    `);
    await page.route(GH_URL, (r) => r.fulfill(ghReply("v1.0.99")));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await openSettings(page);
    await page.locator('[data-testid="check-updates"]').click();

    const wizard = page.locator('[data-testid="update-wizard"]');
    await wizard.waitFor({ state: "visible", timeout: 12000 });
    ok(true, "A: мастер показан");
    const pass = page.locator('[data-testid="upd-pass"]');
    await pass.waitFor({ state: "visible", timeout: 9000 });
    ok(true, "A: панель готова, но требует вход → поле пароля показано");

    /* неверный пароль */
    await pass.fill("wrongpass");
    await page.locator('[data-testid="upd-install"]').click();
    const err = page.locator('[data-testid="upd-error"]');
    await err.waitFor({ state: "visible", timeout: 9000 });
    const errText = await err.innerText();
    ok(/приняла пароль|rejected the password/.test(errText), `A: неверный пароль → ошибка мастера (${errText.slice(0, 48)}…)`);

    /* верный пароль */
    await pass.fill("secret123");
    await page.locator('[data-testid="upd-install"]').click();
    const done = page.locator('[data-testid="upd-done"]');
    await done.waitFor({ state: "visible", timeout: 15000 });
    const doneText = await done.innerText();
    ok(/Готово|Done/.test(doneText), `A: установка прошла → «Готово» (${doneText.slice(0, 48)}…)`);
    const stored = await page.evaluate(() => localStorage.getItem("mxw01.updpass"));
    ok(stored === "secret123", "A: галочка «запомнить» → пароль в localStorage этого браузера");
    ok(errors.length === 0, `A: нет pageerror (${errors.length})`);
    if (errors.length) console.error(errors.join("\n"));
    await page.screenshot({ path: path.join(WORK, "v159-self-update-ready.png") });
    await page.close();
  }

  /* ---------- Сценарий B: панель устарела (v1.0.57) ---------- */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(`
      (() => {
        const realFetch = window.fetch.bind(window);
        const html = '<html><body><form><input type="hidden" name="csrf" value="OLD"><input type="hidden" name="action" value="login"><input type="password" name="password"></form>' +
          '<p class="muted">MXW01 updater · деплой-кит поставляется с этой панелью</p></body></html>';
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (!url.includes("/update/")) return realFetch(input, init);
          return Promise.resolve(new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
        };
      })();
    `);
    await page.route(GH_URL, (r) => r.fulfill(ghReply("v1.0.99")));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await openSettings(page);
    await page.locator('[data-testid="check-updates"]').click();
    await page.locator('[data-testid="update-wizard"]').waitFor({ state: "visible", timeout: 12000 });
    const kit = page.locator('[data-testid="upd-kit-link"]');
    await kit.waitFor({ state: "visible", timeout: 9000 });
    ok(true, "B: старая панель → инструкция с ссылкой на кит");
    const khref = (await kit.getAttribute("href")) ?? "";
    ok(khref.endsWith("/releases/latest/download/mxw01-deploy-kit.zip"), `B: прямая ссылка на кит (${khref})`);
    ok((await page.locator('[data-testid="upd-reprobe"]').count()) === 1, "B: кнопка «Проверить снова» на месте");
    ok((await page.locator('[data-testid="upd-install"]').count()) === 0, "B: кнопки установки НЕТ (панель не готова)");
    await page.screenshot({ path: path.join(WORK, "v159-self-update-old.png") });
    await page.close();
  }

  /* ---------- Сценарий C: панель без пароля (первый запуск) ---------- */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(`
      (() => {
        const state = { csrf: "T0KEN-SETUP", authed: false, hasPass: false, pass: "" };
        const realFetch = window.fetch.bind(window);
        const render = (kind) => {
          const flash = kind === "ok-install"
            ? '<div class="flash ok">Обновлено с GitHub (testuser/mxw01): файлов 68. Версия: 1.0.59 → 1.0.99. Резервная копия: backup.zip</div>' : "";
          const csrf = '<input type="hidden" name="csrf" value="' + state.csrf + '">';
          const forms = state.authed
            ? '<form method="post">' + csrf + '<input type="hidden" name="action" value="git_install"><button>Обновить</button></form>'
            : state.hasPass
              ? '<form method="post">' + csrf + '<input type="hidden" name="action" value="login"><input type="password" name="password"></form>'
              : '<form method="post">' + csrf + '<input type="hidden" name="action" value="setup"><input type="password" name="password"><input type="password" name="password2"></form>';
          return '<html><head><title>Обновление сайта MXW01</title></head><body>' + flash + forms +
                 '<p class="muted">MXW01 updater v1.0.59 · деплой-кит поставляется с этой панелью</p></body></html>';
        };
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (!url.includes("/update/")) return realFetch(input, init);
          const method = ((init && init.method) || "GET").toUpperCase();
          const body = new URLSearchParams((init && init.body) || "");
          const respond = (html) => Promise.resolve(new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
          if (method === "POST") {
            const action = body.get("action");
            if (action === "setup") { state.pass = body.get("password") || ""; state.hasPass = true; return respond(render("idle")); }
            if (action === "login") {
              if (body.get("password") === state.pass) { state.authed = true; return respond(render("idle")); }
              return respond(render("err"));
            }
            if (action === "git_install") {
              if (!state.authed) return respond(render("err"));
              return respond(render("ok-install"));
            }
          }
          return respond(render("idle"));
        };
      })();
    `);
    await page.route(GH_URL, (r) => r.fulfill(ghReply("v1.0.99")));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await openSettings(page);
    await page.locator('[data-testid="check-updates"]').click();
    await page.locator('[data-testid="update-wizard"]').waitFor({ state: "visible", timeout: 12000 });
    const p1 = page.locator('[data-testid="upd-pass"]');
    const p2 = page.locator('[data-testid="upd-pass2"]');
    await p1.waitFor({ state: "visible", timeout: 9000 });
    ok((await p2.count()) === 1, "C: панель без пароля → два поля (создание пароля)");
    await p1.fill("newpass99");
    await p2.fill("newpass99");
    await page.locator('[data-testid="upd-install"]').click();
    const done = page.locator('[data-testid="upd-done"]');
    await done.waitFor({ state: "visible", timeout: 15000 });
    ok(true, "C: пароль создан + вход + установка → «Готово»");
    await page.screenshot({ path: path.join(WORK, "v159-self-update-setup.png") });
    await page.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\n✓ v159: все проверки пройдены" : `\n✗ v159: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
