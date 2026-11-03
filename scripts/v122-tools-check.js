/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Проверка вкладки «Инструменты» v1.0.22 (dev-сервер :3000).
 * Запуск: NODE_PATH=$(npm root -g) node scripts/v122-tools-check.js
 * Сценарий RU: вкладка → 8 инструментов (превью-канвас рендерится),
 * персист после перезагрузки, счётчик в «Настройках», console errors = 0.
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const errors = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`, extra !== undefined ? extra : "");
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ru-RU",
  });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("mxw01-lang", "ru");
  });
  const page = await ctx.newPage();
  // Внешняя аналитика (Метрика/GTM) в песочнице даёт cert-ошибки — блокируем её
  await ctx.route((url) => !url.hostname.includes("localhost") && !url.hostname.includes("127.0.0.1"), (route) =>
    route.abort()
  );
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // сетевые отказы заблокированной внешней аналитики — не ошибки приложения
    if (msg.text().startsWith("Failed to load resource")) return;
    errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(BASE + "/?nobt=1", { waitUntil: "networkidle" });

  // Закрыть BLE-плашку (headless-хром без Web Bluetooth) и cookie-баннер
  const closeBtn = page.getByRole("button", { name: "Понятно" });
  if (await closeBtn.count()) await closeBtn.click();
  const cookieOk = page.getByRole("button", { name: "Хорошо" });
  if (await cookieOk.count()) await cookieOk.click();

  // Вкладка «Инструменты»
  await page.getByRole("tab", { name: /Инструменты/ }).click();
  await page.waitForTimeout(300);

  const preview = page.locator("canvas").first();

  // 1. QR
  await page.getByLabel("Данные").fill("https://mxw01.online");
  await page.waitForTimeout(250);
  check("QR: канвас отрисован", (await preview.count()) === 1 && (await preview.boundingBox())?.height > 50);
  const qrHasDark = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c || !c.width) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 40) if (d[i] < 128) return true;
    return false;
  });
  check("QR: на канвасе есть чёрные модули", qrHasDark);
  await page.screenshot({ path: "work/v122-qr.png" });

  // 2. Wi-Fi
  await page.getByRole("button", { name: "Wi-Fi", exact: true }).click();
  await page.getByLabel("Имя сети (SSID)").fill("HomeNet");
  await page.getByLabel("Пароль").fill("pass;123");
  await page.waitForTimeout(250);
  check("Wi-Fi: канвас отрисован", (await preview.boundingBox())?.height > 50);

  // 3. Чек-лист
  await page.getByRole("button", { name: "Чек-лист", exact: true }).click();
  await page.getByLabel("Заголовок").fill("Покупки");
  await page.getByRole("button", { name: "Добавить пункт" }).click();
  await page.getByLabel("Текст пункта").fill("Хлеб");
  await page.getByRole("button", { name: "Добавить пункт" }).click();
  await page.getByLabel("Текст пункта").nth(1).fill("Молоко");
  await page.getByRole("checkbox", { name: "Отметить пункт" }).first().click();
  await page.waitForTimeout(250);
  check("Чек-лист: канвас отрисован", (await preview.boundingBox())?.height > 50);
  await page.screenshot({ path: "work/v122-checklist.png" });

  // 4. Чек
  await page.getByRole("button", { name: "Чек", exact: true }).click();
  await page.getByLabel("Магазин").fill("У дома");
  await page.getByRole("button", { name: "Добавить позицию" }).click();
  await page.getByLabel("Название").fill("Кофе");
  await page.getByLabel("Цена").fill("250");
  await page.waitForTimeout(250);
  check("Чек: канвас + итог", (await preview.boundingBox())?.height > 50 && (await page.getByText("К оплате: 250.00").count()) === 1);
  await page.screenshot({ path: "work/v122-receipt.png" });

  // 5. Сроки годности
  await page.getByRole("button", { name: "Сроки годности", exact: true }).click();
  await page.getByLabel("Название").fill("Варенье");
  await page.waitForTimeout(250);
  check("Сроки: канвас + расчёт даты", (await preview.boundingBox())?.height > 50 && (await page.getByText("Годно до:").count()) >= 1);
  await page.screenshot({ path: "work/v122-dates.png" });

  // 6. Нумерация
  await page.getByRole("button", { name: "Нумерация", exact: true }).click();
  await page.waitForTimeout(250);
  check("Нумерация: канвас по умолчанию (10 меток)", (await preview.boundingBox())?.height > 300);
  await page.getByRole("switch", { name: "Штрихкод Code-128" }).click();
  await page.waitForTimeout(250);
  check("Нумерация: штрихкод вырос", (await preview.boundingBox())?.height > 500);
  await page.screenshot({ path: "work/v122-numbers.png" });

  // 7. Календарь
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.waitForTimeout(250);
  check("Календарь: канвас", (await preview.boundingBox())?.height > 200);
  await page.screenshot({ path: "work/v122-calendar.png" });

  // 8. Трекер привычек
  await page.getByRole("button", { name: "Трекер привычек", exact: true }).click();
  await page.getByRole("button", { name: "Добавить привычку" }).click();
  await page.getByLabel("Название привычки").fill("Вода 2л");
  await page.waitForTimeout(250);
  check("Привычки: канвас", (await preview.boundingBox())?.height > 150);
  await page.screenshot({ path: "work/v122-habits.png" });

  // Персист: перезагрузка → QR-текст сохранился
  await page.reload({ waitUntil: "networkidle" });
  const closeBtn2 = page.getByRole("button", { name: "Понятно" });
  if (await closeBtn2.count()) await closeBtn2.click();
  const cookieOk2 = page.getByRole("button", { name: "Хорошо" });
  if (await cookieOk2.count()) await cookieOk2.click();
  await page.getByRole("tab", { name: /Инструменты/ }).click();
  await page.waitForTimeout(300);
  check("Персист: текст QR после перезагрузки", (await page.getByLabel("Данные").inputValue()) === "https://mxw01.online");

  // Настройки: секция «Обслуживание»
  await page.getByRole("button", { name: "Настройки" }).click();
  await page.waitForTimeout(300);
  check("Настройки: Обслуживание", (await page.getByText("Обслуживание").count()) >= 1);
  check("Настройки: Тестовая страница", (await page.getByText("Тестовая страница").count()) >= 1);
  check("Настройки: счётчик ленты", (await page.getByText("Израсходовано ленты").count()) === 1);
  await page.screenshot({ path: "work/v122-settings.png" });
  await page.keyboard.press("Escape");

  // Мобильная раскладка: вкладки-иконки помещаются, без overflow
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(BASE + "/?nobt=1", { waitUntil: "networkidle" });
  const closeBtn3 = mob.getByRole("button", { name: "Понятно" });
  if (await closeBtn3.count()) await closeBtn3.click();
  const cookieOk3 = mob.getByRole("button", { name: "Хорошо" });
  if (await cookieOk3.count()) await cookieOk3.click();
  await mob.getByRole("tab", { name: /Инструменты/ }).click();
  await mob.waitForTimeout(300);
  const overflow = await mob.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check("Мобильная 390px: без горизонтального overflow", overflow <= 0, { overflow });
  await mob.screenshot({ path: "work/v122-mobile.png" });

  check("Console errors = 0", errors.length === 0, errors.slice(0, 3));

  console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
