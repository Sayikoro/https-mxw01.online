<?php
/**
 * ============================================================================
 *  АДМИН-ПАНЕЛЬ ОБНОВЛЕНИЙ САЙТА ПЕЧАТИ MXW01 (/update).          PHP 7.4+
 * ============================================================================
 *  Живёт в папке /update сайта (кладётся туда деплой-китом). Позволяет
 *  обновлять статический сайт на обычном PHP-хостинге без FTP/SSH:
 *
 *   1. Первый визит — создаёте пароль (хранится хешем в update/data/config.php);
 *   2. Вход по паролю (сессия + CSRF-токен);
 *   3. Загружаете mxw01-deploy-kit.zip новой версии — панель показывает
 *      версию из архива (version.json) и число файлов;
 *   4. «Установить» — панель делает резервную копию текущего сайта
 *      (update/data/backups/, хранятся последние 3), затем распаковывает
 *      кит в корень сайта. Папка update/ НЕ перезаписывается — обновитель
 *      переживает любые обновления (галочка «обновить также панель»);
 *   5. Резервные копии можно восстановить или удалить прямо из панели;
 *   6. Обновление с GitHub (v1.0.57): панель спрашивает releases/latest
 *      у репозитория, качает zip-кит релиза и ставит его тем же путём
 *      (проверка → резервная копия → установка). Для приватного репозитория
 *      сохраняется токен (update/data/git.php, папка закрыта .htaccess);
 *      публичному репозиторию токен не нужен.
 *
 *  Безопасность:
 *   - пароль только хешем (password_hash/verify), брендфорс замедлен (sleep 1с);
 *   - все действия — POST + CSRF-токен;
 *   - пути из zip проверяются на выход за корень сайта (zip-атом);
 *   - update/data/ закрыта .htaccess (Apache); для nginx добавьте
 *     location ^~ /update/data/ { deny all; } — см. README-УСТАНОВКА.md.
 * ============================================================================
 */
declare(strict_types=1);
error_reporting(E_ALL & ~E_DEPRECATED);

session_name('mxw01upd');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'lifetime' => 0]);
session_start();

define('ROOT', rtrim(str_replace('\\', '/', dirname(__DIR__)), '/')); /* - корень сайта: папка, в которой лежит update/ - */
define('DATA', __DIR__ . '/data');
define('BACKUPS', DATA . '/backups');
define('MAX_BACKUPS', 3);
define('CONFIG', DATA . '/config.php');
define('GITCONF', DATA . '/git.php');
/* База GitHub API; переопределяется только в тестах (MXW01_GH_API). */
define('GH_API', rtrim((string)(getenv('MXW01_GH_API') ?: 'https://api.github.com'), '/'));
/* - преднастроенный репозиторий обновлений: настройки панели (update/data/git.php)
   имеют приоритет, но Git-кнопка работает и без ручной настройки - */
define('DEFAULT_REPO', 'Sayikoro/https-mxw01.online');
/* - версия самой панели (показывается внизу страницы, чтобы отличать старую панель от новой) - */
define('PANEL_VERSION', '1.0.63');

/* ------------------------------ помощники ------------------------------ */

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

function human_size(int $b): string {
    if ($b >= 1048576) return sprintf('%.1f МБ', $b / 1048576);
    if ($b >= 1024) return sprintf('%.0f КБ', $b / 1024);
    return $b . ' Б';
}

function ensure_data_dirs(): void {
    if (!is_dir(DATA)) mkdir(DATA, 0755, true);
    if (!is_dir(BACKUPS)) mkdir(BACKUPS, 0755, true);
    /* - .htaccess закрывает данные панели (пароль, бэкапы) от прямых ссылок на Apache;
         на nginx — см. README-УСТАНОВКА.md - */
    $ht = DATA . '/.htaccess';
    if (!file_exists($ht)) {
        @file_put_contents($ht, "Require all denied\nDeny from all\n");
    }
}

function csrf_token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

function csrf_ok(?string $t): bool {
    return is_string($t) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $t);
}

function is_authed(): bool { return !empty($_SESSION['mxw01_upd_auth']); }

function flash(string $type, string $msg): void { $_SESSION['flash'] = ['type' => $type, 'msg' => $msg]; }

function flash_take(): ?array {
    if (empty($_SESSION['flash'])) return null;
    $f = $_SESSION['flash'];
    unset($_SESSION['flash']);
    return $f;
}

function redirect(string $to = './'): void { header('Location: ' . $to); exit; }

/** Версия установленного сайта из version.json в корне (пусто — не найден) */
function current_version(): string {
    $f = ROOT . '/version.json';
    if (!file_exists($f)) return '';
    $j = json_decode((string)file_get_contents($f), true);
    return is_array($j) && isset($j['version']) ? (string)$j['version'] : '';
}

/**
 * Безопасная распаковка zip в корень сайта.
 * - пропускает: папки, macOS-мусор, dot-файлы и саму папку update/ (обновитель не трогаем);
 * - проверяет, что каждый целевой путь остаётся внутри ROOT (анти zip-атом);
 * возвращает число записанных файлов; $log — пояснения пропусков.
 */
