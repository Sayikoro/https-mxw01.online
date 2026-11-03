#!/usr/bin/env python3
"""Найти горизонтальные чёрные линии на превью-канвасе ленты (скриншот)."""
from PIL import Image

img = Image.open("/home/z/my-project/work/v51-format.png").convert("L")
w, h = img.size
px = img.load()

# Канвас страницы: ищем колонку внутри текста (x≈700) и смотрим тёмные строки
# Страница примерно x 658..1042, y 208..472 (по предыдущим скриншотам)
x0, x1 = 660, 1040
rows = []
for y in range(200, 290):
    dark = sum(1 for x in range(x0, x1) if px[x, y] < 100)
    if dark > 30:
        rows.append((y, dark))

print("Тёмные строки (y, тёмных пикселей):")
prev = None
for y, d in rows:
    if prev is None or y - prev > 1:
        print("---")
    print(f"  y={y} dark={d}")
    prev = y
