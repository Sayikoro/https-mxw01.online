<?php
/**
 * ============================================================================
 *  АДМИНКА САЙТА ПЕЧАТИ MXW01: АНАЛИТИКА (/admin).            PHP 7.4+
 * ============================================================================
 *  Живёт в папке /admin сайта (кладётся деплой-китом рядом с /update).
 *  Полная аналитика посещений без внешних сервисов и без БД:
 *
 *   1. Первый визит — создаёте пароль (только хеш в admin/data/config.php);
 *   2. Вход по паролю (сессия + CSRF, замедление перебора, блокировка после
 *      5 неудачных попыток на 15 минут);
 *   3. Сайт (v1.0.58+) отправляет хиты на admin/hit.php — они пишутся в
 *      admin/data/hits/YYYYMMDD.jsonl (сырой IP не хранится — только
 *      солёный HMAC-хеш; vid — случайный localStorage-идентификатор);
 *   4. Дашборд живой: раз в 5 секунд опрашивает ?api=stats и обновляет
 *      KPI, графики (SVG), ленту визитов и топы без перезагрузки страницы;
 *   5. Настройки: смена пароля, часовой пояс, срок хранения хитов,
 *      очистка данных, перегенерация соли; журнал действий (аудит).
 *
 *  Безопасность и приватность:
 *   - пароль хранится ТОЛЬКО хешем (password_hash), нигде не показывается
 *     и не пишется в логи/аудит (в аудит идёт «••••••»);
 *   - соль показывается замаскированной (первые 2 + … + последние 2 симв.);
 *   - все действия POST + CSRF-токен; сессия отваливается после 60 мин простоя;
 *   - заголовки X-Frame-Options/CSP/nosniff; данные закрыты .htaccess
 *     (Apache), для nginx — location ^~ /admin/data/ { deny all; }.
 * ============================================================================
 */
declare(strict_types=1);
error_reporting(E_ALL & ~E_DEPRECATED);

session_name('mxw01adm');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'lifetime' => 0, 'path' => '/']);
session_start();

define('ROOT', rtrim(str_replace('\\', '/', dirname(__DIR__)), '/'));
define('DATA', __DIR__ . '/data');
define('HITS', DATA . '/hits');
define('CONF', DATA . '/config.php');
define('SALTFILE', DATA . '/salt.php');
define('LOCKF', DATA . '/lock.php');
define('AUDITF', DATA . '/audit.jsonl');
define('CACHEF', DATA . '/cache.json');
define('IDLE_SECONDS', 3600);      /* простой сессии */
define('MAX_FAILS', 5);            /* неудачных входов до блокировки */
define('LOCK_SECONDS', 900);       /* блокировка подбора, сек */
define('LIVE_SECONDS', 300);       /* «сейчас на сайте»: окно активности */
define('DEFAULT_TZ', 'Asia/Sakhalin');

/* ------------------------------ помощники ------------------------------ */

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

function ensure_dirs(): void {
    if (!is_dir(DATA)) @mkdir(DATA, 0755, true);
    if (!is_dir(HITS)) @mkdir(HITS, 0755, true);
    $ht = DATA . '/.htaccess';
    if (!file_exists($ht)) @file_put_contents($ht, "Require all denied\nDeny from all\n");
}

function csrf_token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

function csrf_ok(?string $t): bool {
    return is_string($t) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $t);
}

function is_authed(): bool { return !empty($_SESSION['mxw01adm_auth']); }

function flash(string $type, string $msg): void { $_SESSION['flash'] = ['type' => $type, 'msg' => $msg]; }

function flash_take(): ?array {
    if (empty($_SESSION['flash'])) return null;
    $f = $_SESSION['flash'];
    unset($_SESSION['flash']);
    return $f;
}

function redirect(string $to = './'): void { header('Location: ' . $to); exit; }

/** Маскирование секрета: видно максимум 2+2 крайних символа */
function mask_secret(string $s): string {
    $n = strlen($s);
    if ($n <= 8) return '••••••••';
    return mb_substr($s, 0, 2) . '••••••••' . mb_substr($s, -2);
}

/** Солёный хеш IP (сырой IP нигде не сохраняется) */
function ip_hash(): string {
    return substr(hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? ''), salt()), 0, 10);
}

function salt(): string {
    if (file_exists(SALTFILE)) {
        $c = @include SALTFILE;
        if (is_array($c) && isset($c['salt']) && is_string($c['salt']) && $c['salt'] !== '') return $c['salt'];
    }
    $s = bin2hex(random_bytes(16));
    @file_put_contents(SALTFILE, "<?php\n/* - соль IP-хешей (автосоздано) - */\nreturn " . var_export(['salt' => $s], true) . ";\n", LOCK_EX);
    if (function_exists('opcache_invalidate')) @opcache_invalidate(SALTFILE, true);
    return $s;
}

