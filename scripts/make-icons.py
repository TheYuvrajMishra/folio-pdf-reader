#!/usr/bin/env python3
"""Generate Folio launcher icons (DESIGN §10).

Near-black rounded square, open-book line art in warm ink (#F4F1EA),
single ember horizontal line in accent (#FF5A36). Outputs:
  assets/images/icon.png                     1024×1024 (store / legacy)
  assets/images/android-icon-foreground.png  1024×1024 (adaptive, safe-zone aware)
  assets/images/android-icon-background.png  1024×1024 solid #0B0B0C
  assets/images/android-icon-monochrome.png  1024×1024 (themed icon, line art only)
  assets/images/favicon.png                  48×48
  assets/images/splash-icon.png              1024×1024 (centered mark on dark)
"""
import math
from PIL import Image, ImageDraw

INK = (0x0B, 0x0B, 0x0C, 255)      # near-black
PAGE = (0xF4, 0xF1, 0xEA, 255)     # warm ink
EMBER = (0xFF, 0x5A, 0x36, 255)    # accent ember

SIZE = 1024


def rounded_bg(size, radius):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=INK)
    return img, d


def draw_book(d, cx, cy, w, h, lw, page_color):
    """Open-book line art: two page quads meeting at a center spine."""
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - h / 2, cy + h / 2
    spine_top, spine_bot = cy - h * 0.32, cy + h * 0.30
    # left page
    d.line([(x0, y0), (cx, spine_top)], fill=page_color, width=lw)
    d.line([(cx, spine_top), (cx, spine_bot)], fill=page_color, width=lw)
    d.line([(cx, spine_bot), (x0, y1)], fill=page_color, width=lw)
    # right page
    d.line([(cx, spine_top), (x1, y0)], fill=page_color, width=lw)
    d.line([(cx, spine_bot), (x1, y1)], fill=page_color, width=lw)
    # outer edges
    d.line([(x0, y0), (x0, y1)], fill=page_color, width=lw)
    d.line([(x1, y0), (x1, y1)], fill=page_color, width=lw)
    # text hints: two short lines on each page
    for i, yy in enumerate([0.16, 0.30]):
        y = cy - h * 0.5 + h * (0.18 + i * 0.16)
        d.line([(x0 + w * 0.10, y), (cx - w * 0.10, y)], fill=page_color, width=max(2, lw // 3))
        d.line([(cx + w * 0.10, y), (x1 - w * 0.10, y)], fill=page_color, width=max(2, lw // 3))


def draw_ember(d, cx, y, half, lw):
    d.line([(cx - half, y), (cx + half, y)], fill=EMBER, width=lw)
    # soft glow dots at the ends
    r = lw
    d.ellipse([cx - half - r, y - r, cx - half + r, y + r], fill=EMBER)
    d.ellipse([cx + half - r, y - r, cx + half + r, y + r], fill=EMBER)


def icon_full(path):
    img, d = rounded_bg(SIZE, SIZE // 5)
    draw_book(d, SIZE / 2, SIZE * 0.44, SIZE * 0.52, SIZE * 0.36, SIZE // 64, PAGE)
    draw_ember(d, SIZE / 2, SIZE * 0.74, SIZE * 0.16, SIZE // 72)
    img.save(path)


def adaptive_foreground(path):
    # Transparent bg; artwork inside the 66dp safe circle (diameter ~ 0.66*1024).
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_book(d, SIZE / 2, SIZE * 0.44, SIZE * 0.44, SIZE * 0.30, SIZE // 72, PAGE)
    draw_ember(d, SIZE / 2, SIZE * 0.70, SIZE * 0.14, SIZE // 80)
    img.save(path)


def adaptive_background(path):
    Image.new("RGBA", (SIZE, SIZE), INK).save(path)


def monochrome(path):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # White line art only (system tints it); keep inside safe zone.
    white = (255, 255, 255, 255)
    draw_book(d, SIZE / 2, SIZE * 0.44, SIZE * 0.44, SIZE * 0.30, SIZE // 72, white)
    img.save(path)


def favicon(path):
    img, d = rounded_bg(48, 10)
    draw_book(d, 24, 21, 26, 18, 3, PAGE)
    draw_ember(d, 24, 36, 8, 3)
    img.save(path)


def splash(path):
    img = Image.new("RGBA", (SIZE, SIZE), INK)
    d = ImageDraw.Draw(img)
    draw_book(d, SIZE / 2, SIZE * 0.46, SIZE * 0.40, SIZE * 0.28, SIZE // 80, PAGE)
    draw_ember(d, SIZE / 2, SIZE * 0.68, SIZE * 0.13, SIZE // 88)
    img.save(path)


if __name__ == "__main__":
    base = "assets/images"
    icon_full(f"{base}/icon.png")
    adaptive_foreground(f"{base}/android-icon-foreground.png")
    adaptive_background(f"{base}/android-icon-background.png")
    monochrome(f"{base}/android-icon-monochrome.png")
    favicon(f"{base}/favicon.png")
    splash(f"{base}/splash-icon.png")
    print("icons written")
