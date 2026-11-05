/**
 * Service Worker терминала MXW01 (только прод-сборка; в dev не регистрируется).
 * Стратегия:
 *  • навигации (страницы) — network-first: свежая версия всегда приоритетна,
 *    офлайн — отдаём последний закэшированный HTML;
 *  • статика (/_next/static, иконки, манифест) — stale-while-revalidate:
 *    мгновенно из кэша, обновление в фоне;
 *  • всё остальное (в т.ч. внешние запросы) — без перехвата.
 * Кэш версионирован: при выпуске новой версии меняется CACHE_VERSION,
 * старые кэши удаляются на activate.
 */
const CACHE_VERSION = "mxw01-pwa-v27";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL, "/logo.svg"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Навигации: сеть → кэш (офлайн-режим)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Версионированная статика Next.js и ассеты приложения: кэш → сеть (SWR)
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/logo.svg" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/");

  if (isStatic) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
