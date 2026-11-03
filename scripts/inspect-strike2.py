#!/usr/bin/env python3
"""Найти границы белого канваса и все тёмные горизонтальные линии в нём."""
from PIL import Image

img = Image.open("/home/z/my-project/work/v51-format.png").convert("L")
w, h = img.size
px = img.load()

# 1) Ищем верх канваса: строка, где много БЕЛЫХ пикселей подряд в зоне x 660..1040
def whiteness(y):
    return sum(1 for x in range(660, 1040) if px[x, y] > 240)

top = None
for y in range(195, 260):
    if whiteness(y) > 300:
        top = y
        break
print(f"Верх белого канваса: y={top}")

# 2) Тёмные линии относительно top
if top is not None:
    print("Тёмные строки (canvas_y, viewport_y, dark):")
    prev = None
    for y in range(top, min(top + 130, h)):
        dark = sum(1 for x in range(660, 1040) if px[x, y] < 100)
        if dark > 60:
            cy = y - top
            if prev is None or cy - prev > 1:
                print("---")
            print(f"  cy={cy} y={y} dark={dark}")
            prev = cy
