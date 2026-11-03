#!/usr/bin/env python3
"""Тестовое изображение для вкладки «Изображение»: градиенты, круги, линии.
Запуск: python3 scripts/make-test-image.py  →  work/test-photo.png
"""
import struct, zlib, os

W, H = 768, 512

def px(x, y):
    # Горизонтальный градиент (фон)
    r = int(40 + (x / W) * 180)
    g = int(50 + (y / H) * 150)
    b = int(120 + (x / W) * 120)
    # Круг тёмный
    cx, cy, cr = W * 0.32, H * 0.5, H * 0.30
    d2 = (x - cx) ** 2 + (y - cy) ** 2
    if d2 < cr * cr:
        f = 1.0 - (d2 / (cr * cr)) ** 0.5 * 0.5
        r, g, b = int(r * f), int(g * f), int(b * f)
    # Светлый круг
    cx2, cy2, cr2 = W * 0.68, H * 0.45, H * 0.26
    d2b = (x - cx2) ** 2 + (y - cy2) ** 2
    if d2b < cr2 * cr2:
        r, g, b = min(255, r + 90), min(255, g + 90), min(255, b + 60)
    # Диагональные линии (для проверки резкости)
    if (x + y) % 48 < 4:
        r, g, b = 20, 20, 20
    # Прямоугольник
    if W * 0.55 < x < W * 0.85 and H * 0.62 < y < H * 0.88 and (x // 8 + y // 8) % 2 == 0:
        r, g, b = 200, 200, 200
    return (r, g, b)

raw = b""
for y in range(H):
    raw += b"\x00"
    for x in range(W):
        raw += bytes(px(x, y))

def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(raw, 6))
    + chunk(b"IEND", b"")
)
os.makedirs("work", exist_ok=True)
with open("work/test-photo.png", "wb") as f:
    f.write(png)
print("OK work/test-photo.png", W, "x", H, len(png), "bytes")
