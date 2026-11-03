import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/**
 * PWA-манифест (app/manifest.ts → /manifest.webmanifest, Next подключает
 * <link rel="manifest"> автоматически). Статик-экспорт: страница генерируется
 * в HTML-режиме force-static по умолчанию для metadata-роутов.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MXW01 Web Terminal",
    short_name: "MXW01",
    description:
      "Печать этикеток и ценников на термопринтере MXW01 прямо в браузере по Bluetooth",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    lang: "ru",
    icons: [
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
