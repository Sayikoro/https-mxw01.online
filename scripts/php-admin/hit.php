<?php
/**
 * ============================================================================
 *  КОЛЛЕКТОР ПОСЕЩЕНИЙ АДМИНКИ MXW01 (/admin/hit.php).          PHP 7.4+
 * ============================================================================
 *  Публичная точка приёма хитов с сайта (см. src/components/printer/self-hit.tsx):
 *  страница шлёт компактный JSON через navigator.sendBeacon (fallback —
 *  fetch keepalive). Скрипт парсит User-Agent, солёно-хеширует IP и пишет
 *  одну JSON-строку в admin/data/hits/YYYYMMDD.jsonl.
 *
 *  Приватность:
 *   - сырой IP НИКОГДА не пишется — только HMAC-SHA256(соль) первые 10 симв.;
 *   - vid — случайный localStorage-идентификатор без личных данных;
 *   - реферер урезается до хоста+пути, все поля чистятся и ограничиваются.
 *
 *  Ответ всегда 204 (no content) — коллекция не должна влиять на сайт.
 *  Расширений PHP не требует (json и hash — в стандартной сборке).
 * ============================================================================
 */
declare(strict_types=1);
error_reporting(0);

define('DATA', __DIR__ . '/data');
define('HITS', DATA . '/hits');
define('SALTFILE', DATA . '/salt.php');
define('RLFILE', DATA . '/rl.json');

/** 204 на любой запрос — даже мусорный */
http_response_code(204);
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

/** Папки данных + .htaccess (как в панели /update) */
function ensure_dirs(): void {
    if (!is_dir(DATA)) @mkdir(DATA, 0755, true);
    if (!is_dir(HITS)) @mkdir(HITS, 0755, true);
    $ht = DATA . '/.htaccess';
    if (!file_exists($ht)) @file_put_contents($ht, "Require all denied\nDeny from all\n");
}

/** Соль для IP-хешей: создаётся один раз, живёт в salt.php (папка закрыта) */
function salt(): string {
    if (file_exists(SALTFILE)) {
        $c = @include SALTFILE;
        if (is_array($c) && isset($c['salt']) && is_string($c['salt']) && $c['salt'] !== '') {
            return $c['salt'];
        }
    }
    $s = bin2hex(random_bytes(16));
    @file_put_contents(
        SALTFILE,
        "<?php\n/* - соль IP-хешей коллектора /admin/hit.php (автосоздано) - */\nreturn " . var_export(['salt' => $s], true) . ";\n",
        LOCK_EX
    );
    if (function_exists('opcache_invalidate')) @opcache_invalidate(SALTFILE, true);
    return $s;
}

/** Разбор User-Agent → [браузер+версия, ОС, тип устройства] (по-русски, как в админке) */
function parse_ua(string $ua): array {
    $br = 'Другой';
    $m = [];
    if (preg_match('/YaBrowser\/([0-9]+)/', $ua, $m)) $br = 'Яндекс.Браузер';
    elseif (preg_match('/Edg(?:e|A|iOS)?\/([0-9]+)/', $ua, $m)) $br = 'Edge';
    elseif (preg_match('/OPR\/([0-9]+)/', $ua, $m)) $br = 'Opera';
    elseif (preg_match('/SamsungBrowser\/([0-9]+)/', $ua, $m)) $br = 'Samsung Internet';
    elseif (preg_match('/Firefox\/([0-9]+)/', $ua, $m)) $br = 'Firefox';
    elseif (preg_match('/Chrome\/([0-9]+)/', $ua, $m)) $br = 'Chrome';
    elseif (preg_match('/Version\/([0-9]+).*Safari\//', $ua, $m)) $br = 'Safari';
    elseif (preg_match('#^curl/#', $ua)) $br = 'curl';
    if (isset($m[1]) && $m[1] !== '' && $br !== 'Другой' && $br !== 'curl') $br .= ' ' . $m[1];

    $os = 'Другое';
    if (stripos($ua, 'Windows Phone') !== false) $os = 'Windows Phone';
    elseif (preg_match('/Windows NT ([0-9.]+)/', $ua, $m2)) {
        $map = ['6.1' => 'Windows 7', '6.3' => 'Windows 8.1', '10.0' => 'Windows 10/11'];
        $os = $map[$m2[1]] ?? 'Windows';
    } elseif (preg_match('/Android ([0-9]+)/', $ua, $m2)) $os = 'Android ' . $m2[1];
    elseif (stripos($ua, 'iPhone') !== false || stripos($ua, 'iPad') !== false) {
        $os = 'iOS';
        if (preg_match('/OS ([0-9_]+)/', $ua, $m2)) $os .= ' ' . str_replace('_', '.', $m2[1]);
    } elseif (stripos($ua, 'Mac OS X') !== false) $os = 'macOS';
    elseif (stripos($ua, 'CrOS') !== false) $os = 'ChromeOS';
    elseif (stripos($ua, 'Linux') !== false) $os = 'Linux';

    $dv = 'Компьютер';
    if (stripos($ua, 'iPad') !== false || stripos($ua, 'Tablet') !== false) $dv = 'Планшет';
    elseif (stripos($ua, 'Mobi') !== false || stripos($ua, 'iPhone') !== false) $dv = 'Смартфон';
    return [$br, $os, $dv];
}

