/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.63 — печать на MX10 через сервис ae30 (kitty-web профиль).
 * Запуск: NODE_PATH=$(npm root -g) timeout 240 node scripts/v163-mx10-ae30.js
 * (BASE_URL по умолчанию http://localhost:3000 — поднимите php -S -t .next-static)
 *
 * Живой отчёт v1.0.62: пользователь переключился на «MX10 (cat)», печать
 * «прошла» (тост честный на GATT-уровне), но принтер молчал. Причины,
 * закрываемые в v1.0.63:
 *   1. сервис ae30 (его рекламируют MX10-клоны, kitty-web CAT_PRINT_SRV)
 *      не был ни в optionalServices, ни в профилях — транспорт писал не туда
 *      или падал в noProfile; теперь AE30 — ПЕРВЫЙ профиль cat-транспорта
 *      (tx ae01, rx ae02);
 *   2. не было подписки с разбором состояния 51 78 … 01: бит 0x10 = «пауза
 *      подачи (буфер полон)» — теперь send() ЖДЁТ снятия паузы (как
 *      kitty-web flush), а бумага/крышка/перегрев дают честный тост;
 *   3. «Тестовая страница» в шапке всегда печатала через MXW01-драйвер —
 *      теперь диспетчеризуется по активному транспорту (как вкладки).
 *
 * Стаб GATT СТРОГИЙ: устройство exposing ТОЛЬКО сервис ae30 (ae01/ae02/ae03),
 * как реальный клон. Сценарии:
 *   A. подключение → профиль AE30 → пауза (0x10) → тест-страница → отправка
 *      ЖДЁТ паузу → resume (0x00) → задание доехало целиком (хвост 51 78 a3);
 *   B. нет бумаги (0x01) до печати → честный тост про бумагу, запись не идёт;
 *   C. регресс: принтер с сервисом ae00 (thermy-профиль) по-прежнему работает.
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
  const sels = ['[data-testid="cookie-accept"]'];
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
  throw new Error("Не удалось открыть Настройки");
}