function safe_extract(string $zipPath, array &$log, bool $allowUpdater = false): int {
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) throw new RuntimeException('Не удалось открыть zip-архив');
    $rootReal = realpath(ROOT);
    if ($rootReal === false) throw new RuntimeException('Корень сайта недоступен');
    $count = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name === false || $name === '') continue;
        $name = str_replace('\\', '/', $name);
        if (substr($name, -1) === '/') continue;
        if (strpos($name, '__MACOSX/') === 0 || strpos($name, '.DS_Store') !== false) continue;
        if ($name === 'update' || strpos($name, 'update/') === 0) {
            if ($allowUpdater && $name === 'update/index.php') {
                /* - разрешено галочкой «обновить также панель» - */
            } else {
                $log[] = 'пропущено (обновитель): ' . $name;
                continue;
            }
        }
        $base = basename($name);
        if ($base === '' || $base[0] === '.') continue;
        $dest = $rootReal . '/' . $name;
        $destDir = dirname($dest);
        if (!is_dir($destDir) && !mkdir($destDir, 0755, true) && !is_dir($destDir)) {
            $zip->close();
            throw new RuntimeException('Не удалось создать папку: ' . $destDir);
        }
        $dirReal = realpath($destDir);
        if ($dirReal === false || strpos($dirReal . '/', $rootReal . '/') !== 0) {
            $zip->close();
            throw new RuntimeException('Путь из архива вне корня сайта: ' . $name);
        }
        $in = $zip->getStream($name);
        if (!$in) { $zip->close(); throw new RuntimeException('Чтение из архива не удалось: ' . $name); }
        $out = @fopen($dest, 'wb');
        if (!$out) { fclose($in); $zip->close(); throw new RuntimeException('Запись не удалась: ' . $dest); }
        while (!feof($in)) fwrite($out, (string)fread($in, 65536));
        fclose($in);
        fclose($out);
        $count++;
    }
    $zip->close();
    return $count;
}

/** Резервная копия текущего сайта (без update/; с $withUpdater — и update/index.php) в update/data/backups; возвращает имя файла */
function make_backup(string $curVer, bool $withUpdater = false): string {
    if (!is_dir(BACKUPS)) mkdir(BACKUPS, 0755, true);
    $safe = $curVer !== '' ? preg_replace('/[^A-Za-z0-9.\-]/', '', $curVer) : '';
    $name = 'backup-' . ($safe !== '' ? $safe : 'unknown') . '-' . date('Ymd-His') . '.zip';
    $path = BACKUPS . '/' . $name;
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('Не удалось создать резервную копию');
    }
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(ROOT, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $f) {
        $rel = ltrim(str_replace('\\', '/', substr((string)$f->getPathname(), strlen(ROOT))), '/');
        if ($rel === 'update' || strpos($rel, 'update/') === 0) continue;
        $zip->addFile($f->getPathname(), $rel);
    }
    if ($withUpdater && file_exists(ROOT . '/update/index.php')) {
        /* - старая панель попадает в копию — откат работает и для неё - */
        $zip->addFile(ROOT . '/update/index.php', 'update/index.php');
    }
    $zip->close();
    /* - ретеншн: храним только последние MAX_BACKUPS копий - */
    $all = glob(BACKUPS . '/backup-*.zip') ?: [];
    sort($all);
    while (count($all) > MAX_BACKUPS) @unlink(array_shift($all));
    return $name;
}

/** Метаданные кита: версия (version.json в корне архива) и число файлов */
function kit_meta(string $zipPath): array {
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) throw new RuntimeException('Это не zip-архив');
    $ver = '';
    $count = 0;
    $idx = $zip->locateName('version.json', ZipArchive::FL_NODIR);
    if ($idx !== false) {
        $j = json_decode((string)$zip->getFromIndex($idx), true);
        if (is_array($j) && isset($j['version'])) $ver = (string)$j['version'];
    }
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $n = (string)$zip->getNameIndex($i);
        if (substr($n, -1) === '/' || strpos($n, '__MACOSX/') === 0) continue;
        if (basename($n) !== '' && basename($n)[0] === '.') continue;
        $count++;
    }
    $zip->close();
    return ['version' => $ver, 'files' => $count];
}

function upload_error_text(int $code): string {
    switch ($code) {
        case UPLOAD_ERR_INI_SIZE: return 'файл больше upload_max_filesize хостинга';
        case UPLOAD_ERR_FORM_SIZE: return 'файл больше лимита формы';
        case UPLOAD_ERR_PARTIAL: return 'файл загрузился частично';
        case UPLOAD_ERR_NO_FILE: return 'файл не выбран';
        default: return 'ошибка загрузки №' . $code;
    }
}

/* ------------------------ GitHub-обновления (v1.0.57) ------------------------ */

/** Настройки Git-обновлений: репозиторий owner/repo и (опционально) токен приватного репо */
function load_git_conf(): array {
    if (!file_exists(GITCONF)) return ['repo' => '', 'token' => ''];
    $c = @include GITCONF;
    if (!is_array($c)) return ['repo' => '', 'token' => ''];
    return ['repo' => (string)($c['repo'] ?? ''), 'token' => (string)($c['token'] ?? '')];
}

function save_git_conf(array $c): bool {
    $php = "<?php\n/* - настройки GitHub-обновлений панели /update (создано автоматически) - */\nreturn " . var_export($c, true) . ";\n";
    return file_put_contents(GITCONF, $php, LOCK_EX) !== false;
}

/** Активный репозиторий: сохранённый в настройках или преднастроенный */
function active_repo(array $conf): string {
    return $conf['repo'] !== '' ? $conf['repo'] : DEFAULT_REPO;
}

