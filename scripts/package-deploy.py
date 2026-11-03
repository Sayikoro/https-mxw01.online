#!/usr/bin/env python3
"""
Упаковка статической сборки MXW01 в download/mxw01-deploy-kit.zip.

Состав пакета:
  • всё содержимое .next-static (HTML/JS/CSS + public);
  • mxw01-offline.html — автономная версия (должна быть собрана заранее:
    bash scripts/build-offline.sh). Файл живёт в КОРНЕ сайта: его отдаёт
    функция «Сохранить страницу» (Ctrl+S или кнопка в настройках);
  • version.json — маркер версии для панели обновлений /update;
  • install.php — установщик для хостинга: копирует сайт в целевую папку и
    (при установке в ПОДПАПКУ) переписывает абсолютные ссылки /_next/…
    на относительные, с negative lookbehind — чтобы не задеть уже
    относительные пути;
  • update/index.php — админ-панель обновлений (источник: scripts/php-update/):
    вход по паролю, загрузка нового кита, бэкапы и откат;
  • README-УСТАНОВКА.md — короткая инструкция.

Порядок полного релиза: build-offline.sh → build-static.sh (сам вызывает
этот скрипт в конце).
"""
import os
import re
import sys
import json
import zipfile
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".next-static")
OUT_DIR = os.path.join(ROOT, "download")
OUT = os.path.join(OUT_DIR, "mxw01-deploy-kit.zip")
OFFLINE = os.path.join(OUT_DIR, "mxw01-offline.html")
UPDATER_SRC = os.path.join(ROOT, "scripts", "php-update", "index.php")
SITE_TS = os.path.join(ROOT, "src", "lib", "printer", "site.ts")


def app_version() -> str:
    """Версия из src/lib/printer/site.ts (APP_VERSION = "x.y.z")."""
    m = re.search(r'APP_VERSION\s*=\s*"([0-9.]+)"', open(SITE_TS, encoding="utf-8").read())
    if not m:
        raise SystemExit("Не найден APP_VERSION в src/lib/printer/site.ts")
    return m.group(1)

INSTALL_PHP = r"""<?php
/**
 * Установщик сайта печати MXW01 на хостинг.
 *
 * Положите этот файл и папки/файлы сайта в одну директорию и откройте
 * install.php в браузере:
 *   https://ваш-домен/install.php            → установка в корень
 *   https://ваш-домен/install.php?dir=shop   → установка в подпапку /shop/
 *
 * При установке в подпапку скрипт переписывает абсолютные ссылки /_next/…
 * на пути с префиксом подпапки (только абсолютные — относительные не
 * трогаются, для этого используется negative lookbehind).
 */
error_reporting(E_ALL & ~E_DEPRECATED);

$dir = isset($_GET['dir']) ? preg_replace('/[^A-Za-z0-9_\-]/', '', $_GET['dir']) : '';
$docRoot = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
$target = $docRoot . ($dir !== '' ? '/' . $dir : '');
$prefix  = ($dir !== '' ? '/' . $dir : '');

$log = [];
$files = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator(__DIR__, FilesystemIterator::SKIP_DOTS)
);
$copied = 0;
foreach ($files as $file) {
    if ($file->getFilename() === basename(__FILE__)) continue;
    if (strpos($file->getPathname(), $target . DIRECTORY_SEPARATOR) === 0) continue;

    $rel = substr($file->getPathname(), strlen(__DIR__) + 1);
    $dest = $target . '/' . $rel;
    if (!is_dir(dirname($dest))) mkdir(dirname($dest), 0755, true);
    if ($file->isDir()) {
        if (!is_dir($dest)) mkdir($dest, 0755, true);
        continue;
    }
    copy($file->getPathname(), $dest);
    $copied++;

    // Переписываем ссылки в HTML при установке в подпапку
    if ($prefix !== '' && preg_match('/\.(html)$/i', $dest)) {
        $html = file_get_contents($dest);
        // Negative lookbehind: не трогаем пути, у которых уже есть префикс
        $html = preg_replace(
            '#(?<!["\'=/])/_next/#',
            $prefix . '/_next/',
            $html
        );
        file_put_contents($dest, $html);
    }
}
array_unshift($log, "Скопировано файлов: $copied");
array_unshift($log, "Целевая папка: $target");
?>
<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Установка MXW01 — готово</title></head>
<body style="font-family: sans-serif; max-width: 640px; margin: 40px auto;">
<h1>Сайт установлен</h1>
<p><b><?= htmlspecialchars(implode('<br>', array_map('htmlspecialchars', $log))) ?></b></p>
<?php if ($dir !== ''): ?>
<p>Сайт доступен по адресу: <a href="<?= htmlspecialchars($prefix) ?>/"><?= htmlspecialchars($prefix) ?>/</a></p>
<?php else: ?>
<p>Сайт доступен по адресу: <a href="/">/</a></p>
<?php endif; ?>
<p style="color:#b00"><b>Безопасность:</b> удалите install.php после установки.</p>
</body></html>
"""

