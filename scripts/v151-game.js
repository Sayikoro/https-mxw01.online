/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка v1.0.51 «Секретная мини-игра: 5 тапов по версии → раннер».
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v151-game.js
 * Сервер: http://localhost:3000 (bun run dev).
 *
 * Чеки:
 *  1. RU: 4 клика по версии игру НЕ открывают (порог 5);
 *  2. сброс счётчика: через 3 с одиночный клик игру не открывает;
 *  3. 5 кликов подряд — открывается диалог с холстом и заголовком «Мини-игра»;
 *  4. старт тапом: оверлей «готов» исчезает, персонаж подпрыгивает
 *     (пиксельная проверка верха персонажа в его колонке); в полёте ноги
 *     оторваны от земли (полоса ног пуста), на земле — касаются;
 *  5. без действий — столкновение → экран «Игра окончена» со счётом > 0 и кнопкой «Заново»;
 *  6. рестарт кнопкой → экран «окончена» исчезает;
 *  7. пробел тоже прыгает (пиксельная проверка после рестарта);
 *  8. EN: заголовок «Mini-game», подсказка «Tap / click / Space — jump»;
 *  9. консоль без ошибок;
 * 10. монетки видны на поле (янтарные пиксели) и собираются — на экране
 *     окончания «Монеты: N» (N ≥ 1; первая монетка гарантированная);
 * 11. препятствия разной высоты: верх рулонов за забег меняется ≥ 12 лог. px
 *     (онбординг средний → низкий → высокий гарантирует разброс).
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const consoleErrors = [];
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

/** Закрыть оверлеи (BLE-плашка, куки) */
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

/** Открыть настройки: JS-клик по шестерёнке в шапке (как в v138) */
async function openSettings(page) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector(
        'header button[title="Настройки"], header button[title="Settings"]'
      );
      if (btn) btn.click();
    });
    try {
      await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 6000 });
      return;
    } catch {
      await page.waitForTimeout(700);
    }
  }
  throw new Error("Настройки не открылись");
}

/** N кликов по версии с паузой между ними */
async function clickVersion(page, n, gapMs = 120) {
  for (let i = 0; i < n; i++) {
    await page.locator('[data-testid="app-version"]').click();
    await page.waitForTimeout(gapMs);
  }
}

/** Кликать по версии до появления игры (максимум max попыток); возвращает число кликов */
async function clickUntilGame(page, max = 6) {
  for (let i = 1; i <= max; i++) {
    await page.locator('[data-testid="app-version"]').click();
    await page.waitForTimeout(150);
    if ((await page.locator('[data-testid="game-canvas"]').count()) > 0) return i;
  }
  return -1;
}

/** Верхняя тёмная точка в колонке персонажа (логическая координата Y) */
const PLAYER_TOP = () => {
  const c = document.querySelector('[data-testid="game-canvas"]');
  if (!c) return -1;
  const ctx = c.getContext("2d");
  const k = c.width / 560;
  const x = Math.round(60 * k);
  const d = ctx.getImageData(x, 0, 1, c.height).data;
  for (let y = 0; y < c.height; y++) {
    if (d[y * 4 + 3] > 50 && d[y * 4] < 120) return y / k;
  }
  return -1;
};

/** Тёмные пиксели в полосе ног (ряд над землёй, под персонажем): ноги на земле — > 0, в воздухе — 0 */
const LEGS_ON_ROW = () => {
  const c = document.querySelector('[data-testid="game-canvas"]');
  if (!c) return -1;
  const ctx = c.getContext("2d");
  const k = c.width / 560;
  const y = Math.round(184 * k); /* GROUND_Y-2: зона ног при стоянии */
  const d = ctx.getImageData(Math.round(48 * k), y, Math.round(34 * k), 1).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 50 && d[i] < 120) dark++;
  return dark;
};

/** Рулон прямо перед персонажем (колонна x=190 над землёй): тёмные пиксели — пора прыгать.
 *  Монетки янтарные (r>200) — не считаются, игрок в x<90 — тоже не попадает */
const OBSTACLE_AHEAD = () => {
  const c = document.querySelector('[data-testid="game-canvas"]');
  if (!c) return false;
  const ctx = c.getContext("2d");
  const k = c.width / 560;
  const x = Math.round(190 * k);
  const y0 = Math.round(126 * k), y1 = Math.round(182 * k); /* над землёй, под HUD */
  const d = ctx.getImageData(x, y0, 1, y1 - y0).data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 50 && d[i] < 120) return true;
  return false;
};

