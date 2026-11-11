"""生成 MixmAPP 品牌基础素材：应用图标、H5 favicon、启动图。
纯本地生成，可重复执行；产物直接进入 apps/app/src/static。
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STATIC = os.path.join(ROOT, "apps", "app", "src", "static")

INK = (11, 18, 32)
TEAL = (15, 157, 143)
AMBER = (245, 158, 11)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), INK)
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            # 从墨蓝到青绿的对角渐变，末端略微提亮
            r = int(INK[0] + (TEAL[0] - INK[0]) * t)
            g = int(INK[1] + (TEAL[1] - INK[1]) * t)
            b = int(INK[2] + (TEAL[2] - INK[2]) * t)
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size * 4, size * 4), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, size * 4 - 1, size * 4 - 1), radius=radius * 4, fill=255
    )
    return mask.resize((size, size), Image.LANCZOS)


def draw_monogram(size: int) -> Image.Image:
    """在 4 倍画布上用多边形拼出几何 M，再降采样得到平滑边缘。"""
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    s = size * scale

    def pts(*xy: tuple[float, float]) -> list[tuple[float, float]]:
        return [(x * s, y * s) for x, y in xy]

    white = (255, 255, 255, 255)

    # 左右竖笔
    draw.polygon(pts((0.265, 0.27), (0.365, 0.27), (0.365, 0.735), (0.265, 0.735)), fill=white)
    draw.polygon(pts((0.635, 0.27), (0.735, 0.27), (0.735, 0.735), (0.635, 0.735)), fill=white)
    # 两条斜笔在中心汇合成落到基线的 V
    draw.polygon(pts((0.300, 0.27), (0.395, 0.27), (0.505, 0.735), (0.445, 0.735)), fill=white)
    draw.polygon(pts((0.605, 0.27), (0.700, 0.27), (0.555, 0.735), (0.495, 0.735)), fill=white)

    return canvas.resize((size, size), Image.LANCZOS)


def build_icon(size: int) -> Image.Image:
    base = gradient(size).convert("RGBA")
    mask = rounded_mask(size, int(size * 0.22))
    base.putalpha(mask)
    mono = draw_monogram(size)
    base = Image.alpha_composite(base, mono)
    return base


def main() -> None:
    os.makedirs(STATIC, exist_ok=True)
    icon = build_icon(1024)
    icon.save(os.path.join(STATIC, "logo.png"))
    icon.resize((192, 192), Image.LANCZOS).save(os.path.join(STATIC, "logo-192.png"))
    icon.resize((64, 64), Image.LANCZOS).save(os.path.join(STATIC, "favicon.png"))
    icon.resize((48, 48), Image.LANCZOS).save(os.path.join(STATIC, "logo-48.png"))

    # 启动图：竖版纯色底 + 居中图标，供 App 端 splash 使用
    splash = Image.new("RGB", (1242, 2688), INK)
    logo = icon.resize((360, 360), Image.LANCZOS)
    splash.paste(logo, ((1242 - 360) // 2, (2688 - 360) // 2 - 120), logo)
    splash.save(os.path.join(STATIC, "splash.png"))

    print("已生成：logo.png / logo-192.png / logo-48.png / favicon.png / splash.png")


if __name__ == "__main__":
    main()
