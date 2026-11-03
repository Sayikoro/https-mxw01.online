/**
 * Тесты своих шаблонов ценников (user-templates.ts) — чистые функции без DOM.
 * Запуск: bun scripts/test-user-templates.ts
 */
import {
  normalizeUserTemplate,
  normalizeUserTemplates,
  makeUserTemplate,
  applyUserTemplate,
  USER_TEMPLATES_KEY,
} from "../src/lib/printer/user-templates.ts";
import { createId } from "../src/lib/printer/types.ts";

let passed = 0;
function ok(cond: boolean, name: string) {
  if (!cond) {
    console.error(`  FAIL  ${name}`);
    process.exit(1);
  }
  passed++;
  console.log(`  OK  ${name}`);
}

console.log("== normalizeUserTemplate ==");

ok(normalizeUserTemplate(null) === null, "null → null");
ok(normalizeUserTemplate("строка") === null, "не объект → null");
ok(normalizeUserTemplate({ id: "x" }) === null, "без data → null");

const fixed = normalizeUserTemplate({
  id: "t1",
  label: "  Мой шаблон ",
  createdAt: 12345,
  data: { name: "Товар", price: 100, extraLines: "{name}" },
});
ok(!!fixed, "валидная запись проходит");
ok(fixed!.label === "Мой шаблон", "label обрезан");
ok(fixed!.createdAt === "", "не-строка createdAt → пустая строка");
ok(fixed!.data.price === "100", "числовая цена → строка");
ok(Array.isArray(fixed!.data.extraLines) && fixed!.data.extraLines[0] === "{name}", "строка → массив строк");

const noLabel = normalizeUserTemplate({ data: { name: "N" } });
ok(!!noLabel && noLabel.label === "Без названия", "пустой label → «Без названия»");
ok(!!noLabel && typeof noLabel.id === "string" && noLabel.id.length > 0, "id сгенерирован");

console.log("== normalizeUserTemplates ==");

ok(normalizeUserTemplates(null).length === 0, "не массив → пусто");
ok(normalizeUserTemplates([null, 5, { data: { name: "A" } }]).length === 1, "битые записи отброшены");

const list = normalizeUserTemplates([
  { id: "dup", label: "A", data: { name: "A" } },
  { id: "dup", label: "B", data: { name: "B" } },
]);
ok(list.length === 2 && list[0].id !== list[1].id, "дубли id разведены");

console.log("== makeUserTemplate / applyUserTemplate ==");

const tag = {
  id: "tag-1",
  name: "Galaxy A23",
  price: "5800",
  oldPrice: "6000",
  qr: "https://x",
  sku: "727",
  barcode: "4006381333931",
  extraLines: ["{name}", "{price} {old}"],
};
const tpl = makeUserTemplate("  Летняя цена  ", tag);
ok(tpl.id !== tag.id && tpl.id.length > 0, "у шаблона свой id");
ok(tpl.label === "Летняя цена", "label обрезан");
ok(tpl.data.barcode === tag.barcode && tpl.data.sku === tag.sku, "поля товара перенесены");
ok(tpl.data.extraLines !== tag.extraLines, "extraLines скопированы (не по ссылке)");
ok(tpl.data.extraLines.join("|") === tag.extraLines.join("|"), "extraLines равны по содержимому");

ok(
  makeUserTemplate("   ", { ...tag, name: "" }).label === "Без названия",
  "пустое имя → «Без названия»"
);
ok(
  makeUserTemplate("   ", { ...tag, name: "Из названия" }).label === "Из названия",
  "пустое имя → берётся название товара"
);

const applied = applyUserTemplate(tpl);
ok(applied.id !== tag.id && applied.id !== tpl.id, "применение даёт новый id");
ok(applied.extraLines !== tpl.data.extraLines, "extraLines при применении копируются");
ok(applied.extraLines.join("|") === "{name}|{price} {old}", "содержимое строк сохранено");
ok((applied as { name?: string }).name === "Galaxy A23", "поля товара на месте");

// Изменение applied не ломает шаблон
applied.extraLines[0] = "ИЗМЕНЕНО";
ok(tpl.data.extraLines[0] === "{name}", "мутация применённого не трогает шаблон");

console.log("== прочее ==");

ok(USER_TEMPLATES_KEY === "mxw01-pricetag-templates", "ключ localStorage корректный");
ok(typeof createId() === "string" && createId() !== createId(), "createId уникален");

console.log(`\nВсе тесты пройдены: ${passed}`);