/** Верх самого высокого рулона в зоне препятствий (x 150..540, y 120..182): минимальный Y тёмного пикселя */
const OBSTACLE_TOP = () => {
  const c = document.querySelector('[data-testid="game-canvas"]');
  if (!c) return -1;
  const ctx = c.getContext("2d");
  const k = c.width / 560;
  const x0 = Math.round(150 * k), x1 = Math.round(540 * k);
  const y0 = Math.round(120 * k), y1 = Math.round(182 * k);
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const w = x1 - x0;
  for (let y = 0; y < y1 - y0; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (img[i + 3] > 50 && img[i] < 120) return (y0 + y) / k;
    }
  }
  return -1;
};

/** Янтарные пиксели монеток в игровой зоне (без HUD x<100 и счёта сверху): #f59e0b / #d97706 */
const AMBER_PX = () => {
  const c = document.querySelector('[data-testid="game-canvas"]');
  if (!c) return -1;
  const ctx = c.getContext("2d");
  const k = c.width / 560;
  const x0 = Math.round(100 * k), y0 = Math.round(60 * k);
  const img = ctx.getImageData(x0, y0, Math.round(440 * k), Math.round(126 * k)).data;
  let n = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
    if (a > 50 && r > 200 && g > 110 && g < 200 && b < 90) n++;
  }
  return n;
};

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. RU: порог 5 кликов, сброс счётчика, старт, гейм-овер ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));

    await page.addInitScript(() => localStorage.setItem("mxw01-lang", "ru"));
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await closeOverlays(page);
    await openSettings(page);
    await page.waitForTimeout(400);

    /* 4 клика — игры нет */
    await clickVersion(page, 4);
    ok((await page.locator('[data-testid="game-canvas"]').count()) === 0, "RU: 4 клика по версии игру не открывают");

    /* пауза 3 с — счётчик сбросился; 1 клик — игры всё ещё нет (счётчик = 1) */
    await page.waitForTimeout(3000);
    await clickVersion(page, 1);
    ok((await page.locator('[data-testid="game-canvas"]').count()) === 0, "RU: после паузы 3 с счётчик сброшен (1 клик не открывает)");

    /* докликиваем до порога 5 — открывается */
    const opened = await clickUntilGame(page);
    ok(opened > 0 && opened <= 4, `RU: игра открылась на клике №${opened} после сброса (ожидался ≤4)`);
    ok((await page.locator("text=Мини-игра").count()) > 0, "RU: заголовок «Мини-игра»");
    ok((await page.locator('[data-testid="game-ready"]').count()) === 1, "RU: оверлей «Нажми, чтобы начать» + подсказка");

    /* старт тапом + прыжок: верх персонажа поднимается */
    const topBefore = await page.evaluate(PLAYER_TOP);
    const legsBefore = await page.evaluate(LEGS_ON_ROW);
    await page.locator('[data-testid="game-area"]').click();
    await page.waitForTimeout(250);
    const topAfter = await page.evaluate(PLAYER_TOP);
    const legsAfter = await page.evaluate(LEGS_ON_ROW);
    ok((await page.locator('[data-testid="game-ready"]').count()) === 0, "Тап: оверлей «готов» исчез — игра началась");
    ok(topBefore > 100 && topAfter > 0 && topAfter < topBefore - 40, `Прыжок тапом: верх персонажа ${topBefore.toFixed(0)} → ${topAfter.toFixed(0)} лог. px`);
    ok(legsBefore > 0, `На земле ноги касаются земли (тёмных px в полосе ног: ${legsBefore})`);
    ok(legsAfter === 0, `В прыжке ноги ОТОРВАНЫ от земли, а не растянуты (тёмных px в полосе ног: ${legsAfter})`);

    /* без действий — столкновение и экран окончания */
    await page.waitForSelector('[data-testid="game-over"]', { timeout: 12000 });
    ok(true, "Без прыжков — «Игра окончена» (столкновение с рулоном)");
    const overText = await page.locator('[data-testid="game-over"]').textContent();
    const m = overText && overText.match(/Счёт:\s*(\d+)/);
    ok(!!m && parseInt(m[1], 10) > 0, `Счёт на экране окончания > 0 (${m ? m[1] : "—"})`);
    ok((await page.locator('[data-testid="game-restart"]').count()) === 1, "Кнопка «Заново» на экране окончания");

    /* рестарт кнопкой */
    await page.locator('[data-testid="game-restart"]').click();
    await page.waitForTimeout(400);
    ok((await page.locator('[data-testid="game-over"]').count()) === 0, "Рестарт: экран «окончена» исчез");

    /* пробел — прыжок */
    const topB2 = await page.evaluate(PLAYER_TOP);
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    const topA2 = await page.evaluate(PLAYER_TOP);
    ok(topB2 > 100 && topA2 > 0 && topA2 < topB2 - 40, `Прыжок пробелом: ${topB2.toFixed(0)} → ${topA2.toFixed(0)} лог. px`);

    await ctx.close();
  }

  /* ---------- 2. RU: разная высота рулонов + сбор монеток ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));

    await page.addInitScript(() => localStorage.setItem("mxw01-lang", "ru"));
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await closeOverlays(page);
    await openSettings(page);
    await page.waitForTimeout(400);

    const opened2 = await clickUntilGame(page);
    ok(opened2 > 0, `Игра открылась (${opened2} кликов)`);
    await page.locator('[data-testid="game-area"]').click();
    await page.waitForTimeout(300);

    /* забег с автопрыжками по пиксельному «радару»: собираем верхушки
       рулонов и следим за янтарными монетками; после проигрыша — рестарт */
    const tops = [];
    let minTop = 999, maxTop = -1;
    let amberSeen = false;
    let deaths = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const over = (await page.locator('[data-testid="game-over"]').count()) > 0;
      if (over) {
        deaths++;
        await page.waitForTimeout(650);
        await page.locator('[data-testid="game-restart"]').click().catch(() => {});
        await page.waitForTimeout(250);
        continue;
      }
      if (await page.evaluate(OBSTACLE_AHEAD)) {
        await page.locator('[data-testid="game-area"]').click().catch(() => {});
      }
      const top = await page.evaluate(OBSTACLE_TOP);
      if (top > 0) {
        tops.push(top);
        if (top < minTop) minTop = top;
        if (top > maxTop) maxTop = top;
      }
      if ((await page.evaluate(AMBER_PX)) > 20) amberSeen = true;
      await page.waitForTimeout(110);
    }
    ok(amberSeen, "Монетки видны на поле (янтарные пиксели в игровой зоне)");
    ok(
      maxTop > 0 && minTop < 999 && maxTop - minTop >= 12,
      `Разная высота рулонов: верх от ${minTop.toFixed(0)} до ${maxTop.toFixed(0)} лог. px (разброс ${(maxTop - minTop).toFixed(0)} ≥ 12)`
    );

    /* прекращаем прыгать — доводим до «Игра окончена» и читаем монеты */
    await page.waitForSelector('[data-testid="game-over"]', { timeout: 20000 });
    const overText2 = await page.locator('[data-testid="game-over"]').textContent();
    const mc = overText2 && overText2.match(/Монеты:\s*(\d+)/);
    ok(!!mc && parseInt(mc[1], 10) >= 1, `Сбор монеток работает: «Монеты: ${mc ? mc[1] : "—"}» (ожидался ≥ 1)`);
    const ms = overText2 && overText2.match(/Счёт:\s*(\d+)/);
    ok(!!ms && parseInt(ms[1], 10) > 0, `Счёт с бонусом за монеты > 0 (${ms ? ms[1] : "—"})`);

    await ctx.close();
  }

  /* ---------- 3. EN: заголовок и подсказка ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => !NOISE.test(String(e)) && consoleErrors.push(String(e)));

    await page.addInitScript(() => localStorage.setItem("mxw01-lang", "en"));
    await page.goto(`${BASE}/?nobt=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await closeOverlays(page);
    await openSettings(page);
    await page.waitForTimeout(400);

    /* кликаем до открытия (с нуля — ровно на 5-м) */
    const openedEn = await clickUntilGame(page);
    ok(openedEn === 5, `EN: игра открылась ровно на 5-м клике (факт: ${openedEn})`);
    ok((await page.locator("text=Mini-game").count()) > 0, "EN: заголовок «Mini-game»");
    ok((await page.locator("text=Tap / click / Space — jump").count()) > 0, "EN: подсказка «Tap / click / Space — jump»");
    ok((await page.locator('[data-testid="game-ready"]').count()) === 1, "EN: оверлей готовности на месте");

    await ctx.close();
  }

  await browser.close();
  console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
  if (consoleErrors.length) {
    console.error("Ошибки консоли:", consoleErrors.slice(0, 5));
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
})();