/**
 * HTTP GET для api.github.com: cURL, а без него — file_get_contents.
 * Возвращает [тело, код ответа]; при недоступности транспорта — RuntimeException.
 */
function gh_http(string $url, ?string $token, string $accept, int $timeout = 300): array {
    $headers = ['User-Agent: MXW01-updater/1.0', 'Accept: ' . $accept];
    if ($token !== null && $token !== '') $headers[] = 'Authorization: Bearer ' . $token;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => $timeout,
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) throw new RuntimeException('Сеть недоступна: ' . $err);
        return [(string)$body, $code];
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(['http' => [
            'method' => 'GET', 'header' => implode("\r\n", $headers),
            'timeout' => $timeout, 'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) throw new RuntimeException('Сеть недоступна (allow_url_fopen)');
        $code = 0;
        foreach (($http_response_header ?? []) as $hl) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string)$hl, $m)) $code = (int)$m[1];
        }
        return [$body, $code];
    }
    throw new RuntimeException('На хостинге нет cURL и выключен allow_url_fopen — внешние запросы недоступны');
}

/** GET JSON от GitHub API с понятными сообщениями об ошибках */
function gh_json(string $path, ?string $token): array {
    [$body, $code] = gh_http(GH_API . $path, $token, 'application/vnd.github+json', 60);
    if ($code === 404) throw new RuntimeException('GitHub: не найдено (404) — проверьте owner/repo; для приватного репозитория сохраните токен');
    if ($code === 401) throw new RuntimeException('GitHub: токен отклонён (401) — проверьте сохранённый токен');
    if ($code === 403 || $code === 429) throw new RuntimeException('GitHub: лимит запросов (' . $code . ') — повторите позже или сохраните токен');
    if ($code !== 200) throw new RuntimeException('GitHub вернул код ' . $code);
    $j = json_decode($body, true);
    if (!is_array($j)) throw new RuntimeException('GitHub вернул неожиданный ответ');
    return $j;
}

/** Скачивание zip-кита релиза (asset, Accept: octet-stream) в файл */
function gh_download(string $url, ?string $token, string $dest): void {
    if (function_exists('curl_init')) {
        $headers = ['User-Agent: MXW01-updater/1.0', 'Accept: application/octet-stream'];
        if ($token !== null && $token !== '') $headers[] = 'Authorization: Bearer ' . $token;
        $fh = fopen($dest, 'wb');
        if (!$fh) throw new RuntimeException('Не удалось создать файл для скачивания');
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_FILE => $fh,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 600,
        ]);
        $ok = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        fclose($fh);
        if ($ok === false || $code >= 400) {
            @unlink($dest);
            throw new RuntimeException('Скачивание не удалось (код ' . $code . ')');
        }
        return;
    }
    [$body, $code] = gh_http($url, $token, 'application/octet-stream', 600);
    if ($code >= 400 || $body === '') throw new RuntimeException('Скачивание не удалось (код ' . $code . ')');
    if (file_put_contents($dest, $body) === false) throw new RuntimeException('Не удалось сохранить скачанный архив');
}

/** Выбор кита среди ассетов релиза: *deploy-kit*.zip, иначе первый .zip */
function pick_kit_asset(array $release): ?array {
    $zips = [];
    foreach (($release['assets'] ?? []) as $a) {
        if (!is_array($a) || empty($a['name']) || empty($a['url'])) continue;
        if (!preg_match('/\.zip$/i', (string)$a['name'])) continue;
        $zips[] = $a;
    }
    foreach ($zips as $a) {
        if (stripos((string)$a['name'], 'deploy-kit') !== false) return $a;
    }
    return $zips[0] ?? null;
}

/* --------------------------- обработка действий --------------------------- */

ensure_data_dirs();
$hasZip = class_exists('ZipArchive');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !empty($_POST) && !csrf_ok($_POST['csrf'] ?? null)) {
    flash('err', 'Сессия устарела (CSRF) — обновите страницу и попробуйте снова');
    redirect('./');
}

/* - пост без полей = превышен post_max_size хостинга - */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && empty($_POST) && empty($_FILES)) {
    flash('err', 'Запрос слишком большой — увеличьте post_max_size на хостинге или загружайте меньший файл');
    redirect('./');
}

/* - JSON API авто-проверки релиза (?api=release): только для вошедших;
   JS панели дёргает его при открытии и показывает кнопку «Обновить до v…» - */
if (isset($_GET['api']) && $_GET['api'] === 'release') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if (!is_authed()) {
        http_response_code(403);
        echo json_encode(['error' => 'требуется вход в панель']);
        exit;
    }
    if (!(function_exists('curl_init') || (bool)ini_get('allow_url_fopen'))) {
        http_response_code(503);
        echo json_encode(['error' => 'на хостинге нет cURL и allow_url_fopen выключен']);
        exit;
    }
    try {
        $conf = load_git_conf();
        $repo = active_repo($conf);
        $cached = $_SESSION['gitapi'] ?? null;
        /* - кеш на 5 минут, чтобы не долбить api.github.com при каждом открытии;
           ?refresh=1 игнорирует кеш - */
        $fresh = !isset($_GET['refresh']) && is_array($cached)
            && (time() - (int)($cached['t'] ?? 0)) < 300;
        if (!$fresh) {
            $rel = gh_json('/repos/' . $repo . '/releases/latest', $conf['token'] !== '' ? $conf['token'] : null);
            $ver = ltrim((string)($rel['tag_name'] ?? ''), "vV \t\n\r\0\x0B");
            $asset = pick_kit_asset($rel);
            $cached = ['t' => time(), 'd' => [
                'ok' => ($ver !== '' && $asset !== null),
                'version' => $ver,
                'name' => (string)($asset['name'] ?? ''),
                'size' => (int)($asset['size'] ?? 0),
                'date' => substr((string)($rel['published_at'] ?? ''), 0, 10),
            ]];
            $_SESSION['gitapi'] = $cached;
        }
        $d = $cached['d'];
        $d['repo'] = $repo;
        $d['current'] = current_version();
        $d['available'] = $d['ok'] && $d['current'] !== '' && version_compare($d['version'], $d['current'], '>');
        echo json_encode($d);
    } catch (Throwable $ex) {
        http_response_code(502);
        echo json_encode(['error' => $ex->getMessage()]);
    }
    exit;
}

