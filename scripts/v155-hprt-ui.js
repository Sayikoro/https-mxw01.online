/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Playwright v1.0.55 — интеграция HPRT HM-T260LR (третий транспорт печати).
 * Запуск: NODE_PATH=$(npm root -g) timeout 240 node scripts/v155-hprt-ui.js
 *
 * Кейсы:
 *   1. Мок Web Bluetooth (профиль FF00/FF02): выбор «HPRT (BT-этикетки)»
 *      в списке принтера → фиолетовая кнопка → мок-принтер «HM-T260LR» →
 *      печать с вкладки «Текст» уходит по BLE: поток содержит TSPL
 *      (SIZE 48 mm, GAP 0 mm — linerless, DIRECTION 1, BITMAP, PRINT 1,1);
 *      Настройки: носитель linerless↔gap (GAP 2 mm в потоке), размер
 *      этикетки, язык команд, плотность, инверсия/чёткость; Диагностика:
 *      профиль FF00, карта сервисов, raw-консоль (текст → CRLF), чанк/пауза;
 *      настройки и транспорт живут после перезагрузки (localStorage);
 *   2. Браузер БЕЗ Web Bluetooth: кнопка HPRT честно «Нет Bluetooth»;
 *   3. Пользователь закрыл выбор устройства → тост «Принтер не выбран»;
 *      устройство без известных сервисов → ошибка «профиль не найден».
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
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function hasSubseq(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
  return true;
  }
  return false;
}

/** Поток байт → искать ASCII-подстроку (TSPL-команды) */
function hasText(hay, str) {
  return hasSubseq(hay, Array.from(str).map((c) => c.charCodeAt(0) & 0xff));
}

/** Дождаться, пока в мок-логе появятся байты подстроки (конец TSPL-потока —
 *  «PRINT 1,1»: с паузой 15 мс/чанк поток идёт секунды, снимать его раньше
 *  хвоста нельзя — v1.0.56). */
function waitStreamHas(page, str, timeout = 30000) {
  return page.waitForFunction(
    (needle) => {
      const log = window.__bleLog ?? [];
      outer: for (let i = 0; i <= log.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (log[i + j] !== needle[j]) continue outer;
        }
        return true;
      }
      return false;
    },
    Array.from(str).map((c) => c.charCodeAt(0) & 0xff),
    { timeout }
  );
}

/** Дождаться ПОЛНОГО завершения потока: лог не растёт 400 мс (при паузе
 *  15 мс/чанк это устойчиво означает «последний чанк ушёл»). Цикл со стороны
 *  Node — promise-внутри-waitForFunction в headless resolves false раньше
 *  времени (ловушка, найденная отладкой: тест шёл дальше посреди потока). */
async function waitStreamIdle(page, ms = 400) {
  for (;;) {
    const a = await page.evaluate(() => (window.__bleLog ?? []).length);
    await new Promise((r) => setTimeout(r, ms));
    const b = await page.evaluate(() => (window.__bleLog ?? []).length);
    if (a === b) return;
  }
}

/**
 * Мок Web Bluetooth: принтер с сервисом FF00 и write-характеристикой FF02
 * (профиль «HPRT / serial port»). Всё записанное — в window.__bleLog.
 */
function btMockInit() {
  window.localStorage.setItem("mxw01-lang", "ru");
  const log = [];
  window.__bleLog = log;
  const push = (d) => {
    const arr = d instanceof Uint8Array ? d : new Uint8Array(d);
    for (const b of arr) log.push(b);
  };
  const writeChar = {
    uuid: "0000ff02-0000-1000-8000-00805f9b34fb",
    properties: { read: false, write: true, writeWithoutResponse: true, notify: false, indicate: false },
    writeValue: async (d) => push(d),
    writeValueWithoutResponse: async (d) => push(d),
    startNotifications: async () => writeChar,
    addEventListener: () => {},
    value: null,
  };
  const svcFF00 = {
    uuid: "0000ff00-0000-1000-8000-00805f9b34fb",
    getCharacteristic: async () => writeChar,
    getCharacteristics: async () => [writeChar],
  };
  const device = {
    id: "mock-hprt",
    name: "HM-T260LR",
    addEventListener: () => {},
    gatt: {
      connected: false,
      connect: async () => {
        device.gatt.connected = true;
        return device.gatt;
      },
      disconnect: () => {
        device.gatt.connected = false;
      },
      getPrimaryService: async () => svcFF00,
      getPrimaryServices: async () => [svcFF00],
    },
  };
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    get() {
      return {
        requestDevice: async () => {
          window.__blePaired = true;
          return device;
        },
      };
    },
  });
}