/** Строка в безопасный короткий текст: без управляющих символов, ≤ len */
function clean_str(string $s, int $len): string {
    $s = preg_replace('/[\x00-\x1f\x7f]/u', '', $s) ?? '';
    $s = mb_substr($s, 0, $len, 'UTF-8');
    return trim($s);
}

/** Реферер → «host/path» (парсится, урезается; пустой/битый → пусто) */
function clean_ref(string $r): string {
    if ($r === '') return '';
    $u = parse_url($r);
    if (!is_array($u)) return '';
    $host = strtolower((string)($u['host'] ?? ''));
    if ($host === '') return '';
    $path = (string)($u['path'] ?? '/');
    return substr($host . $path, 0, 100);
}

/** Ретеншн: раз в ~200 хитов удаляем старые файлы (дней из config.php админки) */
function cleanup_old(int $defaultDays): void {
    if (random_int(1, 200) !== 1) return;
    $days = $defaultDays;
    $conf = DATA . '/config.php';
    if (file_exists($conf)) {
        $c = @include $conf;
        if (is_array($c) && isset($c['opts']['retention'])) {
            $days = max(3, min(730, (int)$c['opts']['retention']));
        }
    }
    $cut = time() - $days * 86400 - 86400;
    foreach (glob(HITS . '/*.jsonl') ?: [] as $f) {
        if (preg_match('/(\d{8})\.jsonl$/', (string)$f, $m)) {
            $ts = strtotime($m[1] . 'T23:59:59+00:00');
            if ($ts !== false && $ts < $cut) @unlink((string)$f);
        }
    }
}

/* ------------------------------- приём хита ------------------------------- */

ensure_dirs();
cleanup_old(90);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') exit; /* 204 уже выставлен */

$raw = (string)file_get_contents('php://input');
if ($raw === '' || strlen($raw) > 4096) exit;
$j = json_decode($raw, true);
if (!is_array($j)) exit;

$ty = ($j['type'] ?? '') === 'ping' ? 'ping' : 'page';
$vid = strtolower((string)($j['vid'] ?? ''));
if (!preg_match('/^[0-9a-f]{8,32}$/', $vid)) {
    /* без vid — считаем по солёному IP */
    $vid = substr(hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? ''), salt()), 0, 12);
}

/* - простой лимит частоты: ≤ 40 событий/мин на vid (страница + пинги сильно меньше) - */
$rl = is_file(RLFILE) ? (json_decode((string)@file_get_contents(RLFILE), true) ?: []) : [];
$minute = gmdate('YmdHi');
if (($rl['m'] ?? '') !== $minute) $rl = ['m' => $minute, 'c' => []];
$n = (int)($rl['c'][$vid] ?? 0);
if ($n >= 40) exit; /* тихо дропаем спам */
$rl['c'][$vid] = $n + 1;
@file_put_contents(RLFILE, json_encode($rl), LOCK_EX);

[$br, $os, $dv] = parse_ua(substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300));

$rec = [
    't'  => time(),
    'ty' => $ty,
    'v'  => $vid,
    'p'  => clean_str((string)($j['p'] ?? '/'), 120) ?: '/',
    'r'  => clean_ref(clean_str((string)($j['ref'] ?? ''), 200)),
    'l'  => clean_str((string)($j['lang'] ?? ''), 12),
    'w'  => max(0, min(20000, (int)($j['w'] ?? 0))),
    'h'  => max(0, min(20000, (int)($j['h'] ?? 0))),
    'b'  => $br,
    'o'  => $os,
    'd'  => $dv,
    'i'  => substr(hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? ''), salt()), 0, 10),
];

$file = HITS . '/' . gmdate('Ymd') . '.jsonl';
/* - предохранитель: файл больше 16 МБ не растёт (защита от переполнения диска) - */
$size = @filesize($file);
if ($size === false || $size < 16 * 1048576) {
    @file_put_contents($file, json_encode($rec, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}
exit;
