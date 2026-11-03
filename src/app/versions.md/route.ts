/**
 * Роут /versions.md (v1.0.28): отдаёт файл versions.md из корня проекта.
 * При статической сборке содержимое читается и записывается в статику —
 * в деплой-кит история попадает автоматически и всегда совпадает с
 * установленной версией. Окно «Изменения по версиям» читает этот роут.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

export function GET(): Response {
  try {
    const md = readFileSync(path.join(process.cwd(), "versions.md"), "utf8");
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("versions.md not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
