#!/usr/bin/env bash
# ============================================================================
# Проверка Git-обновлений панели /update (v1.0.57): релизы GitHub.
# Запуск: bash scripts/test-php-update-git.sh
# Требует PHP CLI с zip+curl (в песочнице — work/bin/php-cli; на хосте — php).
#
# Стенд: сайт v1.0.0 + панель (с маркером TEST-OLD-PANEL); рядом мок
# api.github.com (php -S на :8098), панель смотрит туда через MXW01_GH_API.
# Мок требует Authorization: Bearer ghp_TEST… — проверяем, что панель
# реально отправляет сохранённый токен.
#
# Сценарий:
#   1. git_check без настроек → преднастроенный репозиторий (мок отвечает 404);
#   2. git_save (owner/repo + токен) → git.php создан, токена нет в HTML;
#   3. git_check → «Доступна новая версия 9.9.9-test», карточка релиза,
#      кнопка «Обновить до v9.9.9-test» (git_install) и «Только скачать кит»;
#   4. git_fetch → кит скачан, превью установки с версией 9.9.9-test;
#   4b. ?api=release: JSON available:true для вошедшего; без cookies — 403;
#   5. install с галочкой «обновить также панель»: версия сайта 9.9.9-test,
#      update/index.php обновился (маркер TEST-OLD-PANEL исчез, git_check
#      появился), в резервной копии есть и update/index.php, и версия 1.0.0;
#   6. restore → откатились и сайт (1.0.0), и панель (TEST-OLD-PANEL вернулся);
#   7. повторный цикл install БЕЗ галочки → update/index.php не перезаписан;
#   8. CSRF: git_check с чужим токеном отклонён;
#   9. ОДНА кнопка git_install: проверка → скачивание → копия → установка
#      (панель обновляется автоматически, gh-*.zip удаляется, кеш api сброшен);
#  10. api=release&refresh=1 после установки → available:false;
#  11. update/data/git.php по прямой ссылке не отдаётся (пусто).
# ============================================================================
set -u
cd "$(dirname "$0")/.."
PHP="work/bin/php-cli"
command -v php >/dev/null 2>&1 && PHP="$(command -v php)"
[ -x "$PHP" ] || { echo "✗ PHP CLI не найден (work/bin/php-cli)"; exit 1; }

GH_BASE="http://127.0.0.1:8098"
BASE="http://127.0.0.1:8099"
DIR="work/update-git-test"
SITE="$DIR/site"
JAR="$DIR/cookies.txt"
TOKEN="ghp_TESTTOKEN1234567890"

passed=0; failed=0
ok()  { passed=$((passed+1)); echo "  ✓ $1"; }
bad() { failed=$((failed+1)); echo "  ✗ $1"; }
check(){ if [ -n "$2" ] && [ "$2" != "0" ]; then ok "$1"; else bad "$1"; fi; }

# ---------- подготовка стенда ----------
rm -rf "$DIR" "$JAR"
mkdir -p "$SITE/_next/static" "$SITE/update"
# панель стенда — текущая, но со старым маркером (имитируем «прошлую версию»)
sed 's|^<?php$|<?php\n/* TEST-OLD-PANEL */|' scripts/php-update/index.php > "$SITE/update/index.php"
UPD_HASH=$(sha256sum "$SITE/update/index.php" | cut -d' ' -f1)
printf '<html><body>OLD SITE 1.0.0</body></html>' > "$SITE/index.html"
printf 'old css' > "$SITE/_next/static/a.css"
printf '{"app":"mxw01-print","version":"1.0.0"}' > "$SITE/version.json"