README = """# Установка сайта печати MXW01

## Вариант 1 — с PHP (рекомендуется, установка в подпапку)
1. Распакуйте архив в любую папку хостинга.
2. Откройте в браузере `install.php`:
   - `https://домен/install.php` — установка в корень;
   - `https://домен/install.php?dir=печать` — установка в подпапку.
3. После установки удалите `install.php`.

## Вариант 2 — без PHP
1. Распакуйте архив в корень сайта (или подпапку — тогда вручную замените
   в `*.html` ссылки `/_next/` на `подпапка/_next/`).
2. Сайт — статические HTML/JS/CSS, серверный код не нужен.

## Файл mxw01-offline.html
Автономная версия страницы, живёт в корне сайта: её скачивает кнопка
«Сохранить страницу» (Ctrl+S или шестерёнка → «Сохранить офлайн-версию»).
НЕ удаляйте этот файл при обновлении — иначе кнопка начнёт отдавать 404.

## Использование
Откройте сайт в Chrome/Edge (нужен Web Bluetooth — HTTPS или localhost),
подключите принтер MXW01 и печатайте.

## Обновление через панель /update (рекомендуется)
1. Откройте `https://домен/update/` (папка ставится вместе с сайтом).
2. При первом визите задайте пароль панели (хранится хешем).
3. Загрузите новый `mxw01-deploy-kit.zip` → «Установить».
   Панель сама сделает резервную копию (последние 3 хранятся),
   распакует кит в корень сайта и покажет новую версию.
4. Папка `update/` при обновлениях не перезаписывается. Если в новой версии
   обновился сам обновитель — включите галочку «обновить также панель /update»
   на экране подтверждения установки (старая панель попадёт в резервную копию).
5. На nginx закройте данные панели: `location ^~ /update/data/ { deny all; }`
   (на Apache их закрывает .htaccess из комплекта).

## Обновление через GitHub (панель v1.0.57+)
1. В панели /update → карточка «Обновление с GitHub» → «Настройки
   репозитория и токена»: впишите owner/repo. Токен нужен только
   приватному репозиторию (хранится в update/data/git.php, папка закрыта).
2. «Проверить релизы» → «Скачать кит с GitHub» → «Установить».
3. Первую установку панели с Git-режимом делайте с галочкой
   «обновить также панель /update» — иначе карточка не появится.
4. На сайте кнопка «Проверить обновления» (Настройки) сверяет версию
   с релизами публичного репозитория и ведёт в эту панель.

## Обновление вручную (без PHP)
Полностью удалите старые файлы сайта (кроме update/, если используете
панель) и повторите установку.
"""


def main() -> int:
    if not os.path.isdir(SRC):
        print(f"Нет папки {SRC} — сначала выполните scripts/build-static.sh", file=sys.stderr)
        return 1
    if not os.path.exists(UPDATER_SRC):
        print(f"Нет {UPDATER_SRC} — панель /update не будет включена", file=sys.stderr)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    ver = app_version()
    built = datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds")
    version_json = json.dumps({"app": "mxw01-print", "version": ver, "built": built}, ensure_ascii=False, indent=2)

    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, _dirnames, filenames in os.walk(SRC):
            for name in filenames:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, SRC)
                z.write(full, rel)
                count += 1
        # Офлайн-версия — часть сайта (функция «Сохранить страницу»).
        # Если не собрана — сначала bash scripts/build-offline.sh.
        has_offline = os.path.exists(OFFLINE)
        if has_offline:
            z.write(OFFLINE, "mxw01-offline.html")
        z.writestr("version.json", version_json)
        z.write(UPDATER_SRC, "update/index.php")
        z.writestr("install.php", INSTALL_PHP)
        z.writestr("README-УСТАНОВКА.md", README)

    if not has_offline:
        print("  ⚠ mxw01-offline.html не найден — «Сохранить страницу» отдаст 404;")
        print("    соберите офлайн-версию (bash scripts/build-offline.sh) и переупакуйте")

    size = os.path.getsize(OUT)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    print(f"✓ {OUT}")
    print(f"  версия: {ver}, файлов: {count + 4 + (1 if has_offline else 0)}, размер: {size / 1024:.0f} КБ, {stamp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
