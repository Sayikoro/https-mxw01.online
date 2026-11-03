/* eslint-disable @typescript-eslint/no-require-imports */
// Сохранить превью-канвас ленты в файл (3× апскейл для инспекции)
const { execSync } = require("child_process");
const fs = require("fs");
const out = process.argv[2] || "/home/z/my-project/work/tape-preview.png";
const dataUrl = execSync(
  `agent-browser eval "(() => { const c = document.querySelector('canvas'); const up = document.createElement('canvas'); up.width = c.width*2; up.height = c.height*2; const u = up.getContext('2d'); u.imageSmoothingEnabled=false; u.drawImage(c, 0, 0, up.width, up.height); return up.toDataURL('image/png');})()"`,
  { encoding: "utf8", cwd: "/home/z/my-project" }
).trim().replace(/^"/, "").replace(/"$/, "").replace(/^data:image\/png;base64,/, "");
const png = Buffer.from(dataUrl, "base64");
fs.writeFileSync(out, png);
console.log("saved", out, png.length, "bytes");
