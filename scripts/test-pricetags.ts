/**
 * Быстрая проверка логики ценников: подстановки и CSV (без DOM).
 * Запуск: bun scripts/test-pricetags.ts
 */
import {
  analyzeLine,
  applyPlaceholders,
  detectLineRole,
  importPricetagsFromCsv,
  importPricetagsFromTable,
  seedPlaceholderLines,
} from "../src/lib/printer/pricetags.ts";
import type { Pricetag } from "../src/lib/printer/types.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

const tag = {
  name: "Galaxy A23",
  price: "6380",
  oldPrice: "7000",
  sku: "727",
};

// --- Подстановки ---
console.log("Подстановки:");
check("{name}", applyPlaceholders("Товар: {name}", tag) === "Товар: Galaxy A23");
check("{price}", applyPlaceholders("Цена: {price} р", tag) === "Цена: 6380 р");
check("{sku}", applyPlaceholders("Арт: {sku}", tag) === "Арт: 727");
check("{артикул} кириллица", applyPlaceholders("Арт: {артикул}", tag) === "Арт: 727");
check("{название} кириллица", applyPlaceholders("{название}!", tag) === "Galaxy A23!");
check("{цена} кириллица", applyPlaceholders("{цена} ₽", tag) === "6380 ₽");
check("{old}", applyPlaceholders("Было {old}", tag) === "Было 7000");
check("регистр {NAME}", applyPlaceholders("{NAME}", tag) === "Galaxy A23");
check("неизвестный {foo} остаётся", applyPlaceholders("x {foo} y", tag) === "x {foo} y");
check("пустой sku → пусто", applyPlaceholders("Арт: {sku}", { ...tag, sku: "" }) === "Арт: ");
check("две подстановки", applyPlaceholders("{name} / {sku}", tag) === "Galaxy A23 / 727");

// --- Роли строк макета (поля товара печатаются только через подстановки) ---
console.log("Роли строк:");
check("{name} → name", detectLineRole("{name}") === "name");
check("{Название} → name (регистр)", detectLineRole("{Название}") === "name");
check("{price} → price", detectLineRole("{price}") === "price");
check("{Цена} → price (регистр)", detectLineRole("{Цена}") === "price");
check("{old} → price", detectLineRole("{old}") === "price");
check("{price} {old} → price", detectLineRole("{price} {old}") === "price");
check("{name} акция → extra (не чистая)", detectLineRole("{name} акция") === "extra");
check("Арт: {sku} → extra", detectLineRole("Арт: {sku}") === "extra");
check("{sku} → extra", detectLineRole("{sku}") === "extra");
check("пустая → extra", detectLineRole("  ") === "extra");
console.log("analyzeLine (что вызвано в ценовой строке):");
const aOld = analyzeLine("{old}");
check("{old}: только старая", aOld.kind === "price" && aOld.wantsOld && !aOld.wantsPrice);
const aPrice = analyzeLine("{Цена}");
check("{Цена}: только цена", aPrice.kind === "price" && aPrice.wantsPrice && !aPrice.wantsOld);
const aBoth = analyzeLine("{price} {old}");
check("{price} {old}: обе", aBoth.kind === "price" && aBoth.wantsPrice && aBoth.wantsOld);
const aExtra = analyzeLine("Цена: {price} ₽");
check("с текстом → extra без флагов", aExtra.kind === "extra" && !aExtra.wantsPrice && !aExtra.wantsOld);

// --- CSV: с заголовком (наш экспорт) ---
console.log("CSV с заголовком:");
const csvHeader = [
  "Название;Цена;Старая цена;QR;Артикул;Строки",
  "Молоко;89;;QR123;М-001;Жирность 3.2%|Арт: {sku}",
  '"Кофе "";2";350;400;;K-777;Зерно 1кг',
].join("\n");
const imported1 = importPricetagsFromCsv(csvHeader);
check("количество строк", imported1.length === 2, `got ${imported1.length}`);
check("name", imported1[0].name === "Молоко", imported1[0].name);
check("price", imported1[0].price === "89");
check("sku", imported1[0].sku === "М-001", imported1[0].sku);
check("qr", imported1[0].qr === "QR123");
check("extras split", imported1[0].extraLines[0] === "Жирность 3.2%" && imported1[0].extraLines[1] === "Арт: {sku}");
check("кавычки и ; в названии", imported1[1].name === 'Кофе ";2', imported1[1].name);
check("старая цена не съела цену", imported1[1].price === "350" && imported1[1].oldPrice === "400");

// --- CSV: без заголовка (старый формат) ---
console.log("CSV без заголовка:");
const csvPlain = ["Товар X;100;150;Q1;Строка один|Строка два"].join("\n");
const imported2 = importPricetagsFromCsv(csvPlain);
check("позиционный name", imported2[0].name === "Товар X");
check("позиционный extras", imported2[0].extraLines[0] === "Строка один");
check("sku пуст (нет колонки)", imported2[0].sku === "");

// --- CSV: с колонкой Арт без строк ---
console.log("CSV с артикулом, без строк:");
const csvArt = ["Название;Цена;Артикул", "Стул;2500;С-12"].join("\n");
const imported3 = importPricetagsFromCsv(csvArt);
check("sku из колонки", imported3[0].sku === "С-12", imported3[0].sku);
check("минимум 3 строки", imported3[0].extraLines.length >= 3);
check("сеяны вызовы {name}/{price}", imported3[0].extraLines[0] === "{name}" && imported3[0].extraLines[1] === "{price}");