/** Принтер БЕЗ известных сервисов: getPrimaryService всегда бросает,
 *  getPrimaryServices пуст — автопрофиль не найдёт write-характеристику */
function btEmptyDeviceInit() {
  window.localStorage.setItem("mxw01-lang", "ru");
  window.localStorage.setItem("mxw01-transport", "hprt");
  const device = {
    id: "mock-empty",
    name: "Unknown BLE",
    addEventListener: () => {},
    gatt: {
      connected: false,
      connect: async () => {
        device.gatt.connected = true;
        return device.gatt;
      },
      disconnect: () => {},
      getPrimaryService: async () => {
        throw new Error("not found");
      },
      getPrimaryServices: async () => [],
    },
  };
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    get() {
      return {
        requestDevice: async () => device,
      };
    },
  });
}

async function dismissBleWarning(page) {
  try {
    await page.getByRole("button", { name: /Понятно|Got it/ }).click({ timeout: 3000 });
  } catch {
    /* предупреждение не появилось — норм */
  }
}

async function collectErrors(page, bucket) {
  page.on("pageerror", (e) => bucket.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const where = `${m.text()} ${m.location()?.url || ""}`;
    if (m.type() === "error" && !/favicon|404|net::ERR|CERT|metrika|mc\.yandex|yandex\.net|googletagmanager/i.test(where)) {
      bucket.push(`console: ${m.text()}`);
    }
  });
}

