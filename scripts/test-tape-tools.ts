/**
 * Тесты генераторов ленты и списков ценников (bun, без DOM):
 * санитизация данных инструментов, дефолты, миграция старых одиночных
 * ценников в список, синтез тегов списка, нормализация.
 * Запуск: bun scripts/test-tape-tools.ts
 */
import {
  makeToolItemBase,
  sanitizeToolData,
  sanitizeToolTypo,
  isKnownToolId,
} from "../src/lib/printer/tape-tools";
import {
  makePricetagListTag,
  normalizePricetagListItemTags,
  normalizePricetagListTag,
  ptlistFromLegacyPricetag,
  ptlistTagItems,
} from "../src/lib/printer/tape-pricetag";
import { PTLIST_TAGS_MAX } from "../src/lib/printer/types";

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

/* ---------------- sanitizeToolData: базовые дефолты ---------------- */

{
  const qr = sanitizeToolData("qr", {});
  ok(qr.text === "" && qr.caption === "" && qr.level === "M", "qr: дефолты из пустого объекта");

  const qrBad = sanitizeToolData("qr", { text: 42, level: "X", junk: 1 });
  ok(qrBad.text === "" && qrBad.level === "M", "qr: нестроки и плохой уровень отброшены");

  const wifi = sanitizeToolData("wifi", { ssid: "Home", enc: "nope" });
  ok(wifi.ssid === "Home" && wifi.enc === "wpa" && wifi.hidden === false, "wifi: плохой enc → wpa");

  const dates = sanitizeToolData("dates", { made: "2026-13-01", amount: -5 });
  ok(/^\d{4}-\d{2}-\d{2}$/.test(dates.made), "dates: кривая дата → todayISO");
  ok(dates.amount === 1 && dates.unit === "month", "dates: отрицательный срок зажат, юнит по умолчанию");

  const num = sanitizeToolData("numbers", { start: "abc", count: 9999, pad: 99 });
  ok(num.start === 1 && num.count === 200 && num.pad === 12, "numbers: клэмпы start/count/pad");

  const cal = sanitizeToolData("calendar", { year: 1900, month: 99 });
  ok(cal.year >= 1970 && cal.month >= 1 && cal.month <= 12, "calendar: год/месяц зажаты");

  const rec = sanitizeToolData("receipt", {
    items: [{ name: "Хлеб", price: "45.5", qty: 0 }, "мусор", { name: 7 }],
    discount: 150,
  });
  ok(rec.items.length === 3, "receipt: все позиции сохранены (починены)");
  ok(rec.items[0].price === 45.5 && rec.items[0].qty === 1, "receipt: цена/кол-во починены");
  ok(rec.items[1].name === "" && rec.items[1].price === 0, "receipt: строка → пустая позиция");
  ok(rec.discount === 90, "receipt: скидка зажата до 90");

  const chk = sanitizeToolData("checklist", { items: [{ text: "Молоко", done: 1 }] });
  ok(chk.items.length === 1 && chk.items[0].done === true && chk.items[0].id.length > 0, "checklist: пункт починен, id выдан");

  const hab = sanitizeToolData("habits", { habits: ["А", 5, null, "Б", "В", "Г", "Д"] });
  ok(hab.habits.length === 6 && hab.habits[1] === "" && hab.habits[2] === "", "habits: максимум 6, нестроки → пустые");

  const wifiShown = sanitizeToolData("wifi", { ssid: "S", showDate: false });
  ok("hidden" in wifiShown, "wifi: схема не расширяется чужими полями");
}

/* ---------------- makeToolItemBase: дефолт без localStorage ---------------- */

{
  // В bun нет window — черновик старой вкладки недоступен, только дефолты
  const base = makeToolItemBase("calendar");
  ok(base.tool === "calendar" && base.x === 0, "makeToolItemBase: базовые поля");
  const d = base.data as { year: number; month: number; weekStart: number };
  ok(d.year >= 1970 && d.month >= 1 && d.month <= 12, "makeToolItemBase: дефолты месяца");
}

/* ---------------- isKnownToolId ---------------- */

{
  ok(isKnownToolId("qr") && isKnownToolId("habits"), "isKnownToolId: известные id");
  ok(!isKnownToolId("testpage") && !isKnownToolId(42), "isKnownToolId: неизвестные отброшены");
}

/* ---------------- sanitizeToolTypo: типографика генератора ---------------- */