// --- Миграция: посев подстановок в старые ценники ---
console.log("Миграция посева подстановок:");
const mkTag = (p: Partial<Pricetag> = {}): Pricetag => ({
  id: "t",
  name: "",
  price: "",
  oldPrice: "",
  qr: "",
  sku: "",
  barcode: "",
  extraLines: [],
  ...p,
});
const s1 = seedPlaceholderLines([
  mkTag({ name: "Молоко", price: "89", extraLines: ["Жирность 3.2%"] }),
]);
check(
  "без подстановок: сеяны {name} и {price}, строки сохранены",
  s1[0].extraLines[0] === "{name}" &&
    s1[0].extraLines[1] === "{price}" &&
    s1[0].extraLines[2] === "Жирность 3.2%"
);
const s2 = seedPlaceholderLines([
  mkTag({ price: "89", oldPrice: "120", extraLines: ["", ""] }),
]);
check("цена+старая → одна строка «{price} {old}»", s2[0].extraLines[0] === "{price} {old}");
const s3 = seedPlaceholderLines([mkTag({ oldPrice: "120" })]);
check("только старая → {old}", s3[0].extraLines[0] === "{old}" && s3[0].extraLines.length === 1);
const s4 = seedPlaceholderLines([
  mkTag({ name: "X", price: "5", extraLines: ["Арт: {sku}"] }),
]);
check("есть подстановка → ценник не тронут", s4[0].extraLines.length === 1 && s4[0].extraLines[0] === "Арт: {sku}");
const s5 = seedPlaceholderLines([mkTag({ extraLines: ["", ""] })]);
check("пустые поля → не сеем", s5[0].extraLines.length === 2);
const s6 = seedPlaceholderLines([
  mkTag({ name: "X", price: "5", extraLines: ["акция"] }),
  mkTag({ name: "Y", price: "7", extraLines: ["{name}"] }),
]);
check("миграция не меняет соседние ценники без нужды", s6[0].extraLines[0] === "{name}" && s6[1].extraLines[0] === "{name}");

// --- Подстановка {barcode} (штрихкод текстом) ---
console.log("Подстановка {barcode}:");
const tagBc = { ...tag, barcode: "4006381333931" };
check("{barcode}", applyPlaceholders("Код: {barcode}", tagBc) === "Код: 4006381333931");
check("{штрихкод} кириллица", applyPlaceholders("{штрихкод}", tagBc) === "4006381333931");
check("{BARCODE} регистр", applyPlaceholders("{BARCODE}", tagBc) === "4006381333931");
check("пустой barcode → пусто", applyPlaceholders("Код: {barcode}", tag) === "Код: ");

// --- CSV: колонка Штрихкод ---
console.log("CSV со штрихкодом:");
const csvBc = [
  "Название;Цена;Штрихкод;Артикул",
  "Молоко;89;4006381333931;М-001",
  "Хлеб;45;ABC-123;Х-002",
].join("\n");
const importedBc = importPricetagsFromCsv(csvBc);
check("ean13 из колонки", importedBc[0].barcode === "4006381333931", importedBc[0].barcode);
check("code128 из колонки", importedBc[1].barcode === "ABC-123", importedBc[1].barcode);
check("штрихкод не попал в доп. строки", !importedBc[0].extraLines.some((l) => l.includes("4006381333931")));

// --- Вставка из Excel / Google Sheets (TSV) ---
console.log("Вставка из Excel (таб):");
const tsvHeader = [
  "Название\tЦена\tШтрихкод\tАртикул",
  "Молоко\t89\t4006381333931\tМ-001",
  "Сыр\t520\t\tС-009",
].join("\n");
const tsv1 = importPricetagsFromTable(tsvHeader);
check("TSV с заголовком: 2 товара", tsv1.length === 2, String(tsv1.length));
check("TSV: название", tsv1[0].name === "Молоко", tsv1[0].name);
check("TSV: цена", tsv1[0].price === "89");
check("TSV: штрихкод", tsv1[0].barcode === "4006381333931");
check("TSV: артикул", tsv1[0].sku === "М-001");
check("TSV: пустая ячейка → пустой штрихкод", tsv1[1].barcode === "");
// Цены с запятой НЕ должны ломать разделитель (таб приоритетнее)
const tsvComma = ["Название\tЦена", "Молоко\t89,50"].join("\n");
const tsv2 = importPricetagsFromTable(tsvComma);
check("TSV: запятая в цене не ломает колонки", tsv2[0].name === "Молоко" && tsv2[0].price === "89,50", JSON.stringify(tsv2[0]));
// Позиционный TSV без заголовка
const tsv3 = importPricetagsFromTable("Товар X\t100\t150\tQ1\tСтрока один");
check("TSV позиционный: name/price/old", tsv3[0].name === "Товар X" && tsv3[0].price === "100" && tsv3[0].oldPrice === "150");
check("TSV позиционный: qr", tsv3[0].qr === "Q1");
check("TSV позиционный: extras", tsv3[0].extraLines[0] === "Строка один");
// Точка с запятой тоже распознаётся (например, вставка из текстового файла)
const tsv4 = importPricetagsFromTable("Название;Цена\nМолоко;89");
check("fallback на «;»", tsv4[0].name === "Молоко" && tsv4[0].price === "89");
check("пустой текст → пустой список", importPricetagsFromTable("   \n\t ").length === 0);

if (failed) {
  console.error(`\n${failed} тестов провалено`);
  process.exit(1);
}
console.log("\nВсе тесты пройдены");
