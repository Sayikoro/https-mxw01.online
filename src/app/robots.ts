import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/printer/site";

export const dynamic = "force-static";

/**
 * robots.txt генерируется при сборке (static export → .next-static/robots.txt).
 * Сайт одностраничный: всё открыто для поисковиков, соцпревью и ИИ-краулеров
 * (описание для ИИ — в /llms.txt). Строка Sitemap добавляется автоматически,
 * когда задан SITE_URL (src/lib/printer/site.ts).
 */
export default function robots(): MetadataRoute.Robots {
  const allow = { allow: "/" } as const;
  return {
    rules: [
      { userAgent: "*", ...allow },
      // Поисковые системы
      { userAgent: "Googlebot", ...allow },
      { userAgent: "Bingbot", ...allow },
      { userAgent: "YandexBot", ...allow },
      { userAgent: "DuckDuckBot", ...allow },
      // Соцсети и мессенджеры (превью ссылок)
      { userAgent: "Twitterbot", ...allow },
      { userAgent: "facebookexternalhit", ...allow },
      { userAgent: "WhatsApp", ...allow },
      { userAgent: "TelegramBot", ...allow },
      // ИИ-краулеры: приветствуются (см. /llms.txt)
      { userAgent: "GPTBot", ...allow },
      { userAgent: "OAI-SearchBot", ...allow },
      { userAgent: "ChatGPT-User", ...allow },
      { userAgent: "ClaudeBot", ...allow },
      { userAgent: "anthropic-ai", ...allow },
      { userAgent: "PerplexityBot", ...allow },
      { userAgent: "Google-Extended", ...allow },
      { userAgent: "Applebot", ...allow },
      { userAgent: "CCBot", ...allow },
      { userAgent: "meta-externalagent", ...allow },
    ],
    ...(SITE_URL ? { sitemap: absoluteSitemap() } : {}),
  };
}

function absoluteSitemap(): string {
  return new URL(
    "/sitemap.xml",
    SITE_URL.endsWith("/") ? SITE_URL : SITE_URL + "/"
  ).toString();
}
