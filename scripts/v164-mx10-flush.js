/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.64 — модель отправки kitty-web (flush-буфер целых кадров).
 * Запуск: NODE_PATH=$(npm root -g) timeout 300 node scripts/v164-mx10-flush.js
 * (BASE_URL по умолчанию http://localhost:3000 — поднимите php -S -t .next-static)
 *
 * Живой отчёт (продолжение v1.0.63): после переключения на «MX10 (cat)»
 * печать «прошла» (тост честный на GATT-уровне), но принтер молчал. Разбор
 * по эталонной web-реализации kitty-web (NaitLee) выявил расхождения
 * транспорта, закрываемые в v1.0.64:
 *   1. поток резался на произвольные 180-байтные чанки — кадры рвались
 *      посередине, приёмный буфер MCU переполнялся; kitty-web копит кадры
 *      в буфер 200 Б ЦЕЛЫМИ и пишет буфер ОДНОЙ записью;
 *   2. пауза подачи проверялась раз в 16 чанков (~2,9 КБ) — у kitty-web
 *      ПЕРЕД КАЖДЫМ flush (то есть каждые ≤200 Б);
 *   3. пустые строки отправлялись пустыми BITMAP-кадрами — kitty-web
 *      превращает их в feed(n) на скорости 8;
 *   4. дефолты thermy (35/8000/50) — у kitty-web 32/24000/100; 8000
 *      энергии на части клонов даёт слишком бледную/невидимую печать.
 *
 * Стаб GATT СТРОГИЙ: устройство exposing ТОЛЬКО сервис ae30 (ae01/ae02),
 * как реальный клон. Проверки:
 *   A. тест-страница → каждая запись ≤ 200 Байт (flush-буфер);
 *   B. поток корректно разбирается на кадры 51 78 … с верным CRC
 *      (записи не рвут кадры) + есть BITMAP и FEED + дефолты 32/24000;
 *   C. пауза подачи → отправка ждёт ≥1,5 с → resume → задание доехало;
 *   D. в журнале диагностики — flush-модель (≤200 Б, пауза 20 мс);
 *   E. нет бумаги → честный тост, НОЛЬ байт (регресс v1.0.63).
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
 * других сервисов НЕТ. __catWritten() — записанные блоки (каждый блок —
 * одна BLE-запись), __catEmitState(kind) — кадр состояния в notify. */
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

/* CRC-8 poly 0x07 (та же таблица, что в cat-protocol) — для проверки кадров */
const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    t[i] = crc;
  }
  return t;
})();
function crc8(bytes) {
  let crc = 0;
  for (const b of bytes) crc = CRC8_TABLE[(crc ^ b) & 0xff];
  return crc & 0xff;
}

/** Разбор потока байт на кадры 51 78 … crc ff. Кадр камеры (cmd 0xbc) —
 * МАГИЧЕСКИЙ сырой кадр из thermy/kitty-web (51 78 bc 00 01 02 01 2d ff):
 * его поля len не следуют стандартной раскладке — оба эталона шлют его
 * дословно, поэтому парсер считает его фиксированными 9 байтами. */
function parseFrames(flat) {
  const frames = [];
  let i = 0;
  while (i < flat.length) {
    if (flat[i] !== 0x51 || flat[i + 1] !== 0x78) return { ok: false, at: i, frames };
    const cmd = flat[i + 2];
    if (cmd === 0xbc) {
      const magic = flat.slice(i, i + 9).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      if (magic !== "51 78 bc 00 01 02 01 2d ff") return { ok: false, at: i, frames };
      frames.push({ cmd, type: 0, len: 2, start: i });
      i += 9;
      continue;
    }
    const len = flat[i + 4] | (flat[i + 5] << 8);
    const end = i + 6 + len + 2;
    if (end > flat.length) return { ok: false, at: i, frames };
    const payload = flat.slice(i + 6, i + 6 + len);
    if (flat[end - 2] !== crc8(payload) || flat[end - 1] !== 0xff)
      return { ok: false, at: i, frames };
    frames.push({ cmd, type: flat[i + 3], len, start: i });
    i = end;
  }
  return { ok: true, at: -1, frames };
}

async function switchToCatAndConnect(page) {
  await page.locator('[data-testid="transport-select"]').click();
  await page.locator('[data-testid="transport-cat"]').click();
  await page.locator('[data-testid="cat-connect"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll("header span.bg-orange-600").length === 1,
    { timeout: 15000 }
  );
}

const JOB_TAIL = "51 78 a3 00 01 00 00 00 ff";

