#!/usr/bin/env python3
"""
 ============================================================================
  СБОРКА АВТОНОМНОЙ ВЕРСИИ MXW01 — один HTML-файл для работы с диска.
 ============================================================================
  Проект НЕ изменяется: скрипт читает готовый статический экспорт
  .next-static (перед запуском выполни scripts/build-static.sh) и упаковывает
  ВСЁ в один файл download/mxw01-offline.html:

    • <script src="/_next/...">  → встроенные <script> (тот же порядок);
    • <link rel="stylesheet">    → href="data:text/css;base64,…" (в CSS шрифты
                                   и медиа переписаны в base64-данные);
    • URL стилей/шрифтов/иконки  → data-URI, в том числе в полёзных данных
                                   React (self.__next_f), чтобы клиент ничего
                                   не пытался докачать по сети;
    • <link rel="preload">       → удаляются (на file:// бесполезны);
    • noModule-полифил           → пропускается (нужен только старым браузерам).

  Результат открывается двойным кликом (file://) в Chrome/Edge: Web Bluetooth
  на file:// работает (безопасный контекст), данные живут в localStorage.
  Так как файл полностью самодостаточен, Ctrl+S из открытой страницы снова
  даёт рабочую копию.

  Запуск:  bash scripts/build-static.sh && python3 scripts/build-singlefile.py
 ============================================================================
"""
import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".next-static"
OUT = ROOT / "download" / "mxw01-offline.html"

FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<rect x="3" y="12" width="26" height="12" rx="3" fill="#0f172a"/>'
    '<rect x="7" y="3" width="18" height="9" rx="2" fill="#334155"/>'
    '<rect x="8" y="18" width="16" height="9" rx="1.5" fill="#e2e8f0"/>'
    '<circle cx="25" cy="16" r="1.6" fill="#4ade80"/>'
    "</svg>"
)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode("ascii")


def asset_path(url: str) -> Path:
    """URL вида /_next/static/media/x.woff2 или ../media/x.woff2 → файл на диске"""
    name = url.split("?")[0].split("#")[0].rstrip("/").split("/")[-1]
    for base in ("media", "chunks"):
        p = SRC / "_next" / "static" / base / name
        if p.is_file():
            return p
    raise FileNotFoundError(f"Нет файла ассета: {url}")


def mime_of(name: str) -> str:
    if name.endswith(".woff2"):
        return "font/woff2"
    if name.endswith(".woff"):
        return "font/woff"
    if name.endswith(".css"):
        return "text/css"
    if name.endswith(".js"):
        return "text/javascript"
    if name.endswith(".svg"):
        return "image/svg+xml"
    if name.endswith(".png"):
        return "image/png"
    return "application/octet-stream"


def data_uri(url: str) -> str:
    p = asset_path(url)
    return f"data:{mime_of(p.name)};base64,{b64(p)}"


def inline_css_urls(css: str) -> str:
    """url(...) (кроме уже data: и фрагментов #id) → data-URI; внутри CSS
    относительные пути битые. url(#id) — ссылка на фрагмент документа,
    файла по такому пути нет, инлайнить нельзя (логика оставлена: она
    общая и пригодится любым будущим SVG-фильтрам в CSS)."""
    def repl(m: re.Match) -> str:
        quote, url = m.group(1), m.group(2)
        if url.startswith("data:") or url.startswith("#"):
            return m.group(0)
        return f"url({quote}{data_uri(url)}{quote})"

    return re.sub(r"url\((['\"]?)([^)'\"]+)\)", repl, css)