/** Аудит: журнал действий. Пароли/секреты сюда НЕ пишутся никогда. */
function audit(string $ev, string $note = ''): void {
    $line = json_encode(['t' => time(), 'ev' => $ev, 'note' => $note], JSON_UNESCAPED_UNICODE);
    @file_put_contents(AUDITF, $line . "\n", FILE_APPEND | LOCK_EX);
    /* - не даём журналу разрастаться: последние 1000 записей - */
    $size = @filesize(AUDITF);
    if ($size !== false && $size > 200000) {
        $lines = @file(AUDITF, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        if (count($lines) > 1000) @file_put_contents(AUDITF, implode("\n", array_slice($lines, -1000)) . "\n", LOCK_EX);
    }
}

function load_conf(): array {
    $d = ['hash' => '', 'created' => 0, 'opts' => ['retention' => 90, 'tz' => DEFAULT_TZ]];
    if (!file_exists(CONF)) return $d;
    $c = @include CONF;
    if (!is_array($c)) return $d;
    $d['hash'] = (string)($c['hash'] ?? '');
    $d['created'] = (int)($c['created'] ?? 0);
    $o = is_array($c['opts'] ?? null) ? $c['opts'] : [];
    $d['opts']['retention'] = max(3, min(730, (int)($o['retention'] ?? 90)));
    $tz = (string)($o['tz'] ?? DEFAULT_TZ);
    $d['opts']['tz'] = in_array($tz, timezone_identifiers_list(), true) ? $tz : DEFAULT_TZ;
    return $d;
}

function save_conf(array $c): bool {
    $php = "<?php\n/* - конфиг админки /admin (хеш пароля; создано автоматически) - */\nreturn " . var_export($c, true) . ";\n";
    $ok = file_put_contents(CONF, $php, LOCK_EX) !== false;
    /* - opcache кеширует include ~2 с (revalidate_freq) — без инвалидации
       следующий запрос прочитает СТАРЫЙ хеш и «старый» пароль пройдёт - */
    if ($ok && function_exists('opcache_invalidate')) @opcache_invalidate(CONF, true);
    return $ok;
}

/** Блокировка подбора пароля: состояние в lock.php, ключ — солёный хеш IP */
function load_lock(): array {
    if (!file_exists(LOCKF)) return [];
    $l = @include LOCKF;
    return is_array($l) ? $l : [];
}

function save_lock(array $l): void {
    @file_put_contents(LOCKF, "<?php return " . var_export($l, true) . ";\n", LOCK_EX);
    if (function_exists('opcache_invalidate')) @opcache_invalidate(LOCKF, true);
}

/** Возвращает остаток блокировки в секундах (0 — не заблокирован); чистит протухшее */
function lock_wait(): int {
    $k = ip_hash();
    $l = load_lock();
    $now = time();
    foreach ($l as $kk => $v) {
        if ((int)($v['u'] ?? 0) + LOCK_SECONDS < $now && (int)($v['f'] ?? 0) === 0) unset($l[$kk]);
    }
    $u = (int)($l[$k]['u'] ?? 0);
    if ($u > 0 && $now < $u + LOCK_SECONDS) { save_lock($l); return $u + LOCK_SECONDS - $now; }
    save_lock($l);
    return 0;
}

function lock_fail(): void {
    $k = ip_hash();
    $l = load_lock();
    $f = (int)($l[$k]['f'] ?? 0) + 1;
    if ($f >= MAX_FAILS) { $l[$k] = ['f' => 0, 'u' => time()]; audit('lock', 'IP ' . $k . ': ' . MAX_FAILS . ' неудачных входов'); }
    else { $l[$k] = ['f' => $f, 'u' => 0]; }
    save_lock($l);
}

function lock_clear(): void {
    $k = ip_hash();
    $l = load_lock();
    unset($l[$k]);
    save_lock($l);
}

/** Версия сайта из корневого version.json */
function site_version(): string {
    $f = ROOT . '/version.json';
    if (!file_exists($f)) return '';
    $j = json_decode((string)file_get_contents($f), true);
    return is_array($j) && isset($j['version']) ? (string)$j['version'] : '';
}

/* ----------------------------- агрегация хитов ----------------------------- */

/**
 * Собирает полную статистику из admin/data/hits/*.jsonl.
 * Дни/часы — в выбранном часовом поясе; окна: 30 дней (график), 7 дней (топы),
 * 30 минут (спарклайн), 5 минут («сейчас на сайте»).
 */
function build_stats(): array {
    $conf = load_conf();
    $opts = $conf['opts'];
    $tz = new DateTimeZone($opts['tz']);
    $now = time();

    $files = glob(HITS . '/*.jsonl') ?: [];
    sort($files);
    if (count($files) > 62) $files = array_slice($files, -62); /* окно памяти: 62 дня */

    $loc = function (int $ts) use ($tz): DateTime {
        $d = new DateTime('@' . $ts);
        $d->setTimezone($tz);
        return $d;
    };

    $today = $loc($now)->format('Y-m-d');
    $yest = $loc($now - 86400)->format('Y-m-d');
    $day7 = $loc($now - 6 * 86400)->format('Y-m-d');

    $viewsByDay = [];      /* Y-m-d → просмотры (type=page) */
    $uniqByDay = [];       /* Y-m-d → [vid => 1] */
    $firstSeen = [];       /* vid → первый день Y-m-d */
    $hourly = array_fill(0, 24, 0);
    $spark = [];           /* «YmdHi» минуты → события */
    $liveSet = [];
    $liveEvents = 0;
    $tops = ['pages' => [], 'refs' => [], 'browsers' => [], 'os' => [], 'devices' => [], 'langs' => [], 'screens' => []];
    $feed = [];
    $viewsTotal = 0;
    $eventsTotal = 0;
    $uniq7 = [];

    foreach ($files as $f) {
        $lines = @file((string)$f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $ln) {
            $r = json_decode((string)$ln, true);
            if (!is_array($r) || !isset($r['t'])) continue;
            $ts = (int)$r['t'];
            if ($ts > $now + 120) continue; /* часы хостинга убежали — игнор */
            $dt = $loc($ts);
            $day = $dt->format('Y-m-d');
            $vid = (string)($r['v'] ?? '');
            $ty = ($r['ty'] ?? '') === 'ping' ? 'ping' : 'page';
            $eventsTotal++;
            if (!isset($firstSeen[$vid])) $firstSeen[$vid] = $day;

            $minKey = $dt->format('YmdHi');
            $spark[$minKey] = ($spark[$minKey] ?? 0) + 1;
            if ($ts > $now - LIVE_SECONDS) { $liveSet[$vid] = 1; $liveEvents++; }

            if (!isset($viewsByDay[$day])) { $viewsByDay[$day] = 0; $uniqByDay[$day] = []; }
            if ($ty === 'page') {
                $viewsByDay[$day]++;
                $viewsTotal++;
                $uniqByDay[$day][$vid] = 1;
            }

            if ($day === $today && $ty === 'page') $hourly[(int)$dt->format('G')]++;

            /* - топы и уникальные 7 дней — только реальные просмотры (пинги не считаются) - */
            if ($day >= $day7 && $ty === 'page') {
                $uniq7[$vid] = 1;
                $p = (string)($r['p'] ?? '/');
                if ($p !== '') $tops['pages'][$p] = ($tops['pages'][$p] ?? 0) + 1;
                $rf = (string)($r['r'] ?? '');
                $rh = $rf === '' ? '— прямые заходы' : preg_replace('#^(https?://)?([^/]+).*$#su', '$2', $rf);
                $tops['refs'][$rh] = ($tops['refs'][$rh] ?? 0) + 1;
                foreach (['b' => 'browsers', 'o' => 'os', 'd' => 'devices', 'l' => 'langs'] as $k => $bucket) {
                    $v = trim((string)($r[$k] ?? ''));
                    if ($v !== '') $tops[$bucket][$v] = ($tops[$bucket][$v] ?? 0) + 1;
                }
                $w = (int)($r['w'] ?? 0); $hh = (int)($r['h'] ?? 0);
                if ($w > 0 && $hh > 0) { $scr = $w . '×' . $hh; $tops['screens'][$scr] = ($tops['screens'][$scr] ?? 0) + 1; }
            }

            $feed[] = ['t' => $ts, 'ty' => $ty, 'p' => (string)($r['p'] ?? '/'), 'b' => (string)($r['b'] ?? ''),
                       'o' => (string)($r['o'] ?? ''), 'd' => (string)($r['d'] ?? ''), 'l' => (string)($r['l'] ?? ''),
                       'r' => (string)($r['r'] ?? ''), 'v' => $vid, 'day' => $day];
        }
    }

    usort($feed, fn($a, $b) => $b['t'] <=> $a['t'] || ($a['v'] <=> $b['v']));
    $feed = array_slice($feed, 0, 25);

    /* - график 30 дней: от (today-29) до today, пропуски — нули - */
    $dlabels = []; $dviews = []; $duniq = [];
    for ($i = 29; $i >= 0; $i--) {
        $d = $loc($now - $i * 86400)->format('Y-m-d');
        $dlabels[] = $loc($now - $i * 86400)->format('d.m');
        $dviews[] = $viewsByDay[$d] ?? 0;
        $duniq[] = isset($uniqByDay[$d]) ? count($uniqByDay[$d]) : 0;
    }

    /* - спарклайн: последние 30 минут по минутам - */
    $sparkArr = [];
    $min0 = (int)floor($now / 60) - 29;
    for ($i = 0; $i < 30; $i++) $sparkArr[] = $spark[date('YmdHi', ($min0 + $i) * 60)] ?? 0;

    $topN = function (array $a, int $n = 8): array {
        arsort($a);
        $out = [];
        foreach (array_slice($a, 0, $n, true) as $k => $v) $out[] = [(string)$k, (int)$v];
        return $out;
    };

    /* «новые сегодня»: первые события сегодня И был хотя бы один просмотр страницы */
    $newToday = 0;
    $todayViews = $uniqByDay[$today] ?? [];
    foreach ($firstSeen as $vid => $day) {
        if ($day === $today && isset($todayViews[$vid])) $newToday++;
    }

    return [
        'now' => $now,
        'tz' => $opts['tz'],
        'ver' => site_version(),
        'live' => count($liveSet),
        'live_events' => $liveEvents,
        'kpi' => [
            'vt' => $viewsByDay[$today] ?? 0,
            'vy' => $viewsByDay[$yest] ?? 0,
            'ut' => isset($uniqByDay[$today]) ? count($uniqByDay[$today]) : 0,
            'nt' => $newToday,
            'v7' => array_sum(array_filter($viewsByDay, fn($v, $k) => $k >= $day7, ARRAY_FILTER_USE_BOTH)),
            'u7' => count($uniq7),
            'tot' => $viewsTotal,
        ],
        'hourly' => $hourly,
        'spark' => $sparkArr,
        'daily' => ['l' => $dlabels, 'v' => $dviews, 'u' => $duniq],
        'tops' => array_map($topN, $tops),
        'feed' => array_map(function ($f) use ($tz) {
            $dt = (new DateTime('@' . $f['t']))->setTimezone($tz);
            $f['hm'] = $dt->format('H:i:s');
            unset($f['day']);
            return $f;
        }, $feed),
        'window_days' => count($files),
    ];
}

/** Агрегация с кешем на 4 секунды (живой опрос без нагрузки на диск) */
function stats_cached(): array {
    $keyParts = [];
    foreach (glob(HITS . '/*.jsonl') ?: [] as $f) $keyParts[] = (string)@filemtime((string)$f) . ':' . (string)@filesize((string)$f);
    $key = md5(implode('|', $keyParts) . '|' . floor(time() / 4));
    $cache = is_file(CACHEF) ? (json_decode((string)@file_get_contents(CACHEF), true) ?: []) : [];
    if (($cache['k'] ?? '') === $key && isset($cache['j'])) return $cache['j'];
    $j = build_stats();
    @file_put_contents(CACHEF, json_encode(['k' => $key, 'j' => $j], JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $j;
}

/* --------------------------- обработка действий --------------------------- */

/* - защитные заголовки (до любого вывода) - */
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'");

ensure_dirs();
$conf = load_conf();
$cfgExists = $conf['hash'] !== '';
$nowTz = new DateTimeZone($conf['opts']['tz']);

/* - простой сессии: 60 минут - */
if (is_authed()) {
    if (time() - (int)($_SESSION['t'] ?? 0) > IDLE_SECONDS) {
        audit('logout_idle');
        unset($_SESSION['mxw01adm_auth']);
        flash('err', 'Сессия завершена после часа простоя — войдите снова');
        redirect('./');
    }
    $_SESSION['t'] = time();
}

/* - API живой статистики (только для вошедших) - */
if (($_GET['api'] ?? '') === 'stats') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (!is_authed()) { http_response_code(403); echo json_encode(['err' => 'unauthorized']); exit; }
    echo json_encode(stats_cached(), JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !csrf_ok($_POST['csrf'] ?? null)) {
    flash('err', 'Сессия устарела (CSRF) — обновите страницу и попробуйте снова');
    redirect('./');
}

/* - первый запуск: создание пароля - */
if (!$cfgExists && ($_POST['action'] ?? '') === 'setup') {
    $p1 = (string)($_POST['password'] ?? '');
    $p2 = (string)($_POST['password2'] ?? '');
    if (strlen($p1) < 8) {
        flash('err', 'Пароль должен быть не короче 8 символов');
    } elseif ($p1 !== $p2) {
        flash('err', 'Пароли не совпадают');
    } else {
        $ok = save_conf([
            'hash' => password_hash($p1, PASSWORD_DEFAULT),
            'created' => time(),
            'opts' => $conf['opts'],
        ]);
        if ($ok) {
            @chmod(CONF, 0644);
            session_regenerate_id(true);
            $_SESSION['mxw01adm_auth'] = true;
            $_SESSION['t'] = time();
            audit('setup');
            flash('ok', 'Пароль создан — добро пожаловать');
            redirect('./');
        }
        flash('err', 'Не удалось записать config.php — проверьте права на папку admin/');
    }
    redirect('./');
}

/* - вход - */
if ($cfgExists && ($_POST['action'] ?? '') === 'login') {
    $wait = lock_wait();
    if ($wait > 0) {
        flash('err', 'Слишком много неудачных попыток — подождите ' . ceil($wait / 60) . ' мин');
        audit('login_locked', 'IP ' . ip_hash());
    } elseif (password_verify((string)($_POST['password'] ?? ''), $conf['hash'])) {
        session_regenerate_id(true);
        $_SESSION['mxw01adm_auth'] = true;
        $_SESSION['t'] = time();
        lock_clear();
        audit('login_ok', 'IP ' . ip_hash());
        redirect('./');
    } else {
        /* - замедляем перебор пароля; в тестах отключается MXW01_ADMIN_DELAY=0 - */
        if (getenv('MXW01_ADMIN_DELAY') !== '0') sleep(1);
        lock_fail();
        audit('login_fail', 'IP ' . ip_hash());
        $l = load_lock();
        $left = MAX_FAILS - (int)($l[ip_hash()]['f'] ?? 0);
        flash('err', 'Неверный пароль' . ($left > 0 && $left < MAX_FAILS ? ' (осталось попыток: ' . $left . ')' : ''));
    }
    redirect('./');
}

if (is_authed() && ($_POST['action'] ?? '') === 'logout') {
    audit('logout');
    unset($_SESSION['mxw01adm_auth']);
    session_regenerate_id(true);
    redirect('./');
}

/* - действия после входа - */
if (is_authed()) {
    switch ($_POST['action'] ?? '') {
        case 'pass_change': {
            $cur = (string)($_POST['cur'] ?? '');
            $p1 = (string)($_POST['password'] ?? '');
            $p2 = (string)($_POST['password2'] ?? '');
            if (!password_verify($cur, $conf['hash'])) {
                flash('err', 'Текущий пароль неверен');
                audit('pass_change_fail');
            } elseif (strlen($p1) < 8) {
                flash('err', 'Новый пароль должен быть не короче 8 символов');
            } elseif ($p1 !== $p2) {
                flash('err', 'Новые пароли не совпадают');
            } else {
                $conf['hash'] = password_hash($p1, PASSWORD_DEFAULT);
                if (save_conf($conf)) {
                    audit('pass_change', '•••••• (хеш обновлён, сам пароль нигде не сохраняется)');
                    flash('ok', 'Пароль изменён');
                } else {
                    flash('err', 'Не удалось записать config.php');
                }
            }
            redirect('./');
        }
        case 'save_opts': {
            $ret = max(3, min(730, (int)($_POST['retention'] ?? 90)));
            $tz = (string)($_POST['tz'] ?? DEFAULT_TZ);
            if (!in_array($tz, timezone_identifiers_list(), true)) {
                flash('err', 'Неизвестный часовой пояс: ' . h($tz));
            } else {
                $conf['opts'] = ['retention' => $ret, 'tz' => $tz];
                save_conf($conf);
                @unlink(CACHEF); /* статистика пересчитается в новом поясе */
                audit('save_opts', 'retention=' . $ret . ', tz=' . $tz);
                flash('ok', 'Настройки сохранены');
            }
            redirect('./');
        }
        case 'regen_salt': {
            @file_put_contents(SALTFILE, "<?php\n/* - соль IP-хешей (перегенерирована) - */\nreturn " . var_export(['salt' => bin2hex(random_bytes(16))], true) . ";\n", LOCK_EX);
            if (function_exists('opcache_invalidate')) @opcache_invalidate(SALTFILE, true);
            audit('regen_salt', 'IP-хеши в старых хитах больше не сравнимы с новыми');
            flash('ok', 'Соль перегенерирована');
            redirect('./');
        }
        case 'clear_hits': {
            foreach (glob(HITS . '/*.jsonl') ?: [] as $f) @unlink((string)$f);
            @unlink(CACHEF);
            audit('clear_hits');
            flash('ok', 'Данные посещений удалены');
            redirect('./');
        }
    }
}

/* ------------------------------- страница ------------------------------- */
$flash = flash_take();
$ver = site_version();
$saltMasked = mask_secret(salt());
$nowLocal = (new DateTime('now', $nowTz))->format('d.m.Y H:i');
$tzList = array_values(array_intersect([
    'Asia/Sakhalin', 'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg',
    'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok',
    'Asia/Magadan', 'Asia/Kamchatka', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Europe/Kyiv',
    'Europe/Minsk', 'Europe/Berlin', 'Europe/London', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Shanghai',
    'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles', 'UTC',
], timezone_identifiers_list()));
$retentionChoices = [14, 30, 60, 90, 180, 365, 730];
$auditLines = [];
if (is_authed() && file_exists(AUDITF)) {
    $lines = @file(AUDITF, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $auditLines = array_slice(array_reverse($lines), 0, 30);
}
$EV_LABELS = [
    'setup' => 'создание пароля', 'login_ok' => 'вход', 'login_fail' => 'неверный пароль',
    'login_locked' => 'блокировка подбора', 'lock' => 'включена блокировка', 'logout' => 'выход',
    'logout_idle' => 'выход по простою', 'pass_change' => 'смена пароля', 'pass_change_fail' => 'ошибка смены пароля',
    'save_opts' => 'настройки сохранены', 'regen_salt' => 'соль перегенерирована', 'clear_hits' => 'данные посещений удалены',
];
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Аналитика MXW01</title>
</head>
<body>
<div class="wrap">
<style>
  :root{--bg:#0b1220;--card:#111a2e;--card2:#0e1626;--line:#1f2b45;--ink:#e5ecf8;--mut:#8194b4;--acc:#6366f1;--sky:#38bdf8;--ok:#34d399;--err:#f87171;--amber:#fbbf24}
  *{box-sizing:border-box}
  body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:radial-gradient(1200px 500px at 70% -10%,#182445 0%,var(--bg) 55%);margin:0;min-height:100vh}
  a{color:var(--sky);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 16px 40px}
  header.top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  h1{font-size:19px;margin:0;font-weight:700;letter-spacing:.2px}
  .badge{background:#1c2a4a;color:#9fb4e8;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
  .chip{display:inline-flex;align-items:center;gap:6px;background:#0f1c37;border:1px solid var(--line);border-radius:999px;padding:3px 12px;font-size:12px;color:var(--mut)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);animation:pulse 1.6s ease infinite}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}55%{box-shadow:0 0 0 6px rgba(52,211,153,0)}}
  .spacer{flex:1}
  .flash{border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px}
  .flash.ok{background:#0c2b22;color:var(--ok);border:1px solid #14532d}
  .flash.err{background:#2b1414;color:var(--err);border:1px solid #7f1d1d}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px;margin-bottom:12px}
  .kpi{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:14px;padding:12px 14px}
  .kpi .k{color:var(--mut);font-size:12px}
  .kpi .v{font-size:26px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
  .kpi .sub{font-size:11px;margin-top:2px;color:var(--mut)}
  .kpi .up{color:var(--ok)}.kpi .down{color:var(--err)}
  .kpi.live .v{color:var(--ok)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px;align-items:start}
  .card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
  .card h2{font-size:12px;margin:0 0 10px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.7px}
  svg{width:100%;height:auto;display:block}
  rect.b{fill:var(--acc);opacity:.85;transition:y .45s ease,height .45s ease,opacity .15s}
  rect.b:hover{opacity:1}
  rect.b2{fill:#22d3ee;opacity:.75}
  polyline{fill:none;stroke:var(--sky);stroke-width:2}
  text{fill:#5b6f95;font-size:10px}
  .trow{display:grid;grid-template-columns:minmax(90px,40%) 1fr 56px;gap:8px;align-items:center;padding:3px 0;font-size:12.5px}
  .trow .tl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tbar{background:#0d1730;border-radius:4px;height:8px;overflow:hidden}
  .tbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--acc),#8b5cf6);border-radius:4px;transition:width .5s ease}
  .trow.o .tbar i{background:linear-gradient(90deg,#0ea5e9,#22d3ee)}
  .tn{text-align:right;color:var(--mut);font-variant-numeric:tabular-nums}
  .frow{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px dashed #16223c;font-size:12.5px}
  .frow.in{animation:slidein .4s ease}
  @keyframes slidein{from{opacity:0;transform:translateY(-6px)}to{opacity:1}}
  .ft{color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 58px}
  .fp{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26%}
  .fm{color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fr{margin-left:auto;color:#5b6f95;font-size:11px;max-width:28%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tag{font-size:10px;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--mut);flex:0 0 auto}
  table.a{width:100%;border-collapse:collapse;font-size:12px}
  table.a td{padding:4px 6px;border-bottom:1px solid #16223c;color:var(--mut);vertical-align:top}
  table.a td.e{color:var(--ink);white-space:nowrap}
  input,select{background:#0d1730;border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:8px 10px;font-size:13px;width:100%;margin-bottom:8px}
  input:focus,select:focus{outline:none;border-color:var(--acc)}
  input[type=checkbox]{width:auto}
  button,.btn{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
  button:hover{filter:brightness(1.1)}
  button.ghost{background:#16223c;color:var(--ink);border:1px solid var(--line)}
  button.danger{background:#2b1414;color:var(--err);border:1px solid #7f1d1d}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .muted{color:var(--mut);font-size:12px}
  .meter{height:4px;background:#0d1730;border-radius:2px;margin:-4px 0 8px}
  .meter i{display:block;height:100%;width:0;border-radius:2px;background:var(--err);transition:width .3s,background .3s}
  footer{margin-top:14px;color:var(--mut);font-size:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  code{background:#0d1730;border-radius:4px;padding:1px 5px;font-size:11.5px;color:#9fb4e8}
  .login{max-width:440px;margin:8vh auto 0}
</style>
<?php if ($flash): ?><div class="flash <?= h($flash['type']) ?>"><?= h($flash['msg']) ?></div><?php endif; ?>

<?php if (!$cfgExists): ?>
  <!-- - первый запуск: создаём пароль - -->
  <div class="login card">
    <h1 style="margin-bottom:6px">Аналитика MXW01</h1>
    <p class="muted">Первый запуск — задайте пароль админки. Хранится только хеш в <code>admin/data/config.php</code>; сам пароль нигде не сохраняется и не показывается.</p>
    <form method="post" action="./">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <input type="hidden" name="action" value="setup">
      <input type="password" class="pw" name="password" placeholder="Пароль (минимум 8 символов)" required minlength="8" autocomplete="new-password" autofocus>
      <div class="meter"><i id="mi"></i></div>
      <input type="password" class="pw" name="password2" placeholder="Повторите пароль" required minlength="8" autocomplete="new-password">
      <button type="submit">Создать пароль</button>
    </form>
  </div>

<?php elseif (!is_authed()): ?>
  <!-- - вход - -->
  <div class="login card">
    <h1 style="margin-bottom:6px">Аналитика MXW01 <?= $ver !== '' ? '<span class="badge">v' . h($ver) . '</span>' : '' ?></h1>
    <form method="post" action="./">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <input type="hidden" name="action" value="login">
      <input type="password" class="pw" name="password" placeholder="Пароль админки" required autocomplete="current-password" autofocus>
      <button type="submit">Войти</button>
    </form>
    <p class="muted" style="margin-top:8px">Забыли пароль? Удалите <code>admin/data/config.php</code> по FTP — админка предложит создать новый.</p>
  </div>

<?php else: ?>

  <header class="top">
    <h1>Аналитика MXW01 <span class="badge" id="ver"><?= $ver !== '' ? 'v' . h($ver) : '' ?></span></h1>
    <span class="chip"><span class="dot"></span><b id="live-n" style="color:var(--ink)">0</b>&nbsp;сейчас</span>
    <span class="chip" id="live-ev">…</span>
    <span class="spacer"></span>
    <a class="btn" style="background:#16223c;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px" href="../">сайт</a>
    <a class="btn" style="background:#16223c;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px" href="../update/">обновления</a>
    <form method="post" action="./" style="display:inline">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <input type="hidden" name="action" value="logout">
      <button class="ghost" type="submit">Выйти</button>
    </form>
  </header>

  <!-- - KPI: живые счётчики - -->
  <div class="kpis">
    <div class="kpi live"><div class="k">Сейчас на сайте</div><div class="v" id="v-live">0</div><div class="sub">активность за 5 минут</div></div>
    <div class="kpi"><div class="k">Просмотры сегодня</div><div class="v" id="v-vt">0</div><div class="sub"><span id="d-vt"></span></div></div>
    <div class="kpi"><div class="k">Посетители сегодня</div><div class="v" id="v-ut">0</div><div class="sub" id="d-nt"></div></div>
    <div class="kpi"><div class="k">Просмотры за 7 дней</div><div class="v" id="v-v7">0</div><div class="sub"><span id="d-u7"></span></div></div>
    <div class="kpi"><div class="k">Просмотры всего</div><div class="v" id="v-tot">0</div><div class="sub">в окне хранения</div></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Сегодня по часам</h2>
      <svg id="ch-hours" viewBox="0 0 600 166" role="img" aria-label="Просмотры по часам"></svg>
    </div>
    <div class="card">
      <h2>Хиты в минуту — последние 30 минут</h2>
      <svg id="ch-spark" viewBox="0 0 600 56" role="img" aria-label="Хиты в минуту"></svg>
      <p class="muted" style="margin:6px 0 0">Пинги видимой вкладки идут раз в минуту — ровная полоска означает активного читателя.</p>
    </div>
    <div class="card" style="grid-column:1/-1">
      <h2>30 дней: просмотры (столбцы) и посетители (линия)</h2>
      <svg id="ch-days" viewBox="0 0 600 190" role="img" aria-label="Просмотры и посетители за 30 дней"></svg>
    </div>
    <div class="card">
      <h2>Лента визитов — live</h2>
      <div id="feed"><div class="muted" id="feed-empty">Пока пусто — появятся с первыми визитами сайта.</div></div>
    </div>
    <div>
      <div class="card"><h2>Топ страниц</h2><div id="t-pages"></div></div>
      <div class="card"><h2>Источники</h2><div id="t-refs"></div></div>
      <div class="card"><h2>Браузеры</h2><div id="t-br"></div></div>
      <div class="card"><h2>Системы</h2><div id="t-os"></div></div>
    </div>
    <div>
      <div class="card"><h2>Устройства</h2><div id="t-dv"></div></div>
      <div class="card"><h2>Языки</h2><div id="t-langs"></div></div>
      <div class="card"><h2>Экраны</h2><div id="t-scr"></div></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Настройки</h2>
      <table class="a" style="margin-bottom:10px">
        <tr><td class="e">Пароль</td><td>•••••••• — хранится только хеш, просмотру не подлежит</td></tr>
        <tr><td class="e">Соль IP-хешей</td><td><code><?= h($saltMasked) ?></code> — маскируется; сырой IP нигде не хранится</td></tr>
        <tr><td class="e">Данные</td><td><code>admin/data/</code> · <?= h($conf['opts']['tz']) ?> · хранить <?= (int)$conf['opts']['retention'] ?> дн. · <?= h($nowLocal) ?></td></tr>
      </table>
      <details>
        <summary class="muted" style="cursor:pointer">Сменить пароль</summary>
        <form method="post" action="./" style="margin-top:8px">
          <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
          <input type="hidden" name="action" value="pass_change">
          <input type="password" name="cur" placeholder="Текущий пароль" required autocomplete="current-password">
          <input type="password" class="pw" name="password" placeholder="Новый пароль (мин. 8)" required minlength="8" autocomplete="new-password">
          <div class="meter"><i id="mi"></i></div>
          <input type="password" class="pw" name="password2" placeholder="Повторите новый" required minlength="8" autocomplete="new-password">
          <button type="submit">Сменить пароль</button>
        </form>
      </details>
      <details style="margin-top:8px">
        <summary class="muted" style="cursor:pointer">Часовой пояс и хранение</summary>
        <form method="post" action="./" style="margin-top:8px">
          <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
          <input type="hidden" name="action" value="save_opts">
          <select name="tz">
            <?php foreach ($tzList as $z): ?><option value="<?= h($z) ?>"<?= $z === $conf['opts']['tz'] ? ' selected' : '' ?>><?= h($z) ?></option><?php endforeach; ?>
          </select>
          <select name="retention">
            <?php foreach ($retentionChoices as $r): ?><option value="<?= (int)$r ?>"<?= (int)$r === (int)$conf['opts']['retention'] ? ' selected' : '' ?>>хранить посещения <?= (int)$r ?> дней</option><?php endforeach; ?>
          </select>
          <button type="submit">Сохранить</button>
        </form>
      </details>
      <details style="margin-top:8px">
        <summary class="muted" style="cursor:pointer">Обслуживание</summary>
        <div class="row" style="margin-top:8px">
          <form method="post" action="./" onsubmit="return confirm('Перегенерировать соль? Статистика по IP-хешам в старых хитах потеряет сравнимость.')">
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
            <input type="hidden" name="action" value="regen_salt">
            <button class="ghost" type="submit">Перегенерировать соль</button>
          </form>
          <form method="post" action="./" onsubmit="return confirm('Удалить ВСЕ данные посещений? Отменить нельзя.')">
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
            <input type="hidden" name="action" value="clear_hits">
            <button class="danger" type="submit">Очистить данные посещений</button>
          </form>
        </div>
      </details>
    </div>
    <div class="card">
      <h2>Журнал действий (аудит)</h2>
      <?php if (!$auditLines): ?>
        <p class="muted">Пока пусто.</p>
      <?php else: ?>
        <table class="a">
          <?php foreach ($auditLines as $ln):
              $a = json_decode((string)$ln, true);
              if (!is_array($a)) continue;
              $t = (int)($a['t'] ?? 0);
              $ev = (string)($a['ev'] ?? '?');
              $hm = $t ? (new DateTime('@' . $t))->setTimezone($nowTz)->format('d.m H:i') : '—';
              $note = (string)($a['note'] ?? ''); ?>
          <tr><td class="e"><?= h($hm) ?></td><td><?= h($EV_LABELS[$ev] ?? $ev) ?></td><td><?= h($note) ?></td></tr>
          <?php endforeach; ?>
        </table>
      <?php endif; ?>
      <p class="muted" style="margin:8px 0 0">Пароли в журнал не пишутся никогда — только факты и замаскированные IP-хеши.</p>
    </div>
  </div>

  <footer>
    <span>MXW01 admin · PHP <?= h(PHP_VERSION) ?></span>
    <span>·</span>
    <a href="https://t.me/The_Sovereign_o_f_Dawn" target="_blank" rel="noreferrer">Разработчик: @The_Sovereign_o_f_Dawn</a>
    <span class="spacer"></span>
    <span id="upd" class="muted"></span>
  </footer>

  <script>
  /* - живой дашборд: опрос ?api=stats каждые 5 с, анимации без библиотек - */
  (function () {
    "use strict";
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var fmt = function (n) { return Number(n || 0).toLocaleString("ru-RU"); };
    var NS = "http://www.w3.org/2000/svg";

    function tween(el, to) {
      to = Number(to) || 0;
      var from = el._v || 0; el._v = to;
      if (from === to) { el.textContent = fmt(to); return; }
      var t0 = performance.now(), D = 600;
      (function st(t) {
        var k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(Math.round(from + (to - from) * e));
        if (k < 1) requestAnimationFrame(st);
      })(t0);
    }

    function delta(cur, prev, el) {
      if (!el) return;
      if (!prev) { el.textContent = prev === cur ? "" : "= к вчера"; el.className = ""; return; }
      var p = Math.round((cur - prev) / prev * 100);
      el.textContent = (p >= 0 ? "+" : "") + p + "% к вчера";
      el.className = p >= 0 ? "up" : "down";
    }

    /* столбчатая диаграмма: rect-ы создаются один раз, далее меняются высоты —
       CSS-переходы дают живую анимацию без перерисовки DOM */
    function bars(svg, values, opts) {
      opts = opts || {};
      var W = 600, H = opts.h || 150, base = opts.base || 0, bw = W / values.length;
      var rects = svg._r;
      if (!rects || rects.length !== values.length) {
        svg.innerHTML = ""; rects = [];
        values.forEach(function () {
          var r = document.createElementNS(NS, "rect");
          r.setAttribute("class", "b" + (opts.cls ? " " + opts.cls : ""));
          r.setAttribute("rx", "2");
          svg.appendChild(r); rects.push(r);
        });
        svg._r = rects;
      }
      var max = Math.max(1, Math.max.apply(null, values));
      values.forEach(function (v, i) {
        var r = rects[i], bh = Math.round((H - base) * v / max);
        r.setAttribute("x", (i * bw + 1).toFixed(1));
        r.setAttribute("width", Math.max(1, bw - 2).toFixed(1));
        r.setAttribute("y", (H - base - bh).toFixed(1));
        r.setAttribute("height", (v > 0 ? Math.max(2, bh) : 0).toFixed(1));
        if (!r._t) { r._t = document.createElementNS(NS, "title"); r.appendChild(r._t); }
        r._t.textContent = opts.tip ? opts.tip(i, v) : String(v);
      });
      if (opts.labels) {
        var labs = svg._l;
        if (!labs || labs.length !== values.length) {
          labs = values.map(function () {
            var t = document.createElementNS(NS, "text");
            t.setAttribute("text-anchor", "middle"); svg.appendChild(t); return t;
          });
          svg._l = labs;
        }
        values.forEach(function (_, i) {
          labs[i].setAttribute("x", (i * bw + bw / 2).toFixed(1));
          labs[i].setAttribute("y", H - 2);
          labs[i].textContent = opts.labels[i] || "";
        });
      }
    }

    /* 30 дней: столбцы просмотров + линия уникальных посетителей */
    function daily(svg, d) {
      bars(svg, d.v, { base: 16, labels: d.l.map(function (s, i) { return i % 5 === 0 ? s : ""; }), tip: function (i) { return d.l[i] + ": " + fmt(d.v[i]) + " просмотров, " + fmt(d.u[i]) + " посетителей"; } });
      var W = 600, H = 190, base = 16, n = d.v.length, bw = W / n;
      var maxU = Math.max(1, Math.max.apply(null, d.u));
      var pts = d.u.map(function (u, i) {
        return ((i * bw + bw / 2).toFixed(1)) + "," + (H - base - (H - base - 6) * u / maxU).toFixed(1);
      }).join(" ");
      var pl = svg._p;
      if (!pl) { pl = document.createElementNS(NS, "polyline"); svg.appendChild(pl); svg._p = pl; }
      pl.setAttribute("points", pts);
    }

    /* топ-строки: DOM держится по ключу — ширины баров плавно переезжают */
    function top(box, rows) {
      if (!box._rows) box._rows = new Map();
      var seen = new Set();
      var max = rows.length ? rows[0][1] : 0;
      rows.forEach(function (row) {
        var label = row[0], n = row[1];
        var el = box._rows.get(label);
        if (!el) {
          el = document.createElement("div"); el.className = "trow";
          el.innerHTML = '<span class="tl"></span><span class="tbar"><i></i></span><span class="tn"></span>';
          box.appendChild(el); box._rows.set(label, el);
        }
        el.querySelector(".tl").textContent = label;
        el.querySelector(".tbar i").style.width = (max ? (n / max * 100) : 0) + "%";
        el.querySelector(".tn").textContent = fmt(n);
        seen.add(label);
      });
      box._rows.forEach(function (el, label) {
        if (!seen.has(label)) { el.remove(); box._rows.delete(label); }
      });
    }

    /* лента: свежие сверху, новые строки съезжают с анимацией */
    function feed(rows) {
      var box = $("#feed");
      if (!box._rows) box._rows = new Map();
      $("#feed-empty").style.display = rows.length ? "none" : "";
      var frag = document.createDocumentFragment();
      var seen = new Set();
      rows.forEach(function (r) {
        var key = [r.t, r.v, r.p, r.ty].join("|");
        seen.add(key);
        var el = box._rows.get(key);
        if (!el) {
          el = document.createElement("div"); el.className = "frow in";
          el.innerHTML = '<span class="ft"></span><span class="fp"></span><span class="tag"></span><span class="fm"></span><span class="fr"></span>';
          box._rows.set(key, el);
        }
        el.querySelector(".ft").textContent = r.hm;
        el.querySelector(".fp").textContent = r.p;
        el.querySelector(".tag").textContent = r.ty === "ping" ? "пинг" : "просмотр";
        el.querySelector(".fm").textContent = [r.b, r.o, r.d].filter(Boolean).join(" · ");
        el.querySelector(".fr").textContent = r.r || "";
        frag.appendChild(el);
      });
      box._rows.forEach(function (el, key) {
        if (!seen.has(key)) { el.remove(); box._rows.delete(key); }
      });
      box.appendChild(frag);
    }

    function render(d) {
      tween($("#v-live"), d.live);
      tween($("#v-vt"), d.kpi.vt);
      tween($("#v-ut"), d.kpi.ut);
      tween($("#v-v7"), d.kpi.v7);
      tween($("#v-tot"), d.kpi.tot);
      delta(d.kpi.vt, d.kpi.vy, $("#d-vt"));
      $("#d-nt").textContent = d.kpi.nt ? "+" + fmt(d.kpi.nt) + " новых" : "";
      $("#d-u7").textContent = fmt(d.kpi.u7) + " посетителей";
      $("#live-n").textContent = d.live;
      $("#live-ev").textContent = d.live_events ? d.live_events + " событий за 5 минут" : "нет активности за 5 минут";
      document.title = "Аналитика MXW01" + (d.live ? " · " + d.live + " онлайн" : "");
      bars($("#ch-hours"), d.hourly, { base: 16, labels: d.hourly.map(function (_, i) { return i % 3 === 0 ? String(i) : ""; }), tip: function (i, v) { return i + ":00 — " + v; } });
      bars($("#ch-spark"), d.spark, { h: 56, cls: "b2", tip: function (i, v) { return (29 - i) + " мин назад — " + v; } });
      daily($("#ch-days"), d.daily);
      top($("#t-pages"), d.tops.pages);
      top($("#t-refs"), d.tops.refs);
      top($("#t-br"), d.tops.browsers);
      top($("#t-os"), d.tops.os);
      top($("#t-dv"), d.tops.devices);
      top($("#t-langs"), d.tops.langs);
      top($("#t-scr"), d.tops.screens);
      feed(d.feed);
      $("#upd").textContent = "обновлено " + new Date().toLocaleTimeString("ru-RU");
    }

    var busy = false;
    function poll() {
      if (document.hidden || busy) return;
      busy = true;
      fetch("./?api=stats", { cache: "no-store" })
        .then(function (r) {
          if (r.status === 403) { location.reload(); throw new Error("auth"); }
          if (!r.ok) throw new Error("bad");
          return r.json();
        })
        .then(render)
        .catch(function () {})
        .finally(function () { busy = false; });
    }
    setInterval(poll, 5000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
    poll();

    /* индикатор силы пароля (все .pw на странице) */
    document.querySelectorAll(".pw").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var v = inp.value, s = 0;
        if (v.length >= 8) s++;
        if (v.length >= 12) s++;
        if (/[а-яa-z]/.test(v) && /[А-ЯA-Z]/.test(v)) s++;
        if (/\d/.test(v)) s++;
        if (/[^\wа-я]/.test(v)) s++;
        var meter = inp.parentElement.querySelector(".meter i");
        if (!meter) return;
        meter.style.width = (s * 20) + "%";
        meter.style.background = s <= 2 ? "var(--err)" : s === 3 ? "var(--amber)" : "var(--ok)";
      });
    });
  })();
  </script>
<?php endif; ?>
</div>
</body>
</html>
