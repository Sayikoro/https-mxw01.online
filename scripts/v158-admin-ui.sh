#!/usr/bin/env bash
# Стенд для v158-admin-ui.js: сайт с админкой + сеялка хитов.
set -euo pipefail
cd "$(dirname "$0")/.."
PHP="work/bin/php"
[ -x "$PHP" ] || PHP="$(command -v php)"

DIR="work/admin-ui-test"
rm -rf "$DIR"; mkdir -p "$DIR/site/admin"
cp scripts/php-admin/index.php "$DIR/site/admin/"
cp scripts/php-admin/hit.php "$DIR/site/admin/"
printf '{"app":"mxw01-print","version":"1.0.59"}' > "$DIR/site/version.json"

"$PHP" -S 127.0.0.1:8107 -t "$DIR/site" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:8107/admin/" && break; sleep 0.25; done

H() { curl -s -o /dev/null -A "$2" -H 'Content-Type: text/plain' --data "$1" "http://127.0.0.1:8107/admin/hit.php"; }
UA_PC='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
UA_FF='Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0'
UA_MOB='Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

# сеялка: 3 посетителя, разные страницы/источники + пинги
for i in 1 2 3 4 5 6 7 8; do
  H "{\"type\":\"page\",\"vid\":\"aa0000000000000$i\",\"p\":\"/\",\"ref\":\"https://www.google.com/\",\"lang\":\"ru\",\"w\":1920,\"h\":1080}" "$UA_PC"
  H "{\"type\":\"page\",\"vid\":\"bb0000000000000$i\",\"p\":\"/faq\",\"ref\":\"https://yandex.ru/search\",\"lang\":\"ru\",\"w\":390,\"h\":844}" "$UA_MOB"
  H "{\"type\":\"page\",\"vid\":\"cc0000000000000$i\",\"p\":\"/\",\"ref\":\"\",\"lang\":\"en\",\"w\":1440,\"h\":900}" "$UA_FF"
done
for i in 1 2 3 4 5; do
  H '{"type":"ping","vid":"aa00000000000001","p":"/"}' "$UA_PC"
done
echo "стенд готов: http://127.0.0.1:8107/admin/ (хиты посеяны)"
export BASE_URL="http://127.0.0.1:8107"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
node scripts/v158-admin-ui.js
