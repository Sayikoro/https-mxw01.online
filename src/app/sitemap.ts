import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/printer/site";

export const dynamic = "force-static";

/**
 * sitemap.xml генерируется при сборке (static export → .next-static/sitemap.xml).
 * Сайт одностраничный — карта состоит из главной. Пока SITE_URL не задан,
 * карта не генерируется (sitemap требует абсолютные адреса).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_URL) return [];
  const base = SITE_URL.endsWith("/") ? SITE_URL : SITE_URL + "/";
  return [
    {
      url: new URL("/", base).toString(),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
