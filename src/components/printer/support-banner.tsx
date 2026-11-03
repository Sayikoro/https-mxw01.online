"use client";
/**
 * Верхний баннер поддержки проекта.
 * Вся полоса — ссылка на страницу поддержки (открывается в новой вкладке).
 *
 * Только UI-слой: на драйвер и отправку печати не влияет.
 */
import { ExternalLink, Heart } from "lucide-react";
import type { Translator } from "@/lib/printer/i18n";

/** Ссылка на страницу поддержки проекта */
export const SUPPORT_URL = "https://dalink.to/holapsicon";

export function SupportBanner({ t }: { t: Translator }) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("banner.aria")}
      className="group flex shrink-0 items-center justify-center gap-2 border-b border-amber-200/80 bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 px-3 py-1.5 text-xs text-amber-900 transition-colors hover:from-amber-100 hover:via-amber-200 hover:to-amber-100 dark:border-amber-900/50 dark:from-amber-950/40 dark:via-amber-900/25 dark:to-amber-950/40 dark:text-amber-200 dark:hover:from-amber-900/40 dark:hover:via-amber-800/40 dark:hover:to-amber-900/40"
    >
      <Heart
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400"
      />
      <span className="shrink-0 font-semibold">{t("banner.support")}</span>
      <span className="hidden truncate opacity-80 sm:inline">{t("banner.tagline")}</span>
      <ExternalLink
        aria-hidden
        className="h-3 w-3 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5"
      />
    </a>
  );
}
