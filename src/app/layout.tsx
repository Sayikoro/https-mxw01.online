import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Analytics, GtmNoscript } from "@/components/printer/analytics";
import { PwaRegister } from "@/components/printer/pwa-register";
import { SelfHit } from "@/components/printer/self-hit";
import { absoluteUrl } from "@/lib/printer/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl()),
  title: "MXW01 Принтер — печать этикеток и ценников по Bluetooth",
  description:
    "Бесплатная печать этикеток и ценников на термопринтере MXW01 прямо в браузере по Bluetooth: штрихкоды EAN-13, изображения, шаблоны. Без установки программ и регистрации.",
  keywords: [
    "MXW01",
    "MXW01 принтер",
    "MXW01 термопринтер",
    "термопринтер этикеток",
    "принтер этикеток",
    "термопринтер для малого бизнеса",
    "печать этикеток",
    "печать этикеток онлайн",
    "программа для печати этикеток",
    "печать ценников",
    "печать ценников онлайн",
    "сделать ценник онлайн",
    "генератор ценников",
    "шаблон ценника",
    "ценник со штрихкодом",
    "печать штрихкода",
    "штрихкод EAN-13",
    "генератор этикеток",
    "термоэтикетки",
    "маркировка товара",
    "печать стикеров",
    "печать наклеек",
  ],
  authors: [{ name: "Holapsicon" }],
  creator: "Holapsicon",
  applicationName: "MXW01 Web Terminal",
  category: "utilities",
  alternates: { canonical: "/" },
  openGraph: {
    title: "MXW01 Принтер — печать этикеток и ценников по Bluetooth",
    url: "/",
    siteName: "MXW01 Web Terminal",
    locale: "ru_RU",
    alternateLocale: ["en_US"],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "MXW01 Принтер — печать этикеток и ценников по Bluetooth",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Тема (light/dark/system) ставится ДО первой отрисовки — без вспышки
  // светлой темы. Liquid Glass удалён в v1.0.39: искажение фона ломало
  // вёрстку меню настроек (контент уезжал вниз).
  const prePaintScript = `
try {
  (function () {
    var d = document.documentElement;
    var theme = "system";
    try { theme = localStorage.getItem("mxw01-theme") || "system"; } catch (e) {}
    var dark = theme === "dark" || (theme === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) d.classList.add("dark");
  })();
} catch (e) {}
`;
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prePaintScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <GtmNoscript />
        <Analytics />
        <PwaRegister />
        <SelfHit />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
