/* eslint-disable @typescript-eslint/no-require-imports */
// Извлечение i18n-словарей (RU/EN) из минифицированных чанков сборки.
// Словарь — плоский объект вида {"tab.text":"Лента",...} внутри JS-чанков _next.
// Находим все пары "dotted.key":"value" и сопоставляем с текущим i18n.tsx.
const fs = require("fs");
const path = require("path");

const CHUNKS_DIR = "/home/z/my-project/work/task45/_next";
const out = {};

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) out[p] = fs.readFileSync(p, "utf8");
  }
}
walk(CHUNKS_DIR);

// Аккуратный парсер строк JS: учитывает \" \' \\ \n \uXXXX
function parseStrings(src) {
  const strs = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let s = "";
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") {
          const nx = src[j + 1];
          if (nx === "u" && src[j + 2] === "{") {
            const end = src.indexOf("}", j + 3);
            const cp = parseInt(src.slice(j + 3, end), 16);
            s += String.fromCodePoint(cp);
            j = end + 1;
            continue;
          }
          const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
          if (nx in simple) {
            s += simple[nx];
            j += 2;
            continue;
          }
          if (nx >= "0" && nx <= "9") {
            // \xNN
            if (nx === "x") {
              s += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16));
              j += 4;
              continue;
            }
            s += nx;
            j += 2;
            continue;
          }
          s += nx;
          j += 2;
          continue;
        }
        if (ch === q) break;
        s += ch;
        j += 1;
      }
      strs.push({ v: s, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return strs;
}

const found = {}; // key -> Set(values)
for (const [file, src] of Object.entries(out)) {
  const strs = parseStrings(src);
  for (let k = 0; k < strs.length - 1; k++) {
    const a = strs[k];
    const b = strs[k + 1];
    if (b.start - a.end > 4) continue; // между строкой-ключом и значением не должно быть ничего, кроме ':' (+ пробелы)
    const key = a.v;
    if (!/^[a-z]{1,12}(\.[a-zA-Z0-9]+){1,3}$/.test(key)) continue;
    // исключаем ключи, которые точно не i18n
    if (/^(use|next|react)/i.test(key)) continue;
    (found[key] = found[key] || new Set()).add(b.v + "\u0000" + file.split("/").pop());
  }
}

// Текущий i18n.tsx — какие ключи есть
const cur = fs.readFileSync("/home/z/my-project/src/lib/printer/i18n.tsx", "utf8");
const curKeys = new Set([...cur.matchAll(/"([a-z]+\.[a-zA-Z0-9]+)":/g)].map((m) => m[1]));

const report = {};
for (const [key, vals] of Object.entries(found)) {
  report[key] = [...vals];
}
fs.writeFileSync("/home/z/my-project/work/i18n-extracted.json", JSON.stringify(report, null, 1));

// Ключи, которых нет в текущем i18n
const missing = Object.keys(found)
  .filter((k) => !curKeys.has(k) && /^(tape|off|cookie|tab|set|header|tt|common|footer|faq|shell|copies|pt|img|ble|lang|home|support|diag)\./.test(k))
  .sort();
console.log("=== MISSING KEYS (not in current i18n) ===");
for (const k of missing) {
  const vals = [...found[k]].map((v) => v.split("\u0000")[0]);
  console.log(k, "=>", JSON.stringify(vals));
}
console.log("=== total extracted keys:", Object.keys(found).length);
