#!/usr/bin/env bash
# ============================================================================
# Статическая сборка сайта печати MXW01 + деплой-кит.
# Результат: download/mxw01-deploy-kit.zip — распаковывается в любую папку
# хостинга (PHP нужен только для install.php при установке в подпапку; сам сайт —
#  чистые HTML/JS/CSS, работает без серверного кода).
# Внутри кита также mxw01-offline.html (автономная версия для функции
# «Сохранить страницу») — если он собран: bash scripts/build-offline.sh,
# запускать ПЕРЕД этой сборкой.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Статическая сборка (BUILD_STATIC=1)…"
rm -rf .next-static
BUILD_STATIC=1 bunx next build

echo "→ Копирование public/…"
cp -r public .next-static/

echo "→ Упаковка деплой-пакета…"
python3 scripts/package-deploy.py

echo "✓ Готово: download/mxw01-deploy-kit.zip"