def main() -> int:
    if not (SRC / "index.html").exists():
        print("✗ Нет .next-static/index.html — сначала выполни scripts/build-static.sh")
        return 1

    html = read_text(SRC / "index.html")

    # ------------------------------------------------------------------
    # 1) Ссылки стилей: и в <link>, и в полёзных данных React заменяем URL
    #    на один и тот же data-URI (клиент видит совпадение и не докачивает).
    # ------------------------------------------------------------------
    css_urls = re.findall(r'<link rel="stylesheet" href="(/_next/[^"]+)"', html)
    for url in css_urls:
        css = inline_css_urls(read_text(SRC / url.lstrip("/")))
        uri = "data:text/css;base64," + base64.b64encode(css.encode("utf-8")).decode("ascii")
        # <link> в разметке
        html = re.sub(
            r'<link rel="stylesheet" href="' + re.escape(url) + r'"([^>]*)>',
            r'<link rel="stylesheet" href="' + uri + r'"\1>',
            html,
        )
        # упоминания в JS/полёзных данных (внутри строк, включая экранированные)
        html = html.replace(url, uri)

    # ------------------------------------------------------------------
    # 1b) Экранированные ссылки на ассеты в полёзных данных React
    #     (\/_next\/static\/media\/x.p.woff2 — прелоад шрифтов): file://
    #     не может их скачать (CORS, origin null) — заменяем на data-URI
    # ------------------------------------------------------------------
    def esc_asset(m: re.Match) -> str:
        name = m.group(1)
        try:
            return data_uri(name)
        except FileNotFoundError:
            return m.group(0)

    html = re.sub(r"\\/_next\\/static\\/(?:media|chunks)\\/([A-Za-z0-9._-]+)", esc_asset, html)
    # и НЕэкранированные упоминания шрифтов/картинок в полёзных данных
    # (HL-подсказки прелоада: :HL["/_next/static/media/x.p.woff2"])
    html = re.sub(r"/_next/static/media/([A-Za-z0-9._-]+)", esc_asset, html)

    # ------------------------------------------------------------------
    # 2) preload-ссылки на /_next — удалить (шрифты уже внутри CSS)
    # ------------------------------------------------------------------
    html = re.sub(r'<link[^>]*rel="preload"[^>]*href="/_next/[^"]*"[^>]*/?>', "", html)
    html = re.sub(r'<link[^>]*href="/_next/[^"]*"[^>]*rel="preload"[^>]*/?>', "", html)

    # ------------------------------------------------------------------
    # 3) Favicon: внешний CDN → data-URI (и в полёзных данных тоже)
    # ------------------------------------------------------------------
    fav_uri = "data:image/svg+xml;base64," + base64.b64encode(FAVICON_SVG.encode("utf-8")).decode("ascii")
    html = re.sub(
        r'(<link rel="icon" href=")[^"]+(")',
        r"\g<1>" + fav_uri + r"\g<2>",
        html,
    )
    html = html.replace("https://z-cdn.chatglm.cn/z-ai/static/logo.svg", fav_uri)

    # ------------------------------------------------------------------
    # 4) <script src="/_next/..."> → встроенные <script>; noModule — пропустить
    # ------------------------------------------------------------------
    def script_repl(m: re.Match) -> str:
        tag, src = m.group(0), m.group(1)
        if "nomodule" in tag.lower():
            return ""  # полифил для старых браузеров: современным не нужен
        js = read_text(SRC / src.lstrip("/"))
        # --- патчи под инлайн (см. README в шапке) -----------------------
        # 1) рантайм Turbopack выводит имя чанка из src тега: у встроенного
        #    скрипта src нет — фолбэк на атрибут data-chunk-src
        js = js.replace(
            'TURBOPACK_NEXT_CHUNK_URLS.pop():e.getAttribute("src")',
            'TURBOPACK_NEXT_CHUNK_URLS.pop():'
            '(e.getAttribute("src")||e.getAttribute("data-chunk-src"))',
            1,
        )
        # 2) Next вычисляет префикс ассетов из src текущего скрипта:
        #    let{pathname:t}=new URL(e.src),n=t.indexOf("/_next/")...
        #    у встроенного скрипта src="" → new URL("") бросает Invalid URL
        js = js.replace(
            "{pathname:t}=new URL(e.src)",
            '{pathname:t}=new URL(e.src||e.getAttribute("data-chunk-src"),'
            '"http://localhost")',
            1,
        )
        # защита HTML-парсера: внутри скрипта не должно быть </script и <!--
        js = js.replace("</script", "<\\/script")
        js = js.replace("<!--", "\\x3C!--")
        # data-chunk-src — исходный путь чанка вместо отсутствующего src
        return f'<script data-chunk-src="{src}">' + js + "</script>"

    html = re.sub(r'<script src="(/_next/[^"]+)"[^>]*></script>', script_repl, html)

    # ------------------------------------------------------------------
    # 5) Контроль: в ТЕГАХ не осталось ссылок на /_next (в строках JS — можно)
    # ------------------------------------------------------------------
    leftover_tags = re.findall(r'<(?:script|link)[^>]*href="/_next/[^"]*"', html)
    leftover_tags += re.findall(r'<script src="/_next/[^"]*"', html)
    if leftover_tags:
        print("✗ Остались внешние ссылки в тегах:")
        for t in leftover_tags[:5]:
            print("   ", t)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    size_kb = OUT.stat().st_size / 1024
    print(f"✓ {OUT.relative_to(ROOT)}")
    print(f"  размер: {size_kb:.0f} КБ · стилей встроено: {len(css_urls)}")
    print("  Открывай двойным кликом в Chrome/Edge — Web Bluetooth работает с диска.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
