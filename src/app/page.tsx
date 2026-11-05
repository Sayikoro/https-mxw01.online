"use client";
/**
 * Главная страница (референс: «Печать ценников»):
 * баннер поддержки → шапка → slim-вкладки → рабочая область
 * (слева редактор, справа предпросмотр), ниже — футер (копирайт,
 * «О проекте», FAQ).
 * Вкладки: «Лента» (drag & drop-инструменты: текст/разделитель/картинка) —
 * видна всегда; «Ценник» и «Изображение» спрятаны за стрелкой справа от
 * вкладок — по нажатию доп. вкладки «выезжают» (анимация max-w/opacity).
 *
 * Рабочая область на десктопе занимает ровно 100dvh (внутренние скроллы
 * панелей), футер находится сразу под ней — открывается прокруткой страницы.
 */
import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrinterProvider, usePrinter } from "@/lib/printer/printer-context";
import { UsbPrinterProvider } from "@/lib/printer/usb/usb-printer-context";
import { HprtPrinterProvider } from "@/lib/printer/hprt/hprt-printer-context";
import { CatPrinterProvider } from "@/lib/printer/cat/cat-printer-context";
import { I18nProvider, useI18n } from "@/lib/printer/i18n";
import type { Lang, Translator } from "@/lib/printer/i18n";
import { AppHeader } from "@/components/printer/app-header";
import { SupportBanner } from "@/components/printer/support-banner";
import { AppFooter } from "@/components/printer/app-footer";
import { CookieBanner } from "@/components/printer/cookie-banner";
import { InstallPrompt } from "@/components/printer/install-prompt";
import { TapeTab } from "@/components/printer/tape-builder";
import { PricetagTab } from "@/components/printer/pricetag-tab";
import { ImageTab } from "@/components/printer/image-tab";
import { Tag, Image as ImageIcon, Layers, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function PrinterTabs({ t, lang }: { t: Translator; lang: Lang }) {
  const { status } = usePrinter();
  const busy = status === "printing";
  // - «Ценник» и «Изображение» спрятаны за стрелкой; активная скрытая
  //   вкладка остаётся видимой, чтобы контекст работы не пропадал -
  const [tab, setTab] = React.useState("text");
  const [extraOpen, setExtraOpen] = React.useState(false);
  const ptCollapsed = !extraOpen && tab !== "pricetag";
  const imgCollapsed = !extraOpen && tab !== "image";

  const trigger = cn(
    "h-11 flex-1 rounded-none border-b-2 border-transparent bg-transparent px-3 text-sm font-medium text-slate-400 shadow-none transition-colors sm:flex-none sm:px-4",
    "hover:text-slate-700 dark:hover:text-slate-200",
    "data-[state=active]:border-b-slate-900 data-[state=active]:text-slate-900 data-[state=active]:shadow-none",
    "dark:data-[state=active]:border-b-slate-100 dark:data-[state=active]:text-slate-100"
  );

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 flex-col gap-0">
      <div className="shrink-0 border-b border-slate-200 bg-white px-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center">
          <TabsList className="h-11 min-w-0 flex-1 justify-start gap-1 rounded-none bg-transparent p-0 sm:flex-none">
            <TabsTrigger value="text" disabled={busy} aria-label={t("tab.textAria")} className={trigger}>
              <Layers className="h-4 w-4" />
              <span className="hidden sm:inline">{t("tab.text")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="pricetag"
              disabled={busy}
              aria-label={t("tab.pricetagAria")}
              aria-hidden={ptCollapsed || undefined}
              className={cn(
                trigger,
                "overflow-hidden whitespace-nowrap transition-all duration-300 ease-out",
                ptCollapsed ? "max-w-0 px-0 opacity-0 pointer-events-none sm:px-0" : "max-w-[10rem] opacity-100"
              )}
            >
              <Tag className="h-4 w-4" />
              <span className="hidden sm:inline">{t("tab.pricetag")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="image"
              disabled={busy}
              aria-label={t("tab.imageAria")}
              aria-hidden={imgCollapsed || undefined}
              className={cn(
                trigger,
                "overflow-hidden whitespace-nowrap transition-all duration-300 ease-out",
                imgCollapsed ? "max-w-0 px-0 opacity-0 pointer-events-none sm:px-0" : "max-w-[10rem] opacity-100"
              )}
            >
              <ImageIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t("tab.image")}</span>
            </TabsTrigger>
          </TabsList>
          <button
            type="button"
            onClick={() => setExtraOpen((v) => !v)}
            aria-expanded={extraOpen}
            aria-label={t(extraOpen ? "tab.hideExtra" : "tab.showExtra")}
            className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform duration-300", extraOpen && "rotate-180")} />
          </button>
        </div>
      </div>

      <TabsContent value="text" className="mt-0 flex min-h-0 flex-1 flex-col">
        <TapeTab t={t} lang={lang} />
      </TabsContent>
      <TabsContent
        value="pricetag"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-right-2"
      >
        <PricetagTab t={t} lang={lang} />
      </TabsContent>
      <TabsContent
        value="image"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-right-2"
      >
        <ImageTab t={t} lang={lang} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * - Корень приложения: единственное место, где текст берётся из контекста. -
 *  useI18n() вызывается один раз здесь, дальше t (и lang там, где нужны
 *  формы множественного числа и даты) передаётся ВНУЗ ЧЕРЕЗ ПРОПСЫ —
 *  компоненты сами словарь не импортируют.
 */
function AppRoot() {
  const { t, lang, setLang } = useI18n();
  return (
    <PrinterProvider t={t}>
      <UsbPrinterProvider t={t}>
        <HprtPrinterProvider t={t}>
          <CatPrinterProvider t={t}>
            <div className="flex min-h-dvh flex-col bg-white dark:bg-slate-900 md:h-dvh md:overflow-hidden">
              <SupportBanner t={t} />
              <AppHeader t={t} lang={lang} setLang={setLang} />
              <PrinterTabs t={t} lang={lang} />
            </div>
            <AppFooter t={t} />
            <CookieBanner t={t} />
            <InstallPrompt t={t} />
          </CatPrinterProvider>
        </HprtPrinterProvider>
      </UsbPrinterProvider>
    </PrinterProvider>
  );
}

export default function Page() {
  return (
    <I18nProvider>
      <AppRoot />
    </I18nProvider>
  );
}
