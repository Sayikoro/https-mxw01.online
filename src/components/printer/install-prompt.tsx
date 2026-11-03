"use client";
/**
 * Предложение установить приложение (PWA).
 *
 *  • Android / Chrome / Edge: ловим beforeinstallprompt — по кнопке
 *    открывается НАТИВНЫЙ диалог установки браузера (в настройки
 *    переходить не нужно, Android сам показывает системное окно).
 *  • iOS Safari: события beforeinstallprompt не существует, а глубоких
 *    ссылок в Настройки у веб-страниц Apple не разрешает — поэтому
 *    пошаговая последовательная инструкция: Safari → «Поделиться» →
 *    «На экран „Домой“» → «Добавить».
 *  • В установленном виде (display-mode: standalone) не показываемся,
 *    отказ запоминается на 14 дней. ?install=1 — показать принудительно
 *    (для тестов).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, X } from "lucide-react";
import type { Translator } from "@/lib/printer/i18n";

/** Ключ localStorage с датой отказа (прячем предложение на 14 дней) */
const DISMISS_KEY = "mxw01-install-dismissed";
const DISMISS_MS = 14 * 86_400_000;

/** Событие beforeinstallprompt (Chrome) с нативным запросом установки */
interface BipEvent extends Event {
  prompt: () => Promise<void>;
}

/** Уже установлено (запущено как приложение)? */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone / iPad (iPadOS 13+ прикидывается Mac — добавляем тач-проверку) */
function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function InstallPrompt({ t }: { t: Translator }) {
  const [deferred, setDeferred] = useState<BipEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    // Тестовый хук: ?install=1 — предложение принудительно (мимо localStorage)
    const force = new URLSearchParams(window.location.search).get("install") === "1";
    if (isStandalone()) return;

    let dismissedAt = 0;
    try {
      dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY)) || 0;
    } catch {
      /* приватный режим — считаем, что не отклоняли */
    }
    const dismissedFresh = Date.now() - dismissedAt < DISMISS_MS;
    const mayShow = force || !dismissedFresh;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BipEvent);
      if (mayShow) setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setStepsOpen(false);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // iOS: события установки нет — показываем баннер с небольшой паузой
    let timer = 0;
    if (isAppleMobile() && mayShow) {
      timer = window.setTimeout(() => setVisible(true), 2500);
    }
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setStepsOpen(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* приватный режим — просто прячем до перезагрузки */
    }
  }, []);

  const install = useCallback(() => {
    if (deferred && typeof deferred.prompt === "function") {
      // Chrome/Edge: нативный диалог браузера
      void deferred.prompt().finally(() => setVisible(false));
    } else {
      // iOS и браузеры без beforeinstallprompt — пошаговая инструкция
      setStepsOpen(true);
    }
  }, [deferred]);

  if (!visible && !stepsOpen) return null;

  const steps = [
    { title: t("inst.iosStep1"), desc: t("inst.iosStep1Desc") },
    { title: t("inst.iosStep2"), desc: t("inst.iosStep2Desc") },
    { title: t("inst.iosStep3"), desc: t("inst.iosStep3Desc") },
    { title: t("inst.iosStep4"), desc: t("inst.iosStep4Desc") },
  ];

  return (
    <>
      {visible && (
        <div
          role="complementary"
          aria-label={t("inst.bannerTitle")}
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md sm:inset-x-auto sm:left-4"
        >
          <div className="relative flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
              <Download className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("inst.bannerTitle")}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t("inst.bannerDesc")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={install}
                  className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  {t("inst.install")}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="h-8 rounded-lg px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  {t("inst.later")}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("inst.closeAria")}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <Dialog open={stepsOpen} onOpenChange={(open) => { if (!open) dismiss(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inst.iosTitle")}</DialogTitle>
            <DialogDescription>{t("inst.bannerDesc")}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {step.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            {t("inst.iosNote")}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
