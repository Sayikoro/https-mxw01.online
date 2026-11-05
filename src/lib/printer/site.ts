/**
 * Основные адреса сайта.
 *
 * SITE_URL — канонический домен (с протоколом, БЕЗ слэша в конце).
 * Задан домен https://mxw01.online: canonical, og:url, sitemap.xml
 * и строка Sitemap в robots.txt подставляются при сборке
 * (bash scripts/build-static-webpack.sh).
 */
export const SITE_URL: string = "https://mxw01.online";

/** Версия приложения — показывается в «Настройках» рядом с историей версий */
export const APP_VERSION = "1.0.61";

/**
 * GitHub-репозиторий проекта для кнопки «Проверить обновления»
 * (формат owner/repo). Кнопка спрашивает публичный API
 * api.github.com/repos/{owner}/{repo}/releases/latest — токен не нужен;
 * приватный репозиторий с сайта не проверяется — обновляйте через /update.
 * Пустая строка — проверка релизов на сайте отключена (панель /update
 * настраивается независимо).
 */
export const GITHUB_REPO = "Sayikoro/https-mxw01.online";

/** Абсолютный URL пути либо "" , если домен ещё не задан */
export function absoluteUrl(path = "/"): string {
  if (!SITE_URL) return "";
  return new URL(path, SITE_URL.endsWith("/") ? SITE_URL : SITE_URL + "/").toString();
}
