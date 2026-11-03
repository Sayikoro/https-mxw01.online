/**
 * Тесты эмодзи-конвейера текстовых полей (сегментация, классификация,
 * разбивка на фрагменты) и пересчёта высоты этикетки мм → px.
 * Запуск: bun scripts/test-emoji.ts
 */
import {
  segmentClusters,
  isEmojiCluster,
  splitEmojiRuns,
} from "../src/lib/printer/text-fields.ts";
import {
  mmToLabelPx,
  clampLabelMm,
  DEFAULT_LABEL_SIZE,
  LABEL_MM_PRESETS,
} from "../src/lib/printer/label-size.ts";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

function runs(line: string) {
  return splitEmojiRuns(line).map((r) => ({ type: r.type, value: r.value }));
}
function onlyValues(line: string) {
  return splitEmojiRuns(line).map((r) => r.value);
}

console.log("isEmojiCluster:");
check("😀 — эмодзи", isEmojiCluster("😀"));
check("👍🏽 (кожа) — эмодзи", isEmojiCluster("👍🏽"));
check("👨‍👩‍👧 (ZWJ) — эмодзи", isEmojiCluster("👨‍👩‍👧"));
check("🇷🇺 (флаг) — эмодзи", isEmojiCluster("🇷🇺"));
check("1️⃣ (кейкап) — эмодзи", isEmojiCluster("1️⃣"));
check("#️⃣ (кейкап) — эмодзи", isEmojiCluster("#️⃣"));
check("☺️ (+FE0F) — эмодзи", isEmojiCluster("☺️"));
check("♻️ (+FE0F) — эмодзи", isEmojiCluster("♻️"));
check("☺ (без FE0F) — текст", !isEmojiCluster("☺"));
check("™ — текст", !isEmojiCluster("™"));
check("© — текст", !isEmojiCluster("©"));
check("5 — текст", !isEmojiCluster("5"));
check("a — текст", !isEmojiCluster("a"));
check("Ж — текст", !isEmojiCluster("Ж"));
check("пусто — не эмодзи", !isEmojiCluster(""));

console.log("segmentClusters:");
check("два смайла → 2 кластера", segmentClusters("😀😀").length === 2, String(segmentClusters("😀😀").length));
check("кейкап целиком (1+FE0F+20E3)", segmentClusters("1️⃣").length === 1, String(segmentClusters("1️⃣").length));
check("флаг целиком", segmentClusters("🇷🇺").length === 1, String(segmentClusters("🇷🇺").length));
check("ZWJ-семья целиком", segmentClusters("👨‍👩‍👧").length === 1, String(segmentClusters("👨‍👩‍👧").length));
check("текст по буквам", segmentClusters("ab").length === 2);

console.log("splitEmojiRuns:");
let r = runs("Hi😀there");
check("текст+эмодзи+текст: 3 фрагмента", r.length === 3, JSON.stringify(r));
check("типы t/e/t", r[0].type === "text" && r[1].type === "emoji" && r[2].type === "text");
check("значения Hi|😀|there", onlyValues("Hi😀there").join("|") === "Hi|😀|there");
r = runs("просто текст");
check("чистый текст — 1 фрагмент", r.length === 1 && r[0].type === "text");
r = runs("🎉🎉🎉");
check("три смайла подряд — один фрагмент", r.length === 1 && r[0].type === "emoji", JSON.stringify(r));
r = runs("Скидка 50%🎉");
check("текст с % и эмодзи в конце", r.length === 2 && r[1].value === "🎉", JSON.stringify(r));
r = runs("😀😀");
check("два смайла — один эмодзи-фрагмент", r.length === 1 && r[0].value === "😀😀", JSON.stringify(r));
r = runs("😀 smiles 🎉");
check("эмодзи-текст-эмодзи: 3 фрагмента", r.length === 3 && r[0].type === "emoji" && r[2].type === "emoji", JSON.stringify(r));
r = runs("(👍🏽)");
check("эмодзи с кожей в скобках — 3 фрагмента", r.length === 3 && r[1].value === "👍🏽", JSON.stringify(r));

console.log("высота этикетки: мм → px (203 DPI = 8 px/мм, 384 точки = 48 мм зоны печати):");
check("40 мм → 320 px", mmToLabelPx(40) === 320, String(mmToLabelPx(40)));
check("90 мм → 720 px", mmToLabelPx(90) === 720, String(mmToLabelPx(90)));
check("30 мм → 240 px", mmToLabelPx(30) === 240, String(mmToLabelPx(30)));
check("50 мм → 400 px", mmToLabelPx(50) === 400, String(mmToLabelPx(50)));
check("1 мм ≥ 1 px", mmToLabelPx(1) >= 1);

console.log("clampLabelMm:");
check("10 → 20 (мин)", clampLabelMm(10) === 20);
check("600 → 500 (макс)", clampLabelMm(600) === 500);
check("40.4 → 40", clampLabelMm(40.4) === 40);
check("NaN → дефолт 90", clampLabelMm(NaN) === 90);

console.log("дефолты и пресеты:");
check("дефолт: авто / 90 мм", DEFAULT_LABEL_SIZE.mode === "auto" && DEFAULT_LABEL_SIZE.heightMm === 90);
check("пресеты 30/40/50/90", LABEL_MM_PRESETS.join(",") === "30,40,50,90");

console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : "\nВсе тесты прошли");
process.exit(failed ? 1 : 0);