# «кит» релиза 9.9.9-test: сайт + version.json + НОВАЯ панель (как в реальном ките)
KIT="$DIR/kit.zip"
cp scripts/php-update/index.php "$DIR/panel-new.php"
python3 - "$KIT" "$DIR/panel-new.php" <<'EOF'
import json, sys, zipfile
kit, panel = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(kit, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("version.json", json.dumps({"app": "mxw01-print", "version": "9.9.9-test"}))
    z.writestr("index.html", "<html><body>NEW SITE 9.9.9-test</body></html>")
    z.writestr("_next/static/a.js", "new js")
    z.writestr("mxw01-offline.html", "<html>offline</html>")
    z.write(panel, "update/index.php")
EOF

# ---------- мок api.github.com ----------
cat > "$DIR/mock-gh.php" <<EOF
<?php
// Мок GitHub API. /repos/testuser/mxw01/* — «приватный репозиторий»:
// требует Bearer $TOKEN и отдаёт релиз v9.9.9-test и кит.
// Прочие /repos/* (в т.ч. преднастроенный Sayikoro/…) — публичные,
// токен не нужен, но репозиторий неизвестен → 404 (как на реальном GitHub).
\$uri = parse_url(\$_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
\$priv = (strpos(\$uri, '/repos/testuser/mxw01') === 0);
if (\$priv && (\$_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'Bearer $TOKEN') {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['message' => 'Bad credentials']);
    exit;
}
if (\$uri === '/repos/testuser/mxw01/releases/latest') {
    header('Content-Type: application/json');
    echo json_encode([
        'tag_name' => 'v9.9.9-test',
        'published_at' => '2026-11-03T00:00:00Z',
        'assets' => [[
            'name' => 'mxw01-deploy-kit.zip',
            'size' => filesize('$KIT'),
            'url' => '$GH_BASE/repos/testuser/mxw01/assets/123',
        ]],
    ]);
    exit;
}
if (\$uri === '/repos/testuser/mxw01/assets/123') {
    header('Content-Type: application/octet-stream');
    readfile('$KIT');
    exit;
}
http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['message' => 'Not Found']);
EOF

# ---------- серверы ----------
MXW01_GH_API="$GH_BASE" "$PHP" -S 127.0.0.1:8098 "$DIR/mock-gh.php" >/dev/null 2>&1 &
MOCK=$!
MXW01_GH_API="$GH_BASE" "$PHP" -S 127.0.0.1:8099 -t "$SITE" >/dev/null 2>&1 &
SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null "$BASE/update/" && break; sleep 0.25; done

get_csrf() { curl -s -b "$JAR" -c "$JAR" "$BASE/update/" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p' | head -1; }
post() { local csrf; csrf="$(get_csrf)"; curl -s -L -b "$JAR" -c "$JAR" --data-urlencode "csrf=$csrf" "$@" "$BASE/update/"; }

echo "== 0. Первый запуск и вход =="
csrf="$(get_csrf)"
curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=secret123" -d "password2=secret123" "$BASE/update/" >/dev/null
panel=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=secret123" "$BASE/update/")
check "вход выполнен" "$(echo "$panel" | rg -c 'Обновление с GitHub' | head -1)"

echo "== 1. git_check без настроек: уходит в преднастроенный репозиторий =="
noRepo=$(post -d "action=git_check")
check "мок отвечает 404 по преднастроенному репо (без токена)" "$(echo "$noRepo" | rg -c 'не найдено \(404\)' | head -1)"
check "в карточке показан преднастроенный репозиторий" "$(echo "$noRepo" | rg -c 'Sayikoro/https-mxw01\.online' | head -1)"

echo "== 2. git_save =="
saved=$(post -d "action=git_save" -d "gh_repo=testuser/mxw01" -d "gh_token=$TOKEN")
check "настройки сохранены" "$(echo "$saved" | rg -c 'Настройки GitHub сохранены: testuser/mxw01' | head -1)"
check "git.php создан" "$([ -f "$SITE/update/data/git.php" ] && echo 1)"
check "токен не светится в HTML панели" "$([ -z "$(echo "$saved" | rg -c "$TOKEN")" ] && echo 1)"
badRepo=$(post -d "action=git_save" -d "gh_repo=not-a-repo")
check "чужой формат owner/repo отклонён" "$(echo "$badRepo" | rg -c 'owner/repo' | head -1)"

echo "== 3. git_check =="
chk=$(post -d "action=git_check")
check "флеш: доступна 9.9.9-test" "$(echo "$chk" | rg -c 'Доступна новая версия 9\.9\.9-test \(установлена 1\.0\.0\)' | head -1)"
check "карточка релиза: имя ассета" "$(echo "$chk" | rg -c 'mxw01-deploy-kit\.zip' | head -1)"
check "кнопка-в-один-клик «Обновить до v9.9.9-test»" "$(echo "$chk" | rg -c 'Обновить до v9\.9\.9-test' | head -1)"
check "кнопка git_install присутствует" "$(echo "$chk" | rg -c 'name="action" value="git_install"' | head -1)"
check "кнопка «Только скачать кит» (git_fetch) присутствует" "$(echo "$chk" | rg -c 'name="action" value="git_fetch"' | head -1)"

echo "== 4. git_fetch =="
fetched=$(post -d "action=git_fetch")
check "кит скачан с GitHub" "$(echo "$fetched" | rg -c 'Кит 9\.9\.9-test скачан с GitHub' | head -1)"
check "превью установки с версией 9.9.9-test" "$(echo "$fetched" | rg -c '9\.9\.9-test' | head -1)"
check "появилась галочка «обновить также панель»" "$(echo "$fetched" | rg -c 'name="with_upd"' | head -1)"

echo "== 4b. ?api=release (JSON авто-проверки) =="
api=$(curl -s -b "$JAR" "$BASE/update/?api=release")
api_ok=$(echo "$api" | python3 -c "import json,sys; d=json.load(sys.stdin); print('1' if d.get('available') is True and d.get('version')=='9.9.9-test' and d.get('current')=='1.0.0' and d.get('repo')=='testuser/mxw01' and d.get('name')=='mxw01-deploy-kit.zip' and d.get('size',0)>0 else '0')")
check "JSON: available=true, версия/репо/ассет на месте" "$api_ok"
api403=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/update/?api=release")
check "без сессии → 403" "$([ "$api403" = "403" ] && echo 1)"
api403body=$(curl -s "$BASE/update/?api=release")
check "403 — JSON с ошибкой, не HTML" "$(echo "$api403body" | python3 -c "import json,sys; d=json.load(sys.stdin); print('1' if 'error' in d else '0')")"
apiCache=$(curl -s -b "$JAR" "$BASE/update/?api=release")
check "повторный вызов отдаётся из кеша (тот же JSON)" "$(echo "$apiCache" | python3 -c "import json,sys; d=json.load(sys.stdin); print('1' if d.get('available') is True else '0')")"

echo "== 5. Установка с обновлением панели =="
inst=$(post -d "action=install" -d "with_upd=1")
check "флеш: версия 1.0.0 → 9.9.9-test" "$(echo "$inst" | rg -c '1\.0\.0.*→.*9\.9\.9-test' | head -1)"
check "version.json = 9.9.9-test" "$(rg -c '9\.9\.9-test' "$SITE/version.json")"
check "update/index.php обновился (git_check внутри)" "$(rg -c "case 'git_check'" "$SITE/update/index.php")"
check "старый маркер панели исчез" "$([ -z "$(rg -c 'TEST-OLD-PANEL' "$SITE/update/index.php")" ] && echo 1)"
BAK=$(ls -1 "$SITE/update/data/backups/"backup-*.zip 2>/dev/null | head -1)
check "резервная копия создана" "$([ -n "$BAK" ] && echo 1)"
bak_has_upd=$(python3 -c "import zipfile; print('update/index.php' in zipfile.ZipFile('$BAK').namelist())")
check "в копии есть update/index.php" "$([ "$bak_has_upd" = "True" ] && echo 1)"
bak_ver=$(python3 -c "import zipfile; z=zipfile.ZipFile('$BAK'); print(z.read('version.json').decode())")
check "в копии — СТАРАЯ версия 1.0.0" "$(echo "$bak_ver" | rg -c '1\.0\.0')"
check "gh-*.zip удалён после установки" "$([ -z "$(ls "$SITE/update/data/"gh-*.zip 2>/dev/null)" ] && echo 1)"

echo "== 6. Восстановление (сайт + панель) =="
BAKNAME=$(basename "$BAK")
rest=$(post -d "action=restore" -d "name=$BAKNAME")
check "восстановление выполнено" "$(echo "$rest" | rg -c "Восстановлено из $BAKNAME" | head -1)"
check "версия сайта откатилась к 1.0.0" "$(rg -c '1\.0\.0' "$SITE/version.json")"
check "панель откатилась (TEST-OLD-PANEL вернулся)" "$(rg -c 'TEST-OLD-PANEL' "$SITE/update/index.php")"
REST_HASH=$(sha256sum "$SITE/update/index.php" | cut -d' ' -f1)
check "панель откатилась байт-в-байт (хеш исходной)" "$([ "$UPD_HASH" = "$REST_HASH" ] && echo 1)"

echo "== 7. Установка БЕЗ галочки: панель не трогается =="
post -d "action=git_check" >/dev/null
post -d "action=git_fetch" >/dev/null
inst2=$(post -d "action=install")
check "сайт обновился до 9.9.9-test" "$(rg -c '9\.9\.9-test' "$SITE/version.json")"
NEW_HASH=$(sha256sum "$SITE/update/index.php" | cut -d' ' -f1)
check "update/index.php НЕ перезаписан (хеш тот же)" "$([ "$UPD_HASH" = "$NEW_HASH" ] && echo 1)"

echo "== 8. CSRF =="
csrf="$(get_csrf)"
evil=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=deadbeef" -d "action=git_check" "$BASE/update/")
check "git_check с чужим CSRF отклонён" "$(echo "$evil" | rg -c 'CSRF' | head -1)"

echo "== 9. Одна кнопка git_install (проверка+скачивание+копия+установка) =="
BAK_BEFORE=$(ls -1 "$SITE/update/data/backups/"backup-*.zip 2>/dev/null | wc -l)
inst1=$(post -d "action=git_install")
check "флеш: обновлено с GitHub (testuser/mxw01)" "$(echo "$inst1" | rg -c 'Обновлено с GitHub \(testuser/mxw01\): файлов' | head -1)"
check "версия сайта 9.9.9-test" "$(rg -c '9\.9\.9-test' "$SITE/version.json")"
check "панель обновилась сама (git_install внутри)" "$(rg -c "case 'git_install'" "$SITE/update/index.php")"
check "старый маркер панели исчез" "$([ -z "$(rg -c 'TEST-OLD-PANEL' "$SITE/update/index.php")" ] && echo 1)"
check "gh-*.zip удалён после установки" "$([ -z "$(ls "$SITE/update/data/"gh-*.zip 2>/dev/null)" ] && echo 1)"
BAK_AFTER=$(ls -1 "$SITE/update/data/backups/"backup-*.zip 2>/dev/null | wc -l)
check "резервная копия создана (+1)" "$([ "$BAK_AFTER" -gt "$BAK_BEFORE" ] && echo 1)"

echo "== 10. api=release&refresh=1 после установки: обновления нет =="
api2=$(curl -s -b "$JAR" "$BASE/update/?api=release&refresh=1")
api2ok=$(echo "$api2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('1' if d.get('available') is False and d.get('current')=='9.9.9-test' and d.get('version')=='9.9.9-test' else '0')")
check "JSON: available=false (установлена = GitHub)" "$api2ok"

echo "== 11. Прямой доступ к данным панели =="
gitcfg=$(curl -s "$BASE/update/data/git.php")
check "git.php по прямой ссылке не отдаётся (пусто)" "$([ -z "$gitcfg" ] && echo 1)"

kill $MOCK $SRV 2>/dev/null
echo
echo "Итог: $passed прошло, $failed упало"
[ "$failed" = "0" ] || exit 1
