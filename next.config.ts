import type { NextConfig } from "next";

/**
 * Два режима сборки:
 *  • обычный (dev/standalone) — как раньше, для `bun run dev` / `bun run start`;
 *  • статический (BUILD_STATIC=1) — output: 'export' в .next-static:
 *    чистые HTML/JS/CSS для любого хостинга без Node (см. scripts/build-static.sh).
 */
const isStatic = process.env.BUILD_STATIC === "1";

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      distDir: ".next-static",
      trailingSlash: true,
      images: { unoptimized: true },
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      /* config options here */
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

export default nextConfig;
