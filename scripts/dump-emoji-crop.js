/* eslint-disable @typescript-eslint/no-require-imports */
// Сохранить кроп превью-канваса в файл (через agent-browser eval нельзя вернуть бинарку —
// рисуем в dataURL и декодируем в Node)
const { execSync } = require("child_process");
const fs = require("fs");
const dataUrl = execSync(
  `agent-browser eval "(() => { const c = document.querySelector('div.mb-4 canvas'); const up = document.createElement('canvas'); up.width = c.width*3; up.height = 80*3; const u = up.getContext('2d'); u.imageSmoothingEnabled=false; u.drawImage(c, 0, 0, c.width, 80, 0, 0, up.width, up.height); return up.toDataURL('image/png');})()"`,
  { encoding: "utf8", cwd: "/home/z/my-project" }
).trim();
const b64 = dataUrl.replace(/^"/, "").replace(/"$/, "");
const png = Buffer.from(b64, "base64");
fs.writeFileSync("/home/z/my-project/work/emoji-crop.png", png);
console.log("saved", png.length, "bytes");
