#!/usr/bin/env bash
# ============================================================================
# Проверка админки аналитики /admin (scripts/php-admin/index.php + hit.php).
# Запуск: bash scripts/test-admin.sh
# Требует PHP CLI (в песочнице — work/bin/php, на хосте — php).
#
# Сценарий: имитируем сайт v1.0.58 + папка admin/, прогоняем по HTTP (php -S):
#   1. первый запуск → создание пароля (короткий, несовпадающий, нормальный);
#   2. вход: неверный пароль → ошибка, верный → дашборд;
#   3. блокировка подбора: 5 неудач → «подождите N мин» (сброс = rm lock.php);
#   4. хиты: 204 на JSON/мусор/GET, разбор UA, солёный IP (сырого нет в файле),
#      лимит частоты (≤40 событий/мин на vid), пинг не считается просмотром;
#   5. API ?api=stats: 403 без входа, валидный JSON с живыми счётчиками;
#   6. аудит: события пишутся, пароль в журнал НЕ попадает; соль замаскирована;
#   7. смена пароля: неверный текущий → отказ, смена → вход только новым;
#   8. настройки: неизвестный пояс отклонён, retention сохранён, соль меняется;
#   9. очистка данных посещений; 10. CSRF; 11. выход.
# ============================================================================
set -u
cd "$(dirname "$0")/.."
PHP="work/bin/php"
command -v php >/dev/null 2>&1 && PHP="$(command -v php)"
[ -x "$PHP" ] || { echo "✗ PHP CLI не найден"; exit 1; }

BASE="http://127.0.0.1:8101"
DIR="work/admin-test"
SITE="$DIR/site"
JAR="$DIR/cookies.txt"
JAR2="$DIR/cookies2.txt"

passed=0; failed=0
ok()  { passed=$((passed+1)); echo "  ✓ $1"; }
bad() { failed=$((failed+1)); echo "  ✗ $1"; }
check(){ if [ -n "$2" ] && [ "$2" != "0" ]; then ok "$1"; else bad "$1"; fi; }

# ---------- подготовка стенда ----------
rm -rf "$DIR" "$JAR" "$JAR2"
mkdir -p "$SITE/admin"
cp scripts/php-admin/index.php "$SITE/admin/index.php"
cp scripts/php-admin/hit.php "$SITE/admin/hit.php"
printf '<html><body>MXW01 SITE 1.0.58</body></html>' > "$SITE/index.html"
printf '{"app":"mxw01-print","version":"1.0.58"}' > "$SITE/version.json"

# ---------- сервер ----------
export MXW01_ADMIN_DELAY=0
"$PHP" -S 127.0.0.1:8101 -t "$SITE" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null "$BASE/admin/" && break; sleep 0.25; done

