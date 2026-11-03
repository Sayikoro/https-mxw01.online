#!/usr/bin/env bash
# ============================================================================
# Проверка админ-панели обновлений /update (scripts/php-update/index.php).
# Запуск: bash scripts/test-php-update.sh
# Требует PHP CLI с zip (в песочнице — work/bin/php-cli; на хосте — php).
#
# Сценарий: имитируем установленный сайт v1.0.53 + папка update/, собираем
# «кит» v9.9.9-test и прогоняем панель по HTTP (php -S):
#   1. первый запуск → создание пароля (короткий, несовпадающий, нормальный);
#   2. вход (неверный пароль → ошибка, верный → панель с текущей версией);
#   3. загрузка НЕ-кита → отказ; загрузка кита → превью с версией;
#   4. установка: версия сайта меняется, update/index.php не перезаписан,
#      резервная копия создана и содержит СТАРУЮ версию;
#   5. восстановление из копии → версия сайта откатилась;
#   6. CSRF-защита (действие с чужим токеном отклоняется);
#   7. прямой доступ к update/data/config.php — пусто (выполняется, не отдаётся).
# ============================================================================
set -u
cd "$(dirname "$0")/.."
PHP="work/bin/php-cli"
command -v php >/dev/null 2>&1 && PHP="$(command -v php)"
[ -x "$PHP" ] || { echo "✗ PHP CLI не найден (work/bin/php-cli)"; exit 1; }

BASE="http://127.0.0.1:8099"
DIR="work/update-test"
SITE="$DIR/site"
JAR="$DIR/cookies.txt"

passed=0; failed=0
ok()   { passed=$((passed+1)); echo "  ✓ $1"; }
bad()  { failed=$((failed+1)); echo "  ✗ $1"; }
# - второй аргумент: счётчик rg, «1» от [ -f ... ] и т.п.; любое непустое ≠ 0 — успех - #
check(){ if [ -n "$2" ] && [ "$2" != "0" ]; then ok "$1"; else bad "$1"; fi; }

# ---------- подготовка стенда ----------
rm -rf "$DIR" "$JAR"
mkdir -p "$SITE/_next/static" "$SITE/update"
cp scripts/php-update/index.php "$SITE/update/index.php"
UPD_HASH=$(sha256sum "$SITE/update/index.php" | cut -d' ' -f1)
printf '<html><body>OLD SITE 1.0.53</body></html>' > "$SITE/index.html"
printf 'old css' > "$SITE/_next/static/a.css"
printf '{"app":"mxw01-print","version":"1.0.53"}' > "$SITE/version.json"

# «кит» новой версии (как настоящий: site files + version.json + update/)
KIT="$DIR/kit.zip"
python3 - "$KIT" <<'EOF'
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("version.json", json.dumps({"app": "mxw01-print", "version": "9.9.9-test"}))
    z.writestr("index.html", "<html><body>NEW SITE 9.9.9-test</body></html>")
    z.writestr("_next/static/a.js", "new js")
    z.writestr("_next/static/a.css", "new css")
    z.writestr("mxw01-offline.html", "<html>offline</html>")
    z.writestr("install.php", "<?php echo 'installer';")
    z.writestr("README-УСТАНОВКА.md", "# readme")
    z.writestr("update/index.php", "<?php echo 'MUST BE SKIPPED';")
    z.writestr("__MACOSX/junk", "junk")
EOF
# «не-кит» без version.json
BADZIP="$DIR/bad.zip"
printf 'PK-fake-not-a-kit-archive-content' > "$DIR/plain.txt"
python3 - "$BADZIP" <<'EOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("a.txt", "just a file")
EOF

# ---------- сервер ----------
"$PHP" -S 127.0.0.1:8099 -t "$SITE" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null "$BASE/update/" && break; sleep 0.25; done

