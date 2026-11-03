"use client";
/**
 * Баннер согласия на использование cookie (внизу страницы).
 *
 * Данные приложения (шаблоны, язык, настройки) хранятся в localStorage —
 * это НЕ cookie; но веб-аналитика (Яндекс.Метрика, теги GTM) ставит cookie
 * в браузере посетителя, поэтому на сайте показывается баннер согласия.
 *
 * Баннер НЕ показывается:
 *  - в офлайн-версии (file://) — там счётчиков нет вообще;
 *  - в сборках без аналитики (пустые ID счётчиков);
 *  - после нажатия «Хорошо» — согласие запоминается в localStorage
 *    (ключ mxw01-cookie-consent).
 *
 * Только UI-слой: драйвер печати и отправка на печать не затронуты.
 */
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Translator } from "@/lib/printer/i18n";
import { YANDEX_METRIKA_ID, GTM_CONTAINER_ID } from "@/lib/printer/analytics";
import { Cookie } from "lucide-react";

/** localStorage-ключ согласия (не cookie — сам факт согласия) */
const CONSENT_KEY = "mxw01-cookie-consent";

/** Аналитика включена в этой сборке? (в офлайн-сборке ID пустые) */
function analyticsEnabled(): boolean {
  return Boolean(YANDEX_METRIKA_ID.trim() || GTM_CONTAINER_ID.trim());
}

export function CookieBanner({ t }: { t: Translator }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Решение принимается только на клиенте (безопасно для гидратации);
    // показ откладываем в макрозадачу — после первой отрисовки страницы.
    const id = window.setTimeout(() => {
      try {
        if (window.location.protocol === "file:") return;
        if (!analyticsEnabled()) return;
        if (localStorage.getItem(CONSENT_KEY) === "1") return;
        setShow(true);
      } catch {
        /* localStorage недоступен — баннер просто не показываем */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  if (!show) return null;

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* нет доступа к localStorage — скрыть хотя бы до перезагрузки */
    }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label={t("cookie.title")}
      className="fixed inset-x-0 bottom-0 z-40 px-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex flex-1 items-start gap-2.5">
          <Cookie className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {t("cookie.text")}
          </p>
        </div>
        <Button onClick={accept} className="h-9 shrink-0 rounded-lg px-4 text-sm">
          {t("cookie.accept")}
        </Button>
      </div>
    </div>
  );
}
