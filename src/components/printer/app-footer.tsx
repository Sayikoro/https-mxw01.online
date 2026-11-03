"use client";
/**
 * Нижний колонтитул — три вертикальные секции:
 *  • слева     — «О проекте MXW01 Web Terminal»;
 *  • посередине — «Часто задаваемые вопросы» (нативные <details>, работают
 *                 и в автономной однофайловой версии);
 *  • справа    — название, автор (Сделано Holapsicon) и кнопка доната.
 * На мобильных секции складываются в столбик в том же порядке.
 * Тексты двуязычные (RU/EN) — берутся из i18n-словаря.
 *
 * Только UI-слой: на драйвер и отправку печати не влияет.
 */
import { ChevronDown, ExternalLink, Heart } from "lucide-react";
import { SUPPORT_URL } from "@/components/printer/support-banner";
import type { Translator } from "@/lib/printer/i18n";
import { LogoMark } from "./logo";

/* ------------------------------------------------------------------ */
/* Компонент                                                           */
/* ------------------------------------------------------------------ */

const sectionTitle =
  "mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

function FaqItem({ q, a }: { q: string; a: string }) {
  /* Ответ может быть многоабзацным — абзацы разделены «\n\n» (сейчас так
   * оформлен ответ про Firefox: десктоп и Android). Одноабзацные ответы
   * рендерятся как раньше, без лишних отступов (space-y-2 на одном ребёнке
   * отступа не даёт). */
  const paragraphs = a.split("\n\n");
  return (
    <details className="group rounded-xl border border-slate-200 bg-white transition-colors open:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:open:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold text-slate-900 marker:hidden [&::-webkit-details-marker]:hidden dark:text-slate-100">
        {q}
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-2 border-t border-slate-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </details>
  );
}

export function AppFooter({ t }: { t: Translator }) {

  const faqItems: { q: string; a: string }[] = [
    { q: t("footer.faq1q"), a: t("footer.faq1a") },
    { q: t("footer.faq2q"), a: t("footer.faq2a") },
    { q: t("footer.faq3q"), a: t("footer.faq3a") },
    { q: t("footer.faq4q"), a: t("footer.faq4a") },
    { q: t("footer.faq5q"), a: t("footer.faq5a") },
    { q: t("footer.faq6q"), a: t("footer.faq6a") },
  ];

  return (
    <footer
      className="mt-auto shrink-0 border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Во всю ширину экрана: без max-width, только боковые отступы */}
      <div className="grid w-full gap-8 px-4 py-8 md:grid-cols-3 md:gap-8 md:px-8">
        {/* Слева — о проекте */}
        <section aria-labelledby="footer-about-title">
          <h2 id="footer-about-title" className={sectionTitle}>
            {t("footer.aboutTitle")}
          </h2>
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              {t("footer.about1")}
            </p>
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              {t("footer.about2")}
            </p>
          </div>
        </section>

        {/* Посередине — FAQ */}
        <section aria-labelledby="footer-faq-title">
          <h2 id="footer-faq-title" className={sectionTitle}>
            {t("footer.faqTitle")}
          </h2>
          <div className="space-y-2">
            {faqItems.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        {/* Справа — название, автор и поддержка проекта */}
        <section
          aria-label={t("footer.supportTitle")}
          className="md:justify-self-stretch"
        >
          <h2 className={sectionTitle}>{t("footer.supportTitle")}</h2>
          <div className="flex items-center gap-2.5">
            <LogoMark
              aria-hidden
              className="h-6 w-6 shrink-0"
            />
            <p className="text-[15px] font-bold leading-tight text-slate-900 dark:text-slate-100">
              MXW01 Web Terminal
            </p>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-500">
            {t("footer.subtitle")}
          </p>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {t("footer.madeBy")}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Holapsicon
            </span>
            <Heart
              aria-hidden
              className="h-3 w-3 fill-red-500 text-red-500 dark:fill-red-400 dark:text-red-400"
            />
          </p>
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-semibold text-amber-950 shadow-sm transition-colors hover:bg-amber-300 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
          >
            <Heart aria-hidden className="h-3.5 w-3.5 fill-current" />
            {t("footer.donate")}
            <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
          <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-600">
            © 2026 MXW01 Web Terminal
          </p>
        </section>
      </div>
    </footer>
  );
}
