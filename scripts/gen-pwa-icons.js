/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Генерация PNG-иконок PWA из public/logo.svg (глобальный playwright).
 * Запуск: NODE_PATH=$(npm root -g) node scripts/gen-pwa-icons.js
 * Создаёт: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project";
const svg = fs.readFileSync(path.join(ROOT, "public/logo.svg"), "utf8");

async function renderIcon(page, size, maskable) {
  // maskable: логотип вписан в 80%safe-zone на однотонном фоне бренда
  const inner = maskable ? Math.round(size * 0.76) : size;
  const html = `<!doctype html><html><body style="margin:0">
    <canvas id="c" width="${size}" height="${size}"></canvas>
    <script>
      async function make() {
        const c = document.getElementById("c");
        const ctx = c.getContext("2d");
        const img = new Image();
        const svg64 = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(${JSON.stringify(svg)})));
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = svg64; });
        ${maskable
          ? `ctx.fillStyle = "#EEF2FF"; ctx.fillRect(0, 0, ${size}, ${size});
             const pad = Math.round((${size} - ${inner}) / 2);
             ctx.drawImage(img, pad, pad, ${inner}, ${inner});`
          : `ctx.drawImage(img, 0, 0, ${size}, ${size});`}
      }
      window.make = make;
    </script>
  </body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => window.make());
  const buf = await page.evaluate(
    () => document.getElementById("c").toDataURL("image/png").split(",")[1]
  );
  return Buffer.from(buf, "base64");
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dir = path.join(ROOT, "public/icons");
  fs.mkdirSync(dir, { recursive: true });
  const jobs = [
    { file: "icon-192.png", size: 192, maskable: false },
    { file: "icon-512.png", size: 512, maskable: false },
    { file: "icon-maskable-512.png", size: 512, maskable: true },
  ];
  for (const job of jobs) {
    const buf = await renderIcon(page, job.size, job.maskable);
    fs.writeFileSync(path.join(dir, job.file), buf);
    console.log(`OK ${job.file} (${buf.length} bytes)`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