(async () => {
  const browser = await chromium.launch();

  /* ------- A+B: flush-модель — размер записей, кадры, дефолты ---------- */
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
    const t0 = Date.now();
    await page.locator('[data-testid="test-page"]').click();
    await page.waitForFunction(
      (tail) => {
        const w = window.__catWritten ? window.__catWritten() : [];
        if (!w.length) return false;
        const last = w.flat().slice(-9).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        return last === tail;
      },
      JOB_TAIL,
      { timeout: 60000 }
    );
    const elapsed = Date.now() - t0;
    ok(elapsed < 45000, `A: задание отправлено (${elapsed} мс)`);

    const stats = await page.evaluate(() => {
      const w = window.__catWritten();
      return { writes: w.map((b) => b.length), bytes: w.flat().length };
    });
    const maxWrite = Math.max(...stats.writes);
    ok(maxWrite <= 200, `A: каждая запись ≤ 200 Б (flush-буфер kitty-web): max ${maxWrite}`);
    ok(stats.writes.length >= Math.ceil(stats.bytes / 200),
      `A: записей ≥ ⌈байты/200⌉ (${stats.writes.length} ≥ ${Math.ceil(stats.bytes / 200)})`);

    // Поток разбирается на кадры 51 78 … с верным CRC — записи не рвут кадры
    const flat = await page.evaluate(() => window.__catWritten().flat());
    const parsed = parseFrames(flat);
    ok(parsed.ok, `B: поток целиком разбирается на кадры с CRC (${parsed.ok ? "ok" : "обрыв на " + parsed.at})`);
    const cmds = parsed.frames.map((f) => f.cmd);
    const bitmaps = cmds.filter((c) => c === 0xa2).length;
    const feeds = cmds.filter((c) => c === 0xa1).length;
    ok(bitmaps >= 1, `B: в потоке есть BITMAP-кадры 0xa2 (${bitmaps})`);
    ok(feeds >= 1, `B: пустые строки ушли в FEED 0xa1 (${feeds} кадров)`);
    // Дефолты kitty-web: set_speed(32) в prepare и set_energy(24000 = DC 05)
    const speeds32 = parsed.frames.filter(
      (f) => f.cmd === 0xbd && f.len === 1 && flat[f.start + 6] === 32
    ).length;
    ok(speeds32 >= 1, `B: set_speed(32) — дефолт kitty-web (${speeds32} кадров)`);
    const energy = parsed.frames.find((f) => f.cmd === 0xaf && f.len === 2);
    ok(!!energy && flat[energy.start + 6] === 0xc0 && flat[energy.start + 7] === 0x5d,
      `B: set_energy(24000 = C0 5D LE) — дефолт kitty-web (${energy ? flat[energy.start + 6] + (flat[energy.start + 7] << 8) : "нет"})`);

    // Журнал диагностики: flush-модель видна пользователю
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="cat-diagnostics-open"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(700);
    const body = await page.evaluate(() => document.body.innerText);
    ok(/flush × ≤200/.test(body), "D: в журнале flush-модель (≤200 Б)");
    ok(/пауза 20 мс/.test(body), "D: в журнале пауза 20 мс после flush");

    await page.screenshot({ path: path.join(WORK, "v164-flush.png") });
    await closeAllDialogs(page);
    await ctx.close();
    ok(errors.length === 0, `A: нет pageerror (${errors.length})`);
    if (errors.length) console.error(errors.join("\n"));
  }

  /* ------- C: пауза подачи посреди отправки ---------------------------- */
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
    await openSettings(page);
    // Принтер сообщает ПАУЗУ подачи прямо перед печатью; через 1.5 с — resume
    await page.evaluate(() => window.__catEmitState("pause"));
    const t0 = Date.now();
    setTimeout(() => page.evaluate(() => window.__catEmitState("resume")).catch(() => {}), 1500);
    await page.locator('[data-testid="test-page"]').click();
    await page.waitForFunction(
      (tail) => {
        const w = window.__catWritten ? window.__catWritten() : [];
        if (!w.length) return false;
        const last = w.flat().slice(-9).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        return last === tail;
      },
      JOB_TAIL,
      { timeout: 60000 }
    );
    const elapsed = Date.now() - t0;
    ok(elapsed >= 1500, `C: отправка ждала паузу подачи (${elapsed} мс ≥ 1500)`);
    ok(elapsed < 45000, `C: после resume отправка завершилась (${elapsed} мс)`);

    await closeAllDialogs(page);
    await ctx.close();
    ok(errors.length === 0, `C: нет pageerror (${errors.length})`);
  }

  /* ------- E: нет бумаги → честный тост, запись не идёт ---------------- */
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
    ok(/бумаг|out of paper/i.test(toastText), `E: тост честно про бумагу («${toastText.slice(0, 80)}»)`);
    const bytes = await page.evaluate(() => window.__catWritten().flat().length);
    ok(bytes === 0, `E: при отсутствии бумаги задание не отправлялось (${bytes} Б)`);

    await closeAllDialogs(page);
    await ctx.close();
    ok(errors.length === 0, `E: нет pageerror (${errors.length})`);
  }

  await browser.close();

  console.log(failures === 0 ? "\n✓ v164: все проверки пройдены" : `\n✗ v164: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
