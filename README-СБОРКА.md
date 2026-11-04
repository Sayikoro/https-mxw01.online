# Сборка сайта печати MXW01 из исходников

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


---
Архив исходников собран 2026-11-04 00:23, версия сайта: 1.0.58
