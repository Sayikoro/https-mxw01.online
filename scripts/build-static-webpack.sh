#!/usr/bin/env bash
# ============================================================================
# Статическая сборка сайта печати MXW01 ЧЕРЕЗ WEBPACK (не Turbopack).
# Зачем: экспорт Turbopack (next build, дефолт в Next 16) даёт НЕ гидратирующую
# статику — страница отрисована, но клиентский бутстрап не стартует даже по
# HTTP. Webpack-экспорт гидратируется корректно, а его чанки саморегистрируются
# по id — это упрощает и одностраничную offline-сборку (build-singlefile.py).
#
# Результат тот же: .next-static + download/mxw01-deploy-kit.zip.
# Запуск: bash scripts/build-static-webpack.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Статическая сборка (BUILD_STATIC=1, webpack)…"
rm -rf .next-static
BUILD_STATIC=1 bunx next build --webpack

echo "→ Копирование public/…"
cp -r public .next-static/

echo "→ Упаковка деплой-пакета…"
python3 scripts/package-deploy.py

echo "✓ Готово: .next-static + download/mxw01-site.zip (webpack)"
