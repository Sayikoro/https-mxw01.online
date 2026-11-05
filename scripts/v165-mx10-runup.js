/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.65 — разгон сверху для MX10 (лечим «обрезается верхняя
 * часть текста»). Запуск:
 *   NODE_PATH=$(npm root -g) timeout 300 node scripts/v165-mx10-runup.js
 * (BASE_URL по умолчанию http://localhost:3000 — поднимите
 *  php -S 127.0.0.1:3000 -t .next-static)
 *
 * Причина v1.0.65: конвейер cat-печати срезал ВСЕ пустые поля растра
 * (trimBlankRows), и первое же BITMAP-задание содержало чернила прямо
 * после start_lattice — механизм MX10 при старте протяжки «съедает»
 * первые ряды, верх текста срезается. Все эталонные реализаторы этого
 * семейства никогда не начинают чернила с нулевого ряда: thermy запекает
 * поле 10 px, kitty-web сохраняет поля макета, NaitLee/Cat-Printer для
 * MX05…MX10 вообще считает feed ненадёжным. Решение: ПЕРЕД первым
 * содержательным рядом уходят CAT_TOP_RUNUP = 16 ПУСТЫХ BITMAP-строк
 * (не feed — пустая BITMAP гарантированно протягивает бумагу на любой
 * прошивке).
 *
 * Проверки (тест-страница через Настройки, стаб ae30):
 *   A. после prepare (8 кадров) идут ровно 16 пустых BITMAP-кадров;
 *   B. сразу после разгона — содержательный BITMAP (чернила не с нуля);
 *   C. в разгоне НЕТ кадров feed (0xa1) — разгон именно BITMAP-строками;
 *   D. задание доезжает до хвоста get_device_state, записи ≤ 200 Б.
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
  try {
    const el = page.locator('[data-testid="cookie-accept"]').first();
    if (await el.isVisible({ timeout: 300 })) {
      await el.click({ force: true });
      await page.waitForTimeout(250);
    }
  } catch {}
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

/* Тот же строгий стаб «котового принтера с сервисом ae30», что в v164 */
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
})();
`;

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

/** Разбор потока на кадры 51 78 … crc ff (кадр камеры 0xbc — магический 9 Б) */
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
    frames.push({ cmd, type: flat[i + 3], len, start: i, payload });
    i = end;
  }
  return { ok: true, at: -1, frames };
}

const JOB_TAIL = "51 78 a3 00 01 00 00 00 ff";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(CAT_AE30_STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30000 });
  await dismissPopups(page);

  await page.locator('[data-testid="transport-select"]').click();
  await page.locator('[data-testid="transport-cat"]').click();
  await page.locator('[data-testid="cat-connect"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll("header span.bg-orange-600").length === 1,
    { timeout: 15000 }
  );
  ok(true, "подключение к стабу ae30 прошло (оранжевый чип)");

  await openSettings(page);
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
  ok(true, "D: задание доехало до хвоста get_device_state");

  const stats = await page.evaluate(() => {
    const w = window.__catWritten();
    return { maxWrite: Math.max(...w.map((b) => b.length)) };
  });
  ok(stats.maxWrite <= 200, `D: записи ≤ 200 Б (max ${stats.maxWrite})`);

  const flat = await page.evaluate(() => window.__catWritten().flat());
  const parsed = parseFrames(flat);
  ok(parsed.ok, `поток разбирается на кадры с CRC (${parsed.ok ? "ok" : "обрыв на " + parsed.at})`);

  const cmds = parsed.frames.map((f) => f.cmd);
  // prepare = 8 кадров: a3, bc, a4, bd, af, be, a9, a6(start lattice)
  const prepareCmds = [0xa3, 0xbc, 0xa4, 0xbd, 0xaf, 0xbe, 0xa9, 0xa6];
  ok(
    cmds.slice(0, 8).every((c, i) => c === prepareCmds[i]),
    `первые 8 кадров — prepare (${cmds.slice(0, 8).map((c) => c.toString(16)).join(",")})`
  );
  // A: после prepare — ровно 16 пустых BITMAP-кадров (разгон)
  let runupOk = true;
  for (let i = 8; i < 8 + 16; i++) {
    const f = parsed.frames[i];
    if (!f || f.cmd !== 0xa2 || f.len !== 48 || !f.payload.every((b) => b === 0)) runupOk = false;
  }
  ok(runupOk, "A: после prepare — 16 ПУСТЫХ BITMAP-кадров (разгон 16 × 48 Б)");
  // C: в разгоне нет feed
  const runupCmds = cmds.slice(8, 24);
  ok(!runupCmds.includes(0xa1), `C: в разгоне НЕТ feed 0xa1 (${runupCmds.filter((c) => c === 0xa1).length})`);
  // B: сразу после разгона — содержательный BITMAP (чернила не с нулевого ряда)
  const after = parsed.frames[24];
  ok(
    !!after && after.cmd === 0xa2 && after.payload.some((b) => b !== 0),
    `B: сразу после разгона — содержательный BITMAP (${after ? "payload " + after.payload.find((b) => b !== 0).toString(16) : "нет кадра"})`
  );

  await page.screenshot({ path: path.join(WORK, "v165-runup.png") });
  await closeAllDialogs(page);
  await ctx.close();
  ok(errors.length === 0, `нет pageerror (${errors.length})`);
  if (errors.length) console.error(errors.join("\n"));

  await browser.close();
  console.log(failures === 0 ? "\n✓ v165: все проверки пройдены" : `\n✗ v165: упало ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