async function main() {
  const browser = await chromium.launch();

  /* ------------ Кейс 1: мок Web Bluetooth, полный цикл HPRT ------------ */
  console.log("Кейс 1: HPRT по Bluetooth (мок GATT FF00/FF02)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(btMockInit);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);

    ok(
      (await page.locator('[data-testid="transport-select"]').count()) === 1,
      "список типа принтера в шапке"
    );
    await page.locator('[data-testid="transport-select"]').click();
    ok(
      await page.locator('[data-testid="transport-hprt"]').isVisible(),
      "в списке есть вариант «HPRT (BT-этикетки)»"
    );
    await page.locator('[data-testid="transport-hprt"]').click();
    const connectBtn = page.locator('[data-testid="hprt-connect"]');
    ok(await connectBtn.isVisible(), "фиолетовая кнопка «Подключить» для HPRT");
    ok(
      (await connectBtn.getAttribute("class"))?.includes("bg-violet-600") === true,
      "кнопка подключения фиолетовая (bg-violet-600)"
    );

    // Подключение к мок-принтеру
    await connectBtn.click();
    await page.waitForFunction(() => document.body?.innerText.includes("HM-T260LR"), undefined, {
      timeout: 5000,
    });
    ok(true, "мок-принтер подключён: в шапке чип «HM-T260LR»");

    // Печать с вкладки «Текст» → TSPL-поток по BLE (ждём ХВОСТ «PRINT 1,1» —
    // с паузой 15 мс/чанк поток идёт секунды, снимаемый лог обязан быть полным)
    const printBtn = page.getByRole("button", { name: "Печать", exact: true });
    await printBtn.click();
    await waitStreamHas(page, "PRINT 1,1\r\n");
    const flat = await page.evaluate(() => window.__bleLog);
    ok(flat.length > 500, `поток печати получен по BLE (${flat.length} байт)`);
    ok(hasText(flat, "SIZE 48 mm,"), "TSPL: SIZE 48 mm (ширина головки T260LR)");
    ok(hasText(flat, "GAP 0 mm,0 mm"), "TSPL: GAP 0 — linerless по умолчанию (continuous)");
    ok(hasText(flat, "DIRECTION 1"), "TSPL: DIRECTION 1");
    ok(hasText(flat, "BITMAP "), "TSPL: BITMAP (растр 384 px)");
    ok(hasText(flat, "PRINT 1,1"), "TSPL: PRINT 1,1");

    await page.screenshot({ path: path.join(WORK, "v155-hprt-print.png") });

    // Настройки HPRT: смена носителя на «с зазором» → GAP 2 в новом потоке
    await page.locator('[title="Настройки"]').first().click();
    ok(
      (await page.locator('[data-testid="hprt-media-continuous"]').getAttribute("aria-pressed")) === "true",
      "в Настройках активен носитель Linerless"
    );
    await page.locator('[data-testid="hprt-media-gap"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="hprt-gap"]') !== null,
      undefined,
      { timeout: 3000 }
    );
    ok(true, "при носителе «с зазором» появляется поле зазора");
    ok(
      (await page.locator('[data-testid="hprt-label-w"]').inputValue()) === "48",
      "размер этикетки по умолчанию 48 мм"
    );
    ok(
      (await page.locator('[data-testid="hprt-protocol-tspl"]').getAttribute("aria-pressed")) === "true",
      "язык команд по умолчанию TSPL"
    );
    await page.screenshot({ path: path.join(WORK, "v155-hprt-settings.png") });

    // Диалог закрыть (Escape), печать с gap-носителем (ждём начало нового
    // потока — GAP 2 — и полного завершения: хвост PRINT 1,1 неуникален)
    await page.keyboard.press("Escape");
    await printBtn.click();
    await waitStreamHas(page, "GAP 2 mm,0 mm");
    await waitStreamIdle(page);
    const flat2 = await page.evaluate(() => window.__bleLog);
    ok(hasText(flat2, "GAP 2 mm,0 mm"), "после смены носителя GAP 2 mm (зазор из настройки)");

    // Диагностика Bluetooth: профиль, сервисы, raw-консоль
    await page.locator('[title="Настройки"]').first().click();
    await page.locator('[data-testid="hprt-diagnostics-open"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="hprt-diag-dialog"]') !== null,
      undefined,
      { timeout: 5000 }
    );
    ok(true, "диалог «Диагностика Bluetooth» открыт");
    const profileText = await page.locator('[data-testid="hprt-diag-profile"]').innerText();
    ok(profileText.includes("FF00 (HPRT / serial port)"), "определён профиль FF00 (HPRT / serial port)");
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="hprt-diag-services"]')?.textContent ?? "").includes(
          "0000ff00"
        ),
      undefined,
      { timeout: 5000 }
    );
    ok(true, "карта сервисов показывает сервис 0000ff00…");
    const svcLen = await page.evaluate(() => window.__bleLog.length);

    // Raw-консоль: текст → CRLF автоматически (ждём простоя лога: 2 чанка
    // с паузой 15 мс — мелкая посылка, маркеры неуникальны)
    await page.locator('[data-testid="hprt-diag-raw"]').fill("SIZE 48 mm\nPRINT 1,1");
    await page.locator('[data-testid="hprt-diag-send"]').click();
    await waitStreamIdle(page);
    const flat3 = await page.evaluate((n) => window.__bleLog.slice(n), svcLen);
    ok(
      hasText(flat3, "PRINT 1,1\r\n"),
      "raw-консоль отправила текст, \\n переведён в \\r\\n"
    );

    // Чанк 64 Б + пауза 10 мс → localStorage
    await page.locator('[data-testid="hprt-diag-chunk"]').selectOption("64");
    await page.locator('[data-testid="hprt-diag-delay"]').selectOption("10");
    const ls = await page.evaluate(() => ({
      transport: window.localStorage.getItem("mxw01-transport"),
      media: window.localStorage.getItem("mxw01-hprt-media"),
      chunk: window.localStorage.getItem("mxw01-hprt-chunk"),
      delay: window.localStorage.getItem("mxw01-hprt-delay"),
    }));
    ok(ls.transport === "hprt", "транспорт mxw01-transport = hprt");
    ok(ls.media === "gap", "носитель сохранён (gap)");
    ok(ls.chunk === "64" && ls.delay === "10", "чанк/пауза сохранены (64 Б / 10 мс)");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Версия приложения
    const ver = await page.locator('[data-testid="app-version"]').innerText();
    ok(ver.includes("1.0.56"), `в Настройках версия 1.0.56 (${ver.trim()})`);

    // Перезагрузка: транспорт HPRT восстановился, чип снова на месте
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    const label = await page.locator('[data-testid="transport-select"]').innerText();
    ok(/HPRT/.test(label), "после перезагрузки выбран HPRT (список показывает HPRT)");
    await page.locator('[data-testid="transport-select"]').click();
    await page.locator('[data-testid="hprt-open-diagnostics"]').isVisible();
    await page.keyboard.press("Escape");

    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ---------- Кейс 2: браузер без Web Bluetooth ---------- */
  console.log("Кейс 2: без Web Bluetooth — честная недоступность HPRT");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      window.localStorage.setItem("mxw01-transport", "hprt");
    });
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="transport-select"]') !== null,
      undefined,
      { timeout: 10000 }
    );
    const label = await page.locator('[data-testid="transport-select"]').innerText();
    ok(/HPRT/.test(label), "транспорт HPRT выбран (список показывает HPRT)");
    const connectBtn = page.locator('[data-testid="hprt-connect"]');
    ok(await connectBtn.isVisible(), "кнопка подключения HPRT видна");
    ok(
      /Нет Bluetooth|No Bluetooth/i.test(await connectBtn.innerText()),
      "кнопка честно сообщает «Нет Bluetooth»"
    );
    ok(await connectBtn.isDisabled(), "кнопка заблокирована без Web Bluetooth");
    await page.screenshot({ path: path.join(WORK, "v155-hprt-nobt.png") });
    ok(errors.length === 0, `консоль/страница без ошибок (${errors.length})`);
    if (errors.length) console.error(errors.slice(0, 5));
    await ctx.close();
  }

  /* ------ Кейс 3: отмена выбора и устройство без профиля печати ------ */
  console.log("Кейс 3: ошибки подключения — перевод в тостах");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      window.localStorage.setItem("mxw01-lang", "ru");
      window.localStorage.setItem("mxw01-transport", "hprt");
      // Пользователь закрыл системный выбор устройства
      Object.defineProperty(navigator, "bluetooth", {
        configurable: true,
        get() {
          return {
            requestDevice: async () => {
              throw new DOMException("User cancelled", "NotFoundError");
            },
          };
        },
      });
    });
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page);
    await page.locator('[data-testid="hprt-connect"]').click();
    await page.waitForFunction(
      () => document.body?.innerText.includes("Принтер не выбран"),
      undefined,
      { timeout: 5000 }
    );
    ok(true, "отмена выбора → тост «Принтер не выбран»");
    await ctx.close();

    // Устройство без известных сервисов → «профиль не найден»
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx2.addInitScript(btEmptyDeviceInit);
    const page2 = await ctx2.newPage();
    const errors2 = [];
    collectErrors(page2, errors2);
    await page2.goto(BASE, { waitUntil: "domcontentloaded" });
    await dismissBleWarning(page2);
    await page2.locator('[data-testid="hprt-connect"]').click();
    await page2.waitForFunction(
      () => document.body?.innerText.includes("GATT-профиль печати не найден"),
      undefined,
      { timeout: 10000 }
    );
    ok(true, "устройство без сервисов → тост «профиль не найден»");
    await page2.screenshot({ path: path.join(WORK, "v155-hprt-noprofile.png") });
    ok(errors2.length === 0, `консоль/страница без ошибок (${errors2.length})`);
    if (errors2.length) console.error(errors2.slice(0, 5));
    await ctx2.close();
  }

  await browser.close();

  console.log(
    failures === 0
      ? "\nИТОГ: все проверки v155 пройдены ✓"
      : `\nИТОГ: упавших проверок: ${failures}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