get_csrf() { curl -s -b "$JAR" -c "$JAR" "$BASE/update/" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p' | head -1; }
post() { local csrf; csrf="$(get_csrf)"; curl -s -L -b "$JAR" -c "$JAR" --data-urlencode "csrf=$csrf" "$@" "$BASE/update/"; }

echo "== 1. Первый запуск =="
first=$(curl -s -b "$JAR" -c "$JAR" "$BASE/update/")
check "панель показывает «Первый запуск»" "$(echo "$first" | rg -c 'Первый запуск' | head -1)"

csrf="$(get_csrf)"
short=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=abc" -d "password2=abc" "$BASE/update/")
check "короткий пароль отклонён" "$(echo "$short" | rg -c 'не короче 6' | head -1)"
mism=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=secret123" -d "password2=secret124" "$BASE/update/")
check "несовпадение паролей поймано" "$(echo "$mism" | rg -c 'не совпадают' | head -1)"
good=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=secret123" -d "password2=secret123" "$BASE/update/")
check "пароль создан" "$(echo "$good" | rg -c 'Пароль создан' | head -1)"
check "config.php существует" "$([ -f "$SITE/update/data/config.php" ] && echo 1)"
check "data/.htaccess создан" "$([ -f "$SITE/update/data/.htaccess" ] && echo 1)"

echo "== 2. Вход =="
csrf="$(get_csrf)"
wrong=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=WRONG" "$BASE/update/")
check "неверный пароль → ошибка" "$(echo "$wrong" | rg -c 'Неверный пароль' | head -1)"
panel=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=secret123" "$BASE/update/")
check "вход выполнен, показана версия 1.0.53" "$(echo "$panel" | rg -c '1\.0\.53' | head -1)"
check "видна кнопка выхода" "$(echo "$panel" | rg -c 'name="action" value="logout"' | head -1)"

echo "== 3. Загрузка архива =="
csrf="$(get_csrf)"
noKit=$(curl -s -L -b "$JAR" -c "$JAR" -F "csrf=$csrf" -F "action=upload" -F "zip=@$BADZIP" "$BASE/update/")
check "не-кит отклонён (нет version.json)" "$(echo "$noKit" | rg -c 'нет version.json' | head -1)"
upl=$(curl -s -L -b "$JAR" -c "$JAR" -F "csrf=$csrf" -F "action=upload" -F "zip=@$KIT" "$BASE/update/")
check "кит загружен, превью с версией 9.9.9-test" "$(echo "$upl" | rg -c '9\.9\.9-test' | head -1)"
check "в превью кнопка «Установить»" "$(echo "$upl" | rg -c 'name="action" value="install"' | head -1)"

echo "== 4. Установка =="
inst=$(post -d "action=install")
check "флеш: версия 1.0.53 → 9.9.9-test" "$(echo "$inst" | rg -c '1\.0\.53.*→.*9\.9\.9-test' | head -1)"
check "version.json в корне = 9.9.9-test" "$(rg -c '9\.9\.9-test' "$SITE/version.json")"
check "index.html сайта обновился" "$(rg -c 'NEW SITE' "$SITE/index.html")"
check "новые файлы из кита на месте (a.js)" "$([ -f "$SITE/_next/static/a.js" ] && echo 1)"
NEW_HASH=$(sha256sum "$SITE/update/index.php" | cut -d' ' -f1)
check "update/index.php НЕ перезаписан (хеш совпал)" "$([ "$UPD_HASH" = "$NEW_HASH" ] && echo 1)"
BAK=$(ls -1 "$SITE/update/data/backups/"backup-*.zip 2>/dev/null | head -1)
check "резервная копия создана" "$([ -n "$BAK" ] && echo 1)"
bak_ver=$(python3 -c "import zipfile,sys; z=zipfile.ZipFile('$BAK'); print(z.read('version.json').decode())" 2>/dev/null)
check "в копии — СТАРАЯ версия 1.0.53" "$(echo "$bak_ver" | rg -c '1\.0\.53')"
check "загруженный zip удалён после установки" "$([ -z "$(ls "$SITE/update/data/"upload-*.zip 2>/dev/null)" ] && echo 1)"

echo "== 5. Восстановление =="
BAKNAME=$(basename "$BAK")
csrf="$(get_csrf)"
rest=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=restore" -d "name=$BAKNAME" "$BASE/update/")
check "восстановление выполнено" "$(echo "$rest" | rg -c "Восстановлено из $BAKNAME" | head -1)"
check "версия сайта откатилась к 1.0.53" "$(rg -c '1\.0\.53' "$SITE/version.json")"
check "index.html снова старый" "$(rg -c 'OLD SITE' "$SITE/index.html")"
back=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=install" -d "x=1" "$BASE/update/")
check "install без загруженного архива → отказ" "$(echo "$back" | rg -c 'Сначала загрузите' | head -1)"

echo "== 6. CSRF и прямой доступ =="
csrf="$(get_csrf)"
evil=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=deadbeef" -d "action=restore" -d "name=$BAKNAME" "$BASE/update/")
check "действие с чужим CSRF отклонено" "$(echo "$evil" | rg -c 'CSRF' | head -1)"
cfg=$(curl -s "$BASE/update/data/config.php")
check "config.php по прямой ссылке не отдаётся (пусто)" "$([ -z "$cfg" ] && echo 1)"

echo "== 7. Выход =="
out=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=logout" "$BASE/update/")
check "после выхода снова форма входа" "$(echo "$out" | rg -c 'name="action" value="login"' | head -1)"

kill $SRV 2>/dev/null
echo
echo "Итог: $passed прошло, $failed упало"
[ "$failed" = "0" ] || exit 1
