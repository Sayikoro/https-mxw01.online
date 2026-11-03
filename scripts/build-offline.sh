#!/usr/bin/env bash
# ============================================================================
# Сборка ОФЛАЙН-версии (одиночный HTML) БЕЗ счётчиков аналитики.
# Зачем: визиты с file:// загрязняли бы отчёты Метрики/GTM. Поэтому офлайн
# собирается отдельным прогоном с пустыми NEXT_PUBLIC_YM_ID /
# NEXT_PUBLIC_GTM_ID (analytics.ts подставляет env вместо дефолтных ID).
#
# Результат: download/mxw01-offline.html. Это НЕ отдельный артефакт поставки:
# package-deploy.py зашивает файл в деплой-кит (корень сайта), где его отдаёт
# функция «Сохранить страницу» (Ctrl+S или кнопка в настройках). Отдельные
# mxw01-offline.zip и README-ЛОКАЛЬНО.md упразднены — офлайн-режим самого
# сайта обеспечивает PWA (service worker, pwa-register.tsx).
#
# Порядок полного релиза: build-offline.sh → build-static.sh (упакует кит).
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Статическая сборка офлайн-версии (без аналитики)…"
rm -rf .next-static
BUILD_STATIC=1 NEXT_PUBLIC_YM_ID="" NEXT_PUBLIC_GTM_ID="" bunx next build --webpack

echo "→ Копирование public/…"
cp -r public .next-static/

python3 scripts/build-singlefile.py

echo "✓ Офлайн-версия готова (счётчики Метрики/GTM не включены)"
