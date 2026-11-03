/**
 * Идентификаторы систем статистики.
 *
 * Значения по умолчанию — рабочие счётчики проекта; при необходимости
 * можно переопределить их переменными окружения при сборке статики:
 * NEXT_PUBLIC_YM_ID и NEXT_PUBLIC_GTM_ID (зашиваются в HTML на этапе build).
 */
export const YANDEX_METRIKA_ID: string =
  process.env.NEXT_PUBLIC_YM_ID ?? "112475293";

/** Google Tag Manager (контейнер, gtm.js) — через него же идёт Analytics */
export const GTM_CONTAINER_ID: string =
  process.env.NEXT_PUBLIC_GTM_ID ?? "GTM-PK5FZ24G";
