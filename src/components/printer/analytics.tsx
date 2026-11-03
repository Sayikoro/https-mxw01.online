"use client";
/**
 * Подключение систем статистики: Яндекс.Метрика и Google Tag Manager.
 *
 * • Яндекс.Метрика — официальный сниппет (tag.js с id в URL, ssr:true,
 *   webvisor, clickmap, ecommerce:"dataLayer", accurateTrackBounce,
 *   trackLinks) + noscript-пиксель.
 * • Google Tag Manager — стандартная пара: inline-скрипт gtm.js
 *   (strategy="beforeInteractive" — Next поднимает его в <head> при
 *   рендере) и noscript-iframe, который рендерится первым элементом
 *   <body> (компонент <GtmNoscript />).
 * Оба inline-сниппета — beforeInteractive: они попадают в prerender-HTML
 * (важно для статического экспорта) и стартуют до гидратации.
 *
 * ID — в src/lib/printer/analytics.ts (env NEXT_PUBLIC_YM_ID /
 * NEXT_PUBLIC_GTM_ID имеют приоритет). В автономной однофайловой версии
 * (file://) внешние скрипты не загружаются без сети — это безопасно.
 *
 * Только этот файл знает про аналитику: драйвер печати и редакторы не затронуты.
 */
import Script from "next/script";
import { GTM_CONTAINER_ID, YANDEX_METRIKA_ID } from "@/lib/printer/analytics";

const ymId = YANDEX_METRIKA_ID.trim();
const gtmId = GTM_CONTAINER_ID.trim();

/** noscript-часть GTM: должна стоять сразу после открывающего <body> */
export function GtmNoscript() {
  if (!gtmId) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtmId)}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}

export function Analytics() {
  return (
    <>
      {gtmId && (
        // beforeInteractive в App Router разрешён в root layout (правило
        // no-before-interactive-script-outside-document — legacy Pages Router)
        // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
        <Script
          id="google-tag-manager"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`,
          }}
        />
      )}

      {ymId && (
        <>
          {/* beforeInteractive: сниппет попадает в <head> prerender-HTML
             (рекомендация Яндекса). GTM выше уже создал window.dataLayer —
             ecommerce:"dataLayer" подключится корректно. */}
          {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
          <Script
            id="yandex-metrika"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${encodeURIComponent(ymId)}','ym');ym('${ymId}','init',{ssr:true,webvisor:true,clickmap:true,ecommerce:"dataLayer",referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`,
            }}
          />
          <noscript>
            <div>
              <img
                src={`https://mc.yandex.ru/watch/${encodeURIComponent(ymId)}`}
                alt=""
                style={{ position: "absolute", left: "-9999px" }}
              />
            </div>
          </noscript>
        </>
      )}
    </>
  );
}
