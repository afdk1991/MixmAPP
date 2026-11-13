"""生成 MixmAPP 品牌图标：石墨底 + MX 连字 + 品牌青底线。

用途：H5 favicon、PWA 图标、Android/iOS 启动图标、README/文档用图。
运行：python scripts/brand-icon.py
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "app" / "src" / "static"
DOC_OUT = ROOT / "docs" / "brand"

INK = (11, 15, 14, 255)
PAPER = (244, 244, 241, 255)
BRAND = (15, 157, 143, 255)
FONT = "C:/Windows/Fonts/arialbd.ttf"

SIZE = 1024


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_w: float, max_h: float) -> ImageFont.FreeTypeFont:
    """按可用宽高反解字号，保证 MX 不越出内框。"""
    size = 900
    while size > 8:
        font = ImageFont.truetype(FONT, size)
        box = draw.textbbox((0, 0), text, font=font)
        if (box[2] - box[0]) <= max_w and (box[3] - box[1]) <= max_h:
            return font
        size -= 2
    return ImageFont.truetype(FONT, 8)


def draw_mark(size: int, padding_ratio: float, bg, fg, underline=True) -> Image.Image:
    img = Image.new("RGBA", (size, size), bg)
    d = ImageDraw.Draw(img)
    pad = int(size * padding_ratio)

    # 外框发丝线
    d.rectangle([pad, pad, size - pad, size - pad], outline=(244, 244, 241, 55), width=max(2, size // 256))

    inner_w = (size - 2 * pad) * 0.76
    inner_h = (size - 2 * pad) * 0.52
    font = fit_font(d, "MX", inner_w, inner_h)
    box = d.textbbox((0, 0), "MX", font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (size - tw) / 2 - box[0]
    y = (size - th) / 2 - box[1] - size * 0.05
    d.text((x, y), "MX", font=font, fill=fg)

    if underline:
        bar_w = int(size * 0.26)
        bar_h = max(6, size // 64)
        top = int(y + th + size * 0.05)
        d.rectangle([(size - bar_w) / 2, top, (size + bar_w) / 2, top + bar_h], fill=BRAND)
    return img


def main() -> None:
    DOC_OUT.mkdir(parents=True, exist_ok=True)
    master = draw_mark(SIZE, 0.22, INK, PAPER)
    master.save(OUT / "logo.png")
    master.save(DOC_OUT / "logo-1024.png")

    for px in (192, 48):
        draw_mark(px, 0.14, INK, PAPER).save(OUT / f"logo-{px}.png")

    draw_mark(64, 0.10, INK, PAPER).save(OUT / "favicon.png")
    print("icon ok")


if __name__ == "__main__":
    main()