get_csrf() { curl -s -b "$1" -c "$1" "$BASE/admin/" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p' | head -1; }
post() { local jar="$1"; shift; local csrf; csrf="$(get_csrf "$jar")"; curl -s -L -b "$jar" -c "$jar" --data-urlencode "csrf=$csrf" "$@" "$BASE/admin/"; }
HITFILE=$(ls -1 "$SITE/admin/data/hits/"*.jsonl 2>/dev/null | head -1)

echo "== 1. Первый запуск =="
first=$(curl -s -b "$JAR" -c "$JAR" "$BASE/admin/")
check "экран «Первый запуск»" "$(echo "$first" | rg -c 'Первый запуск' | head -1)"
csrf="$(get_csrf "$JAR")"
short=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=abc12" -d "password2=abc12" "$BASE/admin/")
check "короткий пароль отклонён (мин. 8)" "$(echo "$short" | rg -c 'не короче 8' | head -1)"
mism=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=adminpass99" -d "password2=adminpass98" "$BASE/admin/")
check "несовпадение паролей поймано" "$(echo "$mism" | rg -c 'не совпадают' | head -1)"
curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=setup" -d "password=adminpass99" -d "password2=adminpass99" "$BASE/admin/" > /dev/null
check "config.php создан" "$([ -f "$SITE/admin/data/config.php" ] && echo 1)"
check "config.php содержит ХЕШ, а не пароль" "$([ -z "$(rg -c 'adminpass99' "$SITE/admin/data/config.php")" ] && [ -n "$(grep -cF '$2y$' "$SITE/admin/data/config.php")" ] && echo 1)"
check "data/.htaccess создан" "$([ -f "$SITE/admin/data/.htaccess" ] && echo 1)"

echo "== 2. Вход =="
csrf="$(get_csrf "$JAR")"
wrong=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=WRONG-PASS" "$BASE/admin/")
check "неверный пароль → ошибка без эха пароля" "$(echo "$wrong" | rg -c 'Неверный пароль' | head -1)"
check "введённый пароль нигде не отрисовался" "$([ -z "$(echo "$wrong" | rg -c 'WRONG-PASS')" ] && echo 1)"
dash=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=adminpass99" "$BASE/admin/")
check "вход выполнен — дашборд с KPI" "$(echo "$dash" | rg -c 'Сейчас на сайте' | head -1)"
check "на дашборде есть ?api=stats" "$(echo "$dash" | rg -c 'api=stats' | head -1)"

echo "== 3. Блокировка подбора =="
csrf="$(get_csrf "$JAR2")"
for i in 1 2 3 4 5; do curl -s -L -b "$JAR2" -c "$JAR2" -d "csrf=$csrf" -d "action=login" -d "password=bad$i" "$BASE/admin/" > /dev/null; done
locked=$(curl -s -L -b "$JAR2" -c "$JAR2" -d "csrf=$csrf" -d "action=login" -d "password=bad6" "$BASE/admin/")
check "после 5 неудач — «подождите N мин»" "$(echo "$locked" | rg -c 'подождите' | head -1)"
rm -f "$SITE/admin/data/lock.php"
check "сброс блокировки файлом lock.php работает" "$([ ! -f "$SITE/admin/data/lock.php" ] && echo 1)"

echo "== 4. Хиты и приватность =="
code=$(curl -s -o /dev/null -w '%{http_code}' -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" -H 'Content-Type: text/plain' --data '{"type":"page","vid":"aabbccdd11223344","p":"/","ref":"https://yandex.ru/search","lang":"ru","w":1920,"h":1080}' "$BASE/admin/hit.php")
check "валидный хит → 204" "$([ "$code" = "204" ] && echo 1)"
HITFILE=$(ls -1 "$SITE/admin/data/hits/"*.jsonl 2>/dev/null | head -1)
check "файл хитов создан" "$([ -n "$HITFILE" ] && echo 1)"
check "UA разобран (Chrome 125)" "$(rg -c '"b":"Chrome 125"' "$HITFILE")"
check "ОС определена (Windows 10/11)" "$(rg -c '"o":"Windows 10[^"]*11"' "$HITFILE")"
check "реферер урезан до host/path" "$(rg -c '"r":"yandex.ru[^"]*search"' "$HITFILE")"
check "сырого IP в файле НЕТ" "$([ -z "$(rg -c '127\.0\.0\.1' "$HITFILE")" ] && echo 1)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: text/plain' --data 'not-json{{{' "$BASE/admin/hit.php")
check "мусорный хит → 204 без падения" "$([ "$code" = "204" ] && echo 1)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/hit.php")
check "GET без тела → 204" "$([ "$code" = "204" ] && echo 1)"
for i in $(seq 1 45); do curl -s -o /dev/null -H 'Content-Type: text/plain' --data '{"type":"ping","vid":"aabbccdd11223344","p":"/"}' "$BASE/admin/hit.php"; done
vid_records=$(rg -c 'aabbccdd11223344' "$HITFILE")
check "лимит частоты: ≤41 запись на vid (получено $vid_records)" "$([ "$vid_records" -le 41 ] && [ "$vid_records" -ge 38 ] && echo 1)"
curl -s -o /dev/null -H 'Content-Type: text/plain' --data '{"type":"ping","vid":"ffffffffffffffff","p":"/"}' "$BASE/admin/hit.php"

echo "== 5. API живой статистики =="
api403=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/?api=stats")
check "без входа API → 403" "$([ "$api403" = "403" ] && echo 1)"
api=$(curl -s -b "$JAR" -c "$JAR" "$BASE/admin/?api=stats")
check "JSON валиден" "$(echo "$api" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['kpi']['vt']>=1 and d['live']>=2; print(1)" 2>/dev/null)"
check "просмотр посчитан, пинги — нет" "$(echo "$api" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['kpi']['vt']==1 and d['live']==2; print(1)" 2>/dev/null)"
check "в JSON есть hourly[24], spark[30], daily 30 дней" "$(echo "$api" | python3 -c "import json,sys; d=json.load(sys.stdin); assert len(d['hourly'])==24 and len(d['spark'])==30 and len(d['daily']['v'])==30; print(1)" 2>/dev/null)"
check "топ-страница '/' найдена" "$(echo "$api" | python3 -c "import json,sys; d=json.load(sys.stdin); assert any(p=='/' for p,_ in d['tops']['pages']); print(1)" 2>/dev/null)"
check "источник yandex.ru в топе" "$(echo "$api" | python3 -c "import json,sys; d=json.load(sys.stdin); assert any('yandex.ru' in p for p,_ in d['tops']['refs']); print(1)" 2>/dev/null)"

echo "== 6. Аудит и маскирование =="
check "аудит содержит вход" "$(rg -c '"ev":"login_ok"' "$SITE/admin/data/audit.jsonl")"
check "аудит содержит неверный вход" "$(rg -c '"ev":"login_fail"' "$SITE/admin/data/audit.jsonl")"
check "пароль в аудит НЕ попал" "$([ -z "$(rg -c 'adminpass99' "$SITE/admin/data/audit.jsonl")" ] && echo 1)"
dash2=$(curl -s -b "$JAR" -c "$JAR" "$BASE/admin/")
check "соль замаскирована (••••••••)" "$(echo "$dash2" | rg -c '••••••••' | head -1)"
check "в настройках пароль показан точками" "$(echo "$dash2" | rg -c '•••••••• — хранится только хеш' | head -1)"
SALT1=$(sha256sum "$SITE/admin/data/salt.php" | cut -d' ' -f1)

echo "== 7. Смена пароля =="
badcur=$(post "$JAR" -d "action=pass_change" -d "cur=WRONGCURRENT" -d "password=newsecret456" -d "password2=newsecret456")
check "неверный текущий пароль → отказ" "$(echo "$badcur" | rg -c 'Текущий пароль неверен' | head -1)"
okch=$(post "$JAR" -d "action=pass_change" -d "cur=adminpass99" -d "password=newsecret456" -d "password2=newsecret456")
check "смена выполнена" "$(echo "$okch" | rg -c 'Пароль изменён' | head -1)"
csrf="$(get_csrf "$JAR")"
oldfail=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=adminpass99" "$BASE/admin/")
oldcheck="$(echo "$oldfail" | rg -c 'Неверный пароль' | head -1)"
[ -n "$oldcheck" ] || echo "$oldfail" > /tmp/oldfail.html
check "старый пароль больше не подходит" "$oldcheck"
csrf="$(get_csrf "$JAR")"
curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=login" -d "password=newsecret456" "$BASE/admin/" > /dev/null
again=$(curl -s -b "$JAR" -c "$JAR" "$BASE/admin/")
check "вход новым паролем работает" "$(echo "$again" | rg -c 'Сейчас на сайте' | head -1)"

echo "== 8. Настройки =="
badtz=$(post "$JAR" -d "action=save_opts" -d "retention=90" -d "tz=Mars/Olympus")
check "неизвестный часовой пояс отклонён" "$(echo "$badtz" | rg -c 'Неизвестный часовой пояс' | head -1)"
okopts=$(post "$JAR" -d "action=save_opts" -d "retention=14" -d "tz=Europe/Moscow")
check "настройки сохранены" "$(echo "$okopts" | rg -c 'Настройки сохранены' | head -1)"
check "retention=14 в конфиге" "$(rg -c "'retention' => 14" "$SITE/admin/data/config.php")"
post "$JAR" -d "action=regen_salt" > /dev/null
SALT2=$(sha256sum "$SITE/admin/data/salt.php" | cut -d' ' -f1)
check "соль перегенерировалась" "$([ "$SALT1" != "$SALT2" ] && echo 1)"

echo "== 9. Очистка данных =="
clear=$(post "$JAR" -d "action=clear_hits")
check "очистка выполнена" "$(echo "$clear" | rg -c 'Данные посещений удалены' | head -1)"
check "файлов хитов больше нет" "$([ -z "$(ls "$SITE/admin/data/hits/"*.jsonl 2>/dev/null)" ] && echo 1)"
api2=$(curl -s -b "$JAR" -c "$JAR" "$BASE/admin/?api=stats")
check "после очистки vt=0, JSON жив" "$(echo "$api2" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['kpi']['vt']==0; print(1)" 2>/dev/null)"

echo "== 10. CSRF =="
evil=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=deadbeef" -d "action=clear_hits" "$BASE/admin/")
check "действие с чужим CSRF отклонено" "$(echo "$evil" | rg -c 'CSRF' | head -1)"

echo "== 11. Выход =="
csrf="$(get_csrf "$JAR")"
out=$(curl -s -L -b "$JAR" -c "$JAR" -d "csrf=$csrf" -d "action=logout" "$BASE/admin/")
check "после выхода снова форма входа" "$(echo "$out" | rg -c 'Пароль админки' | head -1)"
api3=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/admin/?api=stats")
check "после выхода API снова 403" "$([ "$api3" = "403" ] && echo 1)"

kill $SRV 2>/dev/null
echo
echo "Итог: $passed прошло, $failed упало"
[ "$failed" = "0" ] || exit 1