$cfgExists = file_exists(CONFIG);

/* - первый запуск: ещё нет пароля — принимаем форму создания - */
if (!$cfgExists && $hasZip && ($_POST['action'] ?? '') === 'setup') {
    $p1 = (string)($_POST['password'] ?? '');
    $p2 = (string)($_POST['password2'] ?? '');
    if (strlen($p1) < 6) {
        flash('err', 'Пароль должен быть не короче 6 символов');
    } elseif ($p1 !== $p2) {
        flash('err', 'Пароли не совпадают');
    } else {
        $php = "<?php\n/* - хеш пароля панели /update (сгенерирован автоматически) - */\nreturn " . var_export(['hash' => password_hash($p1, PASSWORD_DEFAULT)], true) . ";\n";
        if (file_put_contents(CONFIG, $php, LOCK_EX) === false) {
            flash('err', 'Не удалось записать ' . h(basename(CONFIG)) . ' — проверьте права на папку update/');
        } else {
            @chmod(CONFIG, 0644);
            flash('ok', 'Пароль создан — войдите');
        }
    }
    redirect('./');
}

if ($cfgExists && ($_POST['action'] ?? '') === 'login') {
    $cfg = @include CONFIG;
    if (!is_array($cfg) || empty($cfg['hash'])) {
        /* - битый конфиг: разрешаем пересоздать пароль - */
        @unlink(CONFIG);
        flash('err', 'Файл пароля повреждён — задайте пароль заново');
    } elseif (password_verify((string)($_POST['password'] ?? ''), (string)$cfg['hash'])) {
        session_regenerate_id(true);
        $_SESSION['mxw01_upd_auth'] = true;
        unset($_SESSION['fails']);
        redirect('./');
    } else {
        sleep(1); /* - замедляем перебор пароля - */
        $_SESSION['fails'] = (int)($_SESSION['fails'] ?? 0) + 1;
        flash('err', 'Неверный пароль (неудачных попыток: ' . $_SESSION['fails'] . ')');
    }
    redirect('./');
}

if (is_authed() && ($_POST['action'] ?? '') === 'logout') {
    unset($_SESSION['mxw01_upd_auth']);
    redirect('./');
}