async function closeAllDialogs(page) {
  for (let i = 0; i < 4; i++) {
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-slot="dialog-overlay"]'));
    if (!stillOpen) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

/* Строгий стаб «котового принтера с сервисом ae30» (как kitty-web):
 * других сервисов НЕТ — getPrimaryService на всё прочее кидает NotFound.
 * Хуки для теста: __catWritten() — все записанные байты, __catEmitState(kind)
 * — кадр состояния принтера (pause/resume/paper) в notify-подписку. */
const CAT_AE30_STUB = `
(() => {
  const written = [];
  const handlers = [];
  const writeChar = {
    properties: { write: true, writeWithoutResponse: true, read: false, notify: false, indicate: false },
    uuid: "0000ae01-0000-1000-8000-00805f9b34fb",
    writeValue: async (d) => { written.push(Array.from(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))); },
    writeValueWithoutResponse: async (d) => { written.push(Array.from(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))); },
  };
  const notifyChar = {
    properties: { write: false, writeWithoutResponse: false, read: false, notify: true, indicate: false },
    uuid: "0000ae02-0000-1000-8000-00805f9b34fb",
    startNotifications: async () => notifyChar,
    stopNotifications: async () => notifyChar,
    addEventListener: (t, h) => handlers.push(h),
    removeEventListener: (t, h) => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); },
  };
  const num = (u) => (typeof u === "number" ? u : parseInt(String(u).slice(4, 8), 16));
  const service = {
    uuid: "0000ae30-0000-1000-8000-00805f9b34fb",
    getCharacteristic: async (uuid) => {
      const n = num(uuid);
      if (n === 0xae01 || n === 0xae03) return writeChar;
      if (n === 0xae02) return notifyChar;
      throw new Error("NotFoundError: char " + uuid);
    },
  };
  const server = {
    connected: true,
    connect: async () => server,
    disconnect: () => { server.connected = false; },
    getPrimaryService: async (uuid) => {
      if (num(uuid) === 0xae30) return service;
      throw new Error("NotFoundError: service " + uuid);
    },
    getPrimaryServices: async () => [service],
  };
  const device = {
    id: "cat-ae30", name: "MX10",
    addEventListener: () => {}, removeEventListener: () => {},
    gatt: { connected: true, connect: () => Promise.resolve(server), disconnect: () => {} },
  };
  try {
    Object.defineProperty(navigator, "bluetooth", {
      value: { requestDevice: () => Promise.resolve(device) },
      configurable: true,
    });
  } catch {}
  window.__catWritten = () => written;
  window.__catEmitState = (kind) => {
    const frames = {
      pause:  [0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff],
      resume: [0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff],
      paper:  [0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x01, 0x07, 0xff],
      ready:  [0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff],
    };
    const f = frames[kind];
    if (!f) return false;
    const dv = new DataView(new ArrayBuffer(f.length));
    f.forEach((v, i) => dv.setUint8(i, v));
    const ev = { target: { value: dv } };
    handlers.slice().forEach((h) => { try { h(ev); } catch {} });
    return true;
  };
})();
`;

/* Стаб принтера с ТЕРМИЧЕСКИМ сервисом ae00 (thermy-профиль), без ae30 —
 * регресс-гарантия, что перестановка профилей не сломала старые устройства */
const CAT_AE00_STUB = `
(() => {
  const written = [];
  const writeChar = {
    properties: { write: true, writeWithoutResponse: true, read: false, notify: false, indicate: false },
    uuid: "0000ae01-0000-1000-8000-00805f9b34fb",
    writeValue: async (d) => { written.push(1); },
    writeValueWithoutResponse: async (d) => { written.push(1); },
  };
  const num = (u) => (typeof u === "number" ? u : parseInt(String(u).slice(4, 8), 16));
  const service = {
    uuid: "0000ae00-0000-1000-8000-00805f9b34fb",
    getCharacteristic: async (uuid) => {
      if (num(uuid) === 0xae01) return writeChar;
      throw new Error("NotFoundError: char " + uuid);
    },
  };
  const server = {
    connected: true,
    connect: async () => server,
    disconnect: () => { server.connected = false; },
    getPrimaryService: async (uuid) => {
      if (num(uuid) === 0xae00) return service;
      throw new Error("NotFoundError: service " + uuid);
    },
    getPrimaryServices: async () => [service],
  };
  const device = {
    id: "cat-ae00", name: "MX10-AE00",
    addEventListener: () => {}, removeEventListener: () => {},
    gatt: { connected: true, connect: () => Promise.resolve(server), disconnect: () => {} },
  };
  try {
    Object.defineProperty(navigator, "bluetooth", {
      value: { requestDevice: () => Promise.resolve(device) },
      configurable: true,
    });
  } catch {}
  window.__catWritten = () => written;
})();
`;

async function switchToCatAndConnect(page) {
  await page.locator('[data-testid="transport-select"]').click();
  await page.locator('[data-testid="transport-cat"]').click();
  await page.locator('[data-testid="cat-connect"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll("header span.bg-orange-600").length === 1,
    { timeout: 15000 }
  );
}

/* Хвост задания cat: последний кадр — get_device_state */
const JOB_TAIL = "51 78 a3 00 01 00 00 00 ff";
function flatTail(written) {
  const flat = written.flat();
  return flat.slice(-9).map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- A: ae30-профиль + пауза подачи + полное задание ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(CAT_AE30_STUB);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await dismissPopups(page);

    await switchToCatAndConnect(page);
    ok(true, "A: подключение к стабу ae30 прошло (оранжевый чип)");

    await openSettings(page);
    // Принтер сообщает ПАУЗУ подачи (буфер полон) прямо перед печатью;
    // через 1.5 с — resume: send() обязан дождаться, иначе байты потеряются
    await page.evaluate(() => window.__catEmitState("pause"));
    const t0 = Date.now();
    setTimeout(() => page.evaluate(() => window.__catEmitState("resume")).catch(() => {}), 1500);
    await page.locator('[data-testid="test-page"]').click();
    // Ждём хвост задания (get_device_state) — до 30 с
    await page.waitForFunction(
      (tail) => {
        const w = window.__catWritten ? window.__catWritten() : [];
        if (!w.length) return false;
        const last = w.flat().slice(-9).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        return last === tail;
      },
      JOB_TAIL,
      { timeout: 30000 }
    );
    const elapsed = Date.now() - t0;
    ok(elapsed >= 1500, `A: отправка ждала паузу подачи (${elapsed} мс ≥ 1500)`);
    ok(elapsed < 20000, `A: после resume отправка завершилась быстро (${elapsed} мс)`);

    const stats = await page.evaluate(() => {
      const w = window.__catWritten();
      const flat = w.flat();
      let bitmaps = 0;
      for (let i = 0; i < flat.length - 2; i++) {
        if (flat[i] === 0x51 && flat[i + 1] === 0x78 && flat[i + 2] === 0xa2) bitmaps++;
      }
      return { writes: w.length, bytes: flat.length, bitmaps };
    });
    ok(stats.bytes > 500, `A: задание записано в ae01 (${stats.bytes} Б, ${stats.writes} записей)`);
    ok(stats.bitmaps >= 1, `A: в потоке есть BITMAP-кадры 0xa2 (${stats.bitmaps})`);

    // Диагностика: профиль AE30 и обработка паузы в журнале
    const diagText = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="cat-diagnostics-open"]');
      if (btn) btn.click();
      return true;
    });
    await page.waitForTimeout(700);
    const body = await page.evaluate(() => document.body.innerText);
    ok(/AE30 \(cat MX10/.test(body), "A: в журнале диагностики профиль AE30 (cat MX10)");
    ok(/паузу|пауза/.test(body), "A: в журнале отражена пауза подачи");
    ok(/снята|продолжаем/.test(body), "A: в журнале отражено возобновление");

    await page.screenshot({ path: path.join(WORK, "v163-ae30.png") });
    await closeAllDialogs(page);
    await ctx.close();
    ok(errors.length === 0, `A: нет pageerror (${errors.length})`);
    if (errors.length) console.error(errors.join("\n"));
  }

  /* ---------- B: нет бумаги → честный тост, запись не идёт ------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(CAT_AE30_STUB);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await dismissPopups(page);

    await switchToCatAndConnect(page);
    await page.evaluate(() => window.__catEmitState("paper")); // out_of_paper

    await openSettings(page);
    await page.locator('[data-testid="test-page"]').click();
    await page.waitForTimeout(4000);

    const toastText = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[role="status"], [data-state] li, li[data-state]'));
      return els.map((e) => e.textContent || "").join(" | ");
    });
    ok(/бумаг|out of paper/i.test(toastText), `B: тост честно про бумагу («${toastText.slice(0, 80)}»)`);
    const bytes = await page.evaluate(() => window.__catWritten().flat().length);
    ok(bytes === 0, `B: при отсутствии бумаги задание не отправлялось (${bytes} Б)`);

    await closeAllDialogs(page);
    await ctx.close();
    ok(errors.length === 0, `B: нет pageerror (${errors.length})`);
  }

  /* ---------- C: регресс — принтер с сервисом ae00 (thermy) ------------ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(CAT_AE00_STUB);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 30000 });
    await dismissPopups(page);

    await switchToCatAndConnect(page);
    ok(true, "C: ae00-принтер подключился (оранжевый чип)");
    const written = await page.evaluate(() => window.__catWritten().length);
    ok(written === 0, "C: без печати записей нет");

    await ctx.close();
    ok(errors.length === 0, `C: нет pageerror (${errors.length})`);
  }

  await browser.close();

  console.log(failures === 0 ? "\n✓ v163: все проверки пройдены" : `\n✗ v163: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
