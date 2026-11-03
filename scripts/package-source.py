#!/usr/bin/env python3
"""
Архив ИСХОДНЫХ ФАЙЛОВ сайта печати MXW01 → download/mxw01-site-source-<версия>.zip.

Состав:
  • src/                 — весь исходный код приложения (app, components, lib);
  • public/              — статика сайта (иконки PWA, sw.js, robots, llms.txt);
  • prisma/schema.prisma + db/custom.db — схема и локальная БД (API-маршрут);
  • scripts/             — сборочные и проверочные скрипты проекта;
  • конфиги: package.json, bun.lock, next.config.ts, tsconfig.json,
    tailwind.config.ts, postcss.config.mjs, components.json, eslint.config.mjs;
  • versions.md          — история версий;
  • Caddyfile            — локальный reverse proxy (dev-окружение);
  • README-СБОРКА.md     — как развернуть и пересобрать из этих исходников.

Не включается: node_modules, .next*, download/, upload/, work/, tool-results/,
examples/, tests/ (заготовки скаффолда), логи. Расширение Chrome удалено
из проекта и в архив не попадает.

Версия берётся из src/lib/printer/site.ts (APP_VERSION).
"""
import os
import re
import sys
import zipfile
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "download")

SITE_TS = os.path.join(ROOT, "src", "lib", "printer", "site.ts")

README_BUILD = """# Сборка сайта печати MXW01 из исходников

Стек: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui.
Печать идёт ЦЕЛИКОМ на клиенте: Web Bluetooth (MXW01) / Web USB (POS-принтеры),
драйвер MXW01 — npm-пакет mxw01-thermal-printer. Серверная часть минимальна
(один API-маршрут + Prisma/SQLite).

## Требования
- Bun 1.2+ (или Node 20+ с npm — команды ниже на bun, для npm: `npm install`, `npm run …`)
- Для BLE-печати сайт должен открываться по HTTPS или localhost

## Запуск для разработки
    bun install
    bun run dev          # http://localhost:3000

## Продакшен (Node-сервер, standalone)
    bun install
    bun run build        # next build → .next/standalone (+ static, public)
    bun run start        # NODE_ENV=production bun .next/standalone/server.js
Порт по умолчанию 3000; за nginx/Caddy проксируйте на него, HTTPS обязателен
(без него браузер не даст Web Bluetooth).

## Статический хостинг (без Node — обычный shared-хостинг)
    bash scripts/build-offline.sh   # офлайн-версия (одиночный HTML) → download/
    bash scripts/build-static.sh    # статическая сборка + download/mxw01-deploy-kit.zip
Кит содержит готовые HTML/JS/CSS, install.php (установка в подпапку) и
mxw01-offline.html. Подробности — README-УСТАНОВКА.md внутри кита.

## Структура
    src/app/                  — страницы, метаданные, API-маршрут
    src/components/printer/   — UI (вкладки Текст/Ценник/Изображение/Лента, инструменты)
    src/lib/printer/          — рендер этикеток, энкодеры TSPL/ESC-POS, BLE/USB-контекст
    src/lib/printer/site.ts   — версия сайта (SITE_VERSION)
    public/sw.js              — service worker (PWA-кэш; при изменениях поднимите версию)
    versions.md               — история изменений по версиям

## После изменений
1. Поднимите SITE_VERSION в src/lib/printer/site.ts и версию кэша в public/sw.js.
2. Опишите изменения в versions.md.
3. Прогоните проверки: `bun run lint`; юнит-тесты scripts/test-*.ts (bun);
   playwright-проверки scripts/v1xx-*.js при затронутом UI.
"""


def read_version() -> str:
    try:
        with open(SITE_TS, "r", encoding="utf-8") as f:
            m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', f.read())
            if m:
                return m.group(1)
    except OSError:
        pass
    return "unknown"


def main() -> int:
    version = read_version()
    out = os.path.join(OUT_DIR, f"mxw01-site-source-{version}.zip")

    include_dirs = ["src", "public", "prisma", "scripts"]
    include_files = [
        "package.json",
        "bun.lock",
        "next.config.ts",
        "tsconfig.json",
        "tailwind.config.ts",
        "postcss.config.mjs",
        "components.json",
        "eslint.config.mjs",
        "versions.md",
        "Caddyfile",
        "README.md",
        "LICENSE",
        ".gitignore",
        os.path.join("db", "custom.db"),
    ]

    if not os.path.isdir(os.path.join(ROOT, "src")):
        print("Нет папки src/ — запускайте из корня проекта", file=sys.stderr)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.exists(out):
        os.remove(out)

    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for d in include_dirs:
            base = os.path.join(ROOT, d)
            if not os.path.isdir(base):
                print(f"  ⚠ пропущен отсутствующий {d}/")
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [n for n in dirnames if n not in ("node_modules", "__pycache__")]
                for name in sorted(filenames):
                    if name.endswith((".log", ".pyc")):
                        continue
                    full = os.path.join(dirpath, name)
                    rel = os.path.join(d, os.path.relpath(full, base))
                    z.write(full, rel)
                    count += 1
        for rel in include_files:
            full = os.path.join(ROOT, rel)
            if os.path.exists(full):
                z.write(full, rel)
                count += 1
            else:
                print(f"  ⚠ нет файла {rel}")
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        z.writestr(
            "README-СБОРКА.md",
            README_BUILD + f"\n\n---\nАрхив исходников собран {stamp}, версия сайта: {version}\n",
        )

    size = os.path.getsize(out)
    print(f"✓ {out}")
    print(f"  файлов: {count} + README-СБОРКА.md, размер: {size / 1024:.0f} КБ, версия: {version}, {stamp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