/* - всё, что ниже, требует входа и рабочего ZipArchive - */
if (is_authed() && $hasZip) {
    @set_time_limit(300); /* - скачивание и распаковка кита на медленном хостинге - */
    try {
        switch ($_POST['action'] ?? '') {
            case 'upload': {
                $e = $_FILES['zip'] ?? null;
                if (!is_array($e) || ($e['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                    throw new RuntimeException(upload_error_text((int)($e['error'] ?? UPLOAD_ERR_NO_FILE)));
                }
                if (filesize($e['tmp_name']) < 100) throw new RuntimeException('Файл слишком мал — это не деплой-кит');
                $meta = kit_meta($e['tmp_name']); /* - валидация: это наш zip с version.json - */
                if ($meta['version'] === '') throw new RuntimeException('В архиве нет version.json — это не деплой-кит сайта');
                $name = 'upload-' . bin2hex(random_bytes(6)) . '.zip';
                if (!move_uploaded_file($e['tmp_name'], DATA . '/' . $name)) {
                    throw new RuntimeException('Не удалось сохранить загруженный файл');
                }
                $_SESSION['upload'] = [
                    'file' => $name,
                    'version' => $meta['version'],
                    'files' => $meta['files'],
                    'size' => (int)filesize(DATA . '/' . $name),
                ];
                flash('ok', 'Архив загружен — проверьте данные и подтвердите установку');
                redirect('./');
            }
            case 'cancel': {
                if (!empty($_SESSION['upload']['file'])) @unlink(DATA . '/' . $_SESSION['upload']['file']);
                unset($_SESSION['upload']);
                flash('ok', 'Загрузка отменена');
                redirect('./');
            }
            case 'install': {
                if (empty($_SESSION['upload']['file'])) throw new RuntimeException('Сначала загрузите архив');
                $zipPath = DATA . '/' . basename((string)$_SESSION['upload']['file']);
                if (!file_exists($zipPath)) { unset($_SESSION['upload']); throw new RuntimeException('Загруженный архив не найден — загрузите снова'); }
                $curVer = current_version();
                $withUpd = !empty($_POST['with_upd']);
                $log = [];
                $backup = make_backup($curVer, $withUpd);
                $count = safe_extract($zipPath, $log, $withUpd);
                @unlink($zipPath);
                unset($_SESSION['upload'], $_SESSION['gitrel']);
                $newVer = current_version();
                flash('ok', 'Установлено: файлов ' . $count . '. Версия: ' . ($curVer !== '' ? $curVer : '—') . ' → ' . ($newVer !== '' ? $newVer : '—') . '. Резервная копия: ' . $backup);
                redirect('./');
            }
            case 'restore': {
                $name = basename((string)($_POST['name'] ?? ''));
                if (!preg_match('/^backup-[A-Za-z0-9.\-]+\.zip$/', $name) || !file_exists(BACKUPS . '/' . $name)) {
                    throw new RuntimeException('Резервная копия не найдена');
                }
                $log = [];
                $count = safe_extract(BACKUPS . '/' . $name, $log, true); /* в копии может быть и update/index.php */
                flash('ok', 'Восстановлено из ' . $name . ': файлов ' . $count . '. Текущая версия: ' . (current_version() ?: '—'));
                redirect('./');
            }
            case 'delbackup': {
                $name = basename((string)($_POST['name'] ?? ''));
                if (preg_match('/^backup-[A-Za-z0-9.\-]+\.zip$/', $name) && file_exists(BACKUPS . '/' . $name)) {
                    @unlink(BACKUPS . '/' . $name);
                    flash('ok', 'Копия удалена: ' . $name);
                }
                redirect('./');
            }
            case 'git_save': {
                $repo = trim((string)($_POST['gh_repo'] ?? ''));
                if ($repo !== '' && !preg_match('#^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$#', $repo)) {
                    throw new RuntimeException('Имя репозитория ожидается в виде owner/repo');
                }
                $cur = load_git_conf();
                $token = trim((string)($_POST['gh_token'] ?? ''));
                if ($token === '' && !empty($cur['token']) && empty($_POST['gh_token_clear'])) {
                    $token = (string)$cur['token']; /* пустое поле = оставить прежний токен */
                }
                if (!empty($_POST['gh_token_clear'])) $token = '';
                save_git_conf(['repo' => $repo, 'token' => $token]);
                unset($_SESSION['gitrel']);
                flash('ok', 'Настройки GitHub сохранены' . ($repo !== '' ? ': ' . $repo : ' (репозиторий очищен)'));
                redirect('./');
            }
            case 'git_check': {
                $conf = load_git_conf();
                $repo = active_repo($conf); /* - без настроек используется преднастроенный репозиторий - */
                if (!preg_match('#^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$#', $repo)) {
                    throw new RuntimeException('Имя репозитория ожидается в виде owner/repo');
                }
                $rel = gh_json('/repos/' . $repo . '/releases/latest', $conf['token'] !== '' ? $conf['token'] : null);
                $tag = (string)($rel['tag_name'] ?? '');
                $ver = ltrim($tag, "vV \t\n\r\0\x0B");
                $asset = pick_kit_asset($rel);
                if ($ver === '' || $asset === null) {
                    throw new RuntimeException('В последнем релизе нет zip-кита — соберите релиз с mxw01-deploy-kit.zip');
                }
                $_SESSION['gitrel'] = [
                    'repo' => $repo,
                    'tag' => $tag,
                    'version' => $ver,
                    'name' => (string)$asset['name'],
                    'size' => (int)($asset['size'] ?? 0),
                    'date' => substr((string)($rel['published_at'] ?? ''), 0, 10),
                    'url' => (string)$asset['url'],
                ];
                $curVer = current_version();
                if ($curVer !== '' && version_compare($ver, $curVer, '>')) {
                    flash('ok', 'Доступна новая версия ' . $ver . ' (установлена ' . $curVer . ') — скачайте и установите');
                } elseif ($curVer !== '' && version_compare($ver, $curVer, '=')) {
                    flash('ok', 'На GitHub последняя версия совпадает с установленной (' . $curVer . ')');
                } else {
                    flash('ok', 'На GitHub ' . $ver . ', установленная ' . ($curVer !== '' ? $curVer : '—') . ' — кит можно скачать, но это откат');
                }
                redirect('./');
            }
            case 'git_fetch': {
                $rel = $_SESSION['gitrel'] ?? null;
                if (!is_array($rel) || empty($rel['url'])) throw new RuntimeException('Сначала проверьте релиз — кнопка «Проверить релизы»');
                $conf = load_git_conf();
                $dest = DATA . '/gh-' . bin2hex(random_bytes(6)) . '.zip';
                gh_download((string)$rel['url'], $conf['token'] !== '' ? $conf['token'] : null, $dest);
                try {
                    $meta = kit_meta($dest);
                    if ($meta['version'] === '') throw new RuntimeException('в архиве нет version.json');
                } catch (Throwable $ex) {
                    @unlink($dest);
                    throw new RuntimeException('Скачанное — не деплой-кит: ' . $ex->getMessage());
                }
                $_SESSION['upload'] = [
                    'file' => basename($dest),
                    'version' => $meta['version'],
                    'files' => $meta['files'],
                    'size' => (int)filesize($dest),
                ];
                flash('ok', 'Кит ' . $meta['version'] . ' скачан с GitHub (' . $rel['repo'] . ') — проверьте данные и подтвердите установку');
                redirect('./');
            }
            case 'git_install': {
                /* - ОДНА кнопка: проверка релиза → скачивание кита → резервная копия →
                   установка. Git-кит — это наш собственный релиз, поэтому он
                   обновляет и саму панель /update (старая уходит в резервную копию). - */
                $conf = load_git_conf();
                $repo = active_repo($conf);
                $rel = gh_json('/repos/' . $repo . '/releases/latest', $conf['token'] !== '' ? $conf['token'] : null);
                $ver = ltrim((string)($rel['tag_name'] ?? ''), "vV \t\n\r\0\x0B");
                $asset = pick_kit_asset($rel);
                if ($ver === '' || $asset === null) {
                    throw new RuntimeException('В последнем релизе нет zip-кита — соберите релиз с mxw01-deploy-kit.zip');
                }
                $dest = DATA . '/gh-' . bin2hex(random_bytes(6)) . '.zip';
                gh_download((string)$asset['url'], $conf['token'] !== '' ? $conf['token'] : null, $dest);
                try {
                    $meta = kit_meta($dest);
                    if ($meta['version'] === '') throw new RuntimeException('в архиве нет version.json');
                } catch (Throwable $ex) {
                    @unlink($dest);
                    throw new RuntimeException('Скачанное — не деплой-кит: ' . $ex->getMessage());
                }
                $curVer = current_version();
                $log = [];
                $backup = make_backup($curVer, true);
                $count = safe_extract($dest, $log, true);
                @unlink($dest);
                unset($_SESSION['upload'], $_SESSION['gitrel'], $_SESSION['gitapi']);
                $newVer = current_version();
                flash('ok', 'Обновлено с GitHub (' . $repo . '): файлов ' . $count
                    . '. Версия: ' . ($curVer !== '' ? $curVer : '—') . ' → ' . ($newVer !== '' ? $newVer : '—')
                    . '. Резервная копия: ' . $backup
                    . (count($log) > 0 ? '. Пропущено: ' . count($log) : ''));
                redirect('./');
            }
        }
    } catch (Throwable $ex) {
        flash('err', $ex->getMessage());
        redirect('./');
    }
}

/* ------------------------------- страница ------------------------------- */
$flash = flash_take();
$curVer = current_version();
$upload = $_SESSION['upload'] ?? null;
$backups = is_dir(BACKUPS) ? array_reverse(glob(BACKUPS . '/backup-*.zip') ?: []) : [];
$limits = [ini_get('upload_max_filesize') ?: '?', ini_get('post_max_size') ?: '?'];
$gitConf = load_git_conf();
$gitRel = is_array($_SESSION['gitrel'] ?? null) ? $_SESSION['gitrel'] : null;
$ghTransportOk = function_exists('curl_init') || (bool)ini_get('allow_url_fopen');
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Обновление сайта MXW01</title>
<style>
  :root { --ink:#0f172a; --mut:#64748b; --line:#e2e8f0; --ok:#059669; --err:#dc2626; --amber:#b45309; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #f8fafc; margin: 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 16px 48px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  h1 { font-size: 18px; margin: 0; }
  .badge { display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .card h2 { font-size: 14px; margin: 0 0 10px; }
  .muted { color: var(--mut); font-size: 12px; }
  .flash { border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 13px; }
  .flash.ok { background: #ecfdf5; color: var(--ok); border: 1px solid #a7f3d0; }
  .flash.err { background: #fef2f2; color: var(--err); border: 1px solid #fecaca; }
  input[type=password], input[type=text] { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; margin-bottom: 8px; }
  button, .btn { background: #0f172a; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
  button.ghost, .btn.ghost { background: #f1f5f9; color: var(--ink); border: 1px solid var(--line); }
  button.danger { background: #fef2f2; color: var(--err); border: 1px solid #fecaca; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { padding: 6px 4px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
  td.act { white-space: nowrap; }
  code { background: #f1f5f9; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  .warn { background: #fffbeb; border: 1px solid #fde68a; color: var(--amber); border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-top: 8px; }
  ul.log { margin: 6px 0 0; padding-left: 18px; color: var(--mut); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Обновление сайта MXW01 <?php if ($curVer !== ''): ?><span class="badge">v<?= h($curVer) ?></span><?php endif; ?></h1>
    <?php if (is_authed()): ?>
    <form method="post" action="./">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <input type="hidden" name="action" value="logout">
      <button class="ghost" type="submit">Выйти</button>
    </form>
    <?php endif; ?>
  </header>

  <?php if ($flash): ?><div class="flash <?= h($flash['type']) ?>"><?= h($flash['msg']) ?></div><?php endif; ?>

  <?php if (!$hasZip): ?>
    <div class="card">
      <h2>Нет расширения zip</h2>
      <p class="muted">Для работы обновителя PHP-расширение <code>zip</code> (ZipArchive) должно быть включено.
      Обратитесь в поддержку хостинга или включите <code>extension=zip</code> в php.ini.</p>
    </div>
  <?php elseif (!$cfgExists): ?>
    <!-- - первый запуск: создаём пароль - -->
    <div class="card">
      <h2>Первый запуск — задайте пароль</h2>
      <p class="muted">Пароль защищает панель обновления. Он сохраняется хешем в <code>update/data/config.php</code>.</p>
      <form method="post" action="./">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <input type="hidden" name="action" value="setup">
        <input type="password" name="password" placeholder="Пароль (минимум 6 символов)" required minlength="6" autofocus>
        <input type="password" name="password2" placeholder="Повторите пароль" required minlength="6">
        <button type="submit">Создать пароль</button>
      </form>
    </div>
  <?php elseif (!is_authed()): ?>
    <!-- - вход - -->
    <div class="card">
      <h2>Вход</h2>
      <form method="post" action="./">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <input type="hidden" name="action" value="login">
        <input type="password" name="password" placeholder="Пароль панели обновлений" required autofocus>
        <button type="submit">Войти</button>
      </form>
      <p class="muted">Забыли пароль? Удалите <code>update/data/config.php</code> по FTP — панель предложит создать новый.</p>
      <p class="muted">Нет карточки «Обновление с GitHub» после входа? Значит, стоит панель из старого кита: сама она не обновится — залейте <code>update/index.php</code> из нового деплой-кита в папку <code>update/</code> по FTP/файловому менеджеру. Версия панели указана внизу страницы.</p>
    </div>
  <?php else: ?>

    <!-- - загруженный кит: подтверждение установки - -->
    <?php if ($upload): ?>
      <div class="card">
        <h2>Загруженный архив — проверьте и установите</h2>
        <table>
          <tr><th>Версия в архиве</th><td><b>v<?= h($upload['version']) ?></b></td></tr>
          <tr><th>Файлов в архиве</th><td><?= (int)$upload['files'] ?></td></tr>
          <tr><th>Размер</th><td><?= h(human_size((int)$upload['size'])) ?></td></tr>
          <tr><th>Текущая версия</th><td><?= $curVer !== '' ? 'v' . h($curVer) : 'неизвестно' ?></td></tr>
        </table>
        <?php if ($curVer !== '' && version_compare($upload['version'], $curVer, '<=')): ?>
          <div class="warn">Версия в архиве не новее установленной — установка возможна, но проверьте, тот ли это кит.</div>
        <?php endif; ?>
        <p class="muted">Перед установкой будет создана резервная копия текущего сайта (последние <?= MAX_BACKUPS ?> хранятся). Папка <code>update/</code> не перезаписывается.</p>
        <div class="row">
          <form method="post" action="./">
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
            <input type="hidden" name="action" value="install">
            <label class="muted" style="display:block;margin-bottom:8px"><input type="checkbox" name="with_upd" value="1"> обновить также панель /update (если кит содержит её новую версию)</label>
            <button type="submit">Установить</button>
          </form>
          <form method="post" action="./">
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
            <input type="hidden" name="action" value="cancel">
            <button class="ghost" type="submit">Отменить</button>
          </form>
        </div>
      </div>
    <?php endif; ?>

    <!-- - загрузка нового кита - -->
    <div class="card">
      <h2>Загрузить деплой-кит</h2>
      <form method="post" action="./" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <input type="hidden" name="action" value="upload">
        <p><input type="file" name="zip" accept=".zip" required></p>
        <button type="submit">Загрузить</button>
      </form>
      <p class="muted">Загружайте <code>mxw01-deploy-kit.zip</code> новой версии. Лимиты хостинга: upload <?= h($limits[0]) ?>, POST <?= h($limits[1]) ?>.</p>
    </div>

    <!-- - обновление с GitHub - -->
    <div class="card">
      <h2>Обновление с GitHub</h2>
      <?php if (!$ghTransportOk): ?>
        <p class="muted">Хостинг не умеет внешние HTTP-запросы (нет cURL, allow_url_fopen выключен) — Git-обновления недоступны, обновляйте кит вручную.</p>
      <?php else: ?>
        <?php if (is_array($gitRel)): ?>
          <table>
            <tr><th>Релиз на GitHub</th><td><b>v<?= h((string)($gitRel['version'] ?? '?')) ?></b> · <?= h((string)($gitRel['name'] ?? '')) ?></td></tr>
            <tr><th>Репозиторий</th><td><code><?= h((string)($gitRel['repo'] ?? '')) ?></code> · от <?= h((string)($gitRel['date'] ?? '?')) ?> · <?= h(human_size((int)($gitRel['size'] ?? 0))) ?></td></tr>
          </table>
          <div class="row" style="margin-top:10px">
            <form method="post" action="./">
              <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
              <input type="hidden" name="action" value="git_install">
              <button type="submit">Обновить до v<?= h((string)($gitRel['version'] ?? '?')) ?></button>
            </form>
            <form method="post" action="./">
              <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
              <input type="hidden" name="action" value="git_fetch">
              <button class="ghost" type="submit">Только скачать кит</button>
            </form>
          </div>
          <p class="muted">Установка в один клик: кит скачается с GitHub, перед установкой будет создана резервная копия, обновится и сама панель.</p>
        <?php else: ?>
          <p class="muted" id="gh-status">Проверяю обновления на GitHub…</p>
          <form method="post" action="./" id="gh-once" style="display:none;margin-top:8px">
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
            <input type="hidden" name="action" value="git_install">
            <button type="submit">Обновить до v<span id="gh-ver">…</span> с GitHub</button>
          </form>
        <?php endif; ?>
        <form method="post" action="./" style="margin-top:8px">
          <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
          <input type="hidden" name="action" value="git_check">
          <p class="muted" style="margin-bottom:6px">Репозиторий: <code><?= h(active_repo($gitConf)) ?></code><?= $gitConf['token'] !== '' ? ' · токен сохранён' : '' ?></p>
          <button class="ghost" type="submit">Проверить релизы</button>
        </form>
        <details style="margin-top:10px">
          <summary class="muted" style="cursor:pointer">Настройки репозитория и токена</summary>
          <form method="post" action="./" style="margin-top:8px">
            <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
            <input type="hidden" name="action" value="git_save">
            <input type="text" name="gh_repo" placeholder="owner/repo (по умолчанию <?= h(DEFAULT_REPO) ?>)" value="<?= h((string)$gitConf['repo']) ?>">
            <input type="password" name="gh_token" autocomplete="off" placeholder="<?= $gitConf['token'] !== '' ? 'Токен сохранён — оставьте пустым, чтобы не менять' : 'Токен (нужен только приватному репозиторию)' ?>">
            <?php if ($gitConf['token'] !== ''): ?>
              <label class="muted" style="display:block;margin-bottom:8px"><input type="checkbox" name="gh_token_clear" value="1"> стереть сохранённый токен</label>
            <?php endif; ?>
            <button type="submit">Сохранить</button>
          </form>
          <p class="muted">Токен хранится в <code>update/data/git.php</code> (папка закрыта .htaccess) и отправляется только на api.github.com. Публичному репозиторию токен не нужен.</p>
        </details>
      <?php endif; ?>
    </div>

    <!-- - резервные копии - -->
    <div class="card">
      <h2>Резервные копии <span class="muted">(хранится <?= MAX_BACKUPS ?>)</span></h2>
      <?php if (!$backups): ?>
        <p class="muted">Пока пусто — копия создаётся автоматически перед каждой установкой.</p>
      <?php else: ?>
        <table>
          <?php foreach ($backups as $b):
              $bn = basename((string)$b); ?>
          <tr>
            <td><code><?= h($bn) ?></code></td>
            <td><?= h(human_size((int)filesize((string)$b))) ?></td>
            <td><?= h(date('d.m.Y H:i', (int)filemtime((string)$b))) ?></td>
            <td class="act">
              <form method="post" action="./" style="display:inline">
                <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
                <input type="hidden" name="action" value="restore">
                <input type="hidden" name="name" value="<?= h($bn) ?>">
                <button class="ghost" type="submit" onclick="return confirm('Восстановить сайт из <?= h($bn) ?>?')">Восстановить</button>
              </form>
              <form method="post" action="./" style="display:inline">
                <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
                <input type="hidden" name="action" value="delbackup">
                <input type="hidden" name="name" value="<?= h($bn) ?>">
                <button class="danger" type="submit" onclick="return confirm('Удалить <?= h($bn) ?>?')">Удалить</button>
              </form>
            </td>
          </tr>
          <?php endforeach; ?>
        </table>
      <?php endif; ?>
    </div>

    <div class="card">
      <h2>Сервисная информация</h2>
      <table>
        <tr><th>PHP</th><td><?= h(PHP_VERSION) ?>, zip <?= $hasZip ? 'есть' : 'нет' ?></td></tr>
        <tr><th>Корень сайта</th><td><code><?= h(ROOT) ?></code></td></tr>
        <tr><th>Версия сайта</th><td><?= $curVer !== '' ? 'v' . h($curVer) : 'version.json не найден (старая поставка)' ?></td></tr>
        <tr><th>GitHub-обновления</th><td><code><?= h(active_repo($gitConf)) ?></code><?= $gitConf['token'] !== '' ? ' · токен сохранён' : ' · публичный репозиторий, токен не нужен' ?> · <?= $ghTransportOk ? 'транспорт есть' : 'нет cURL/allow_url_fopen' ?></td></tr>
        <tr><th>Версия панели</th><td>v<?= h(PANEL_VERSION) ?></td></tr>
        <tr><th>Ссылки</th><td><a href="../">открыть сайт</a> · <a href="../mxw01-offline.html">офлайн-версия</a> · <a href="../admin/">аналитика</a></td></tr>
      </table>
    </div>

  <?php endif; ?>

  <?php if (is_authed() && $hasZip && $ghTransportOk && !is_array($gitRel)): ?>
  <script>
  /* Автопроверка релиза при открытии панели: ?api=release (кеш 5 мин на сервере).
     Если есть новее — показываем кнопку «Обновить до v…» (обычная POST-форма,
     работает и без JS через «Проверить релизы»). */
  (function () {
    var st = document.getElementById('gh-status');
    if (!st) return;
    fetch('?api=release', { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        return r.json().then(function (d) { return { code: r.status, d: d }; });
      })
      .then(function (x) {
        if (x.code !== 200 || !x.d || x.d.error) {
          st.textContent = x.d && x.d.error ? 'GitHub: ' + x.d.error : 'Не удалось проверить обновления на GitHub';
          return;
        }
        var d = x.d;
        if (d.available) {
          st.textContent = 'Доступна новая версия: v' + d.version + ' (установлена v' + d.current + ') — установка в один клик:';
          st.style.color = '#059669';
          var v = document.getElementById('gh-ver'); if (v) v.textContent = d.version;
          var f = document.getElementById('gh-once'); if (f) f.style.display = '';
        } else if (d.ok) {
          st.textContent = 'Установлена последняя версия: v' + d.current + ' (= GitHub)';
        } else {
          st.textContent = 'В последнем релизе GitHub нет zip-кита';
        }
      })
      .catch(function () { st.textContent = 'GitHub недоступен — нажмите «Проверить релизы»'; });
  })();
  </script>
  <?php endif; ?>
  <p class="muted">MXW01 updater v<?= h(PANEL_VERSION) ?> · деплой-кит поставляется с этой панелью · обновитель в <code>update/</code> переживает обновления сайта</p>
</div>
</body>
</html>