{
  ok(
    sanitizeToolTypo(undefined) === undefined,
    "typo: поля нет (старый элемент) → undefined — рендер по умолчанию"
  );
  ok(sanitizeToolTypo(null) === undefined, "typo: null → undefined");

  const d = sanitizeToolTypo({});
  ok(
    !!d && d.scale === 1 && d.fontFamily === undefined,
    "typo: пустой объект → дефолты без шрифта (ролевые)"
  );

  const ok1 = sanitizeToolTypo({ scale: 1.5, fontFamily: "Georgia, serif" });
  ok(
    !!ok1 && ok1.scale === 1.5 && ok1.fontFamily === "Georgia, serif",
    "typo: валидные значения проходят без изменений"
  );

  ok(sanitizeToolTypo({ scale: 99 })?.scale === 2, "typo: масштаб зажат сверху");
  ok(sanitizeToolTypo({ scale: 0.1 })?.scale === 0.75, "typo: масштаб зажат снизу");
  ok(sanitizeToolTypo({ scale: -3 })?.scale === 1, "typo: отрицательный масштаб → дефолт (мусор)");

  ok(
    sanitizeToolTypo({ scale: 1.3, fontFamily: "   " })?.fontFamily === undefined,
    "typo: пустая/пробельная семья → undefined (чек остаётся моноширинным)"
  );

  const junk = sanitizeToolTypo({ scale: "abc", fontFamily: 42 });
  ok(
    !!junk && junk.scale === 1 && junk.fontFamily === undefined,
    "typo: нестрока/нечисло → дефолты"
  );
  const str = sanitizeToolTypo("мусор");
  ok(
    !!str && str.scale === 1 && str.fontFamily === undefined,
    "typo: не-объект → дефолты"
  );
}

/* ---------------- нормализация тегов списка ---------------- */

{
  const tag = normalizePricetagListTag({ name: "Молоко", price: 89, extraLines: ["{name}", 5, null] });
  ok(tag.name === "Молоко" && tag.price === "89", "тег: числа приводятся к строкам");
  ok(tag.extraLines.length === 3 && tag.extraLines[1] === "5" && tag.extraLines[2] === "", "тег: нестроки в строках → строка/пустая");

  const many = normalizePricetagListItemTags(
    Array.from({ length: PTLIST_TAGS_MAX + 10 }, () => ({ name: "x" }))
  );
  ok(many.length === PTLIST_TAGS_MAX, "теги: лимит списка");

  ok(normalizePricetagListItemTags("мусор").length === 0, "теги: не-массив → пусто");

  const seed = makePricetagListTag("Кофе", "250");
  ok(
    seed.extraLines.join("|") === "{name}|{price}" && seed.oldPrice === "",
    "makePricetagListTag: дефолтные подстановки"
  );
}

/* ---------------- миграция старого одиночного ценника ---------------- */

{
  const legacy = ptlistFromLegacyPricetag(
    {
      kind: "pricetag",
      id: "old-1",
      x: 20,
      name: "Хлеб",
      price: "45",
      oldPrice: "50",
      sku: "ART-1",
      qr: "https://x",
      barcode: "123",
      // старый ценник без строк — сеем подстановки из полей
    },
    "old-1"
  );
  ok(legacy.kind === "ptlist" && legacy.tags.length === 1, "миграция: ptlist с одним тегом");
  const t0 = legacy.tags[0];
  ok(
    t0.name === "Хлеб" && t0.price === "45" && t0.sku === "ART-1" && t0.barcode === "123",
    "миграция: поля товара переехали в тег"
  );
  ok(t0.extraLines.join("|") === "{name}|{price} {old}", "миграция: подстановки посеяны (цена+старая)");

  const legacy2 = ptlistFromLegacyPricetag(
    { extraLines: ["{name}", "Акция", "{price}"], fontSize: 999, frame: true },
    "old-2"
  );
  ok(legacy2.fontSize === 96, "миграция: кегль зажат до 96");
  ok(legacy2.tags[0].extraLines.join("|") === "{name}|Акция|{price}", "миграция: строки сохранены как есть");
  ok(legacy2.frame === true, "миграция: рамка перенесена");

  const legacy3 = ptlistFromLegacyPricetag({ x: -50, nameBad: 1 }, "old-3");
  ok(legacy3.x === 0 && legacy3.fontSize === 48, "миграция: клэмпы и дефолты на битых данных");
}

/* ---------------- синтез тегов → PricetagItem ---------------- */

{
  const item = {
    id: "pt-1",
    kind: "ptlist" as const,
    x: 16,
    y: 0,
    tags: [
      { name: "А", price: "1", oldPrice: "", sku: "", qr: "", barcode: "", extraLines: ["{name}"] },
      { name: "Б", price: "2", oldPrice: "", sku: "", qr: "", barcode: "", extraLines: [] },
    ],
    fontSize: 48,
    frame: true,
    nameSize: 36,
  };
  const synth = ptlistTagItems(item);
  ok(synth.length === 2, "синтез: по одному ценнику на тег");
  ok(synth[0].id === "pt-1#0" && synth[1].id === "pt-1#1", "синтез: стабильные синтетические id");
  ok(
    synth[0].kind === "pricetag" && synth[0].fontSize === 48 && synth[0].frame === true,
    "синтез: общая типографика перенесена"
  );
  ok(synth[0].x === 16 && synth[0].y === 0, "синтез: отступ элемента");
  ok(synth[1].name === "Б" && synth[1].extraLines.length === 0, "синтез: поля тега без изменений");
}

console.log(`\nИтог: ${passed} прошло, ${failed} упало`);
if (failed > 0) process.exit(1);
