#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""MixmAPP 品牌标识生成器（PNG 派生物，唯一矢量源见 branding/mixm-logo.svg）。

规格（与 SVG 注释中的常量一一对应，改动必须同时改两处）：
    - 字标：MixmAPP（整词，7 个字符；不再出现孤立的 Mixm / MX）
    - 字重 800，字距 -3%（em）
    - 底线：品牌青 #0F9D8F，宽度与字标等宽，厚度 10% 字高，间距 16% 字高
    - 纸底 #F4F4F1；字标 #111111
    - 图标不叠胶囊（7 字符在 48dp 下会糊），以「整词 + 品牌青横线」为识别锚点
本仓没有 SVG 光栅化器（cairosvg / ImageMagick 均未安装），PNG 由本脚本用系统 800
字重无衬线（Segoe UI Bold，回退 Arial Bold / DejaVu Sans Bold）按同一几何渲染。

产物：
    mipmap-{mdpi..xxxhdpi}/ic_launcher.png          48/72/96/144/192 纸底圆角方块
    mipmap-{...}/ic_launcher_round.png              同上，圆形裁切
    mipmap-{...}/ic_launcher_foreground.png         108/162/216/324/432 透明前景层
    drawable{,-port,-land}-*/splash.png             启动图
    values/ic_launcher_background.xml               背景层色值（纸底）
    branding/icon-512.png                           上架 512×512
    apps/app/src/static/{logo.png,logo-192.png,logo-48.png,favicon.png}
                                                    H5 页头 / PWA / favicon
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RES = os.path.join(ROOT, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res')
STATIC = os.path.join(ROOT, 'apps', 'app', 'src', 'static')
BRANDING = os.path.join(ROOT, 'apps', 'mobile', 'branding')
STORE_ICON = os.path.join(BRANDING, 'icon-512.png')

PAPER = (244, 244, 241)   # $paper 纸底，与 ic_launcher_background 一致
INK = (17, 17, 17)        # 字标黑
BRAND = (15, 157, 143)    # $brand 品牌青
MUTED = (138, 143, 139)   # MIXMAPP ACCOUNT 灰

WORD = 'MixmAPP'
# 字标宽度占载体边长的比例
# adaptive 前景 108dp 的可见区只有 72dp：0.64 × 108 = 69dp 刚好落在圆形遮罩内，
# 0.74 会让首尾字母被遮罩切掉（2026-11-15 真机截图实测后修正）
FG_MARK_RATIO = 0.64
LEGACY_MARK_RATIO = 0.86   # 各密度 legacy（圆角方块）
ROUND_MARK_RATIO = 0.78    # 圆形 legacy，留出圆周余量
H5_MARK_RATIO = 0.80       # H5 logo / favicon
SPLASH_MARK_RATIO = 0.56   # 启动页（相对短边）

# 底线几何（相对字标宽 / 字高）
UNDERLINE_W = 1.0
UNDERLINE_H = 0.10
UNDERLINE_GAP = 0.16
# 字距：-3% em
TRACKING_EM = -0.03

FONT_CANDIDATES = (
    r'C:\Windows\Fonts\seguibl.ttf',
    r'C:\Windows\Fonts\segoeuib.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
)


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise SystemExit('找不到可用的 800 字重无衬线字体，请安装 Segoe UI Bold / Arial Bold')


def render_wordmark():
    """把 “MixmAPP” 渲成 alpha 掩膜（透明底），返回裁剪后的掩膜。"""
    ss = 2                      # 2x 超采样，边缘交给缩小抗锯齿
    font_pt = 400 * ss
    font = load_font(font_pt)
    probe = ImageDraw.Draw(Image.new('L', (8, 8)))
    tracking = TRACKING_EM * font_pt
    widths, boxes = [], []
    for ch in WORD:
        box = probe.textbbox((0, 0), ch, font=font)
        boxes.append(box)
        widths.append(box[2] - box[0])
    total = sum(widths) + tracking * (len(WORD) - 1)
    top = min(b[1] for b in boxes)
    bottom = max(b[3] for b in boxes)
    height = bottom - top
    canvas = Image.new('L', (int(total) + font_pt // 2, height + font_pt // 2), 0)
    draw = ImageDraw.Draw(canvas)
    x = font_pt // 8
    for ch, box in zip(WORD, boxes):
        draw.text((x - box[0], -top), ch, font=font, fill=255)
        x += (box[2] - box[0]) + tracking
    return canvas.crop(canvas.getbbox())


def mark_geometry(mask):
    gw, gh = mask.size
    return gw, gh


def compose_mark(size_w, mask, ratio=1.0):
    """按字标宽度 size_w 生成「词标 + 品牌青横线」的透明图层。"""
    gw, gh = mask.size
    w = max(1, int(round(size_w)))
    h = max(1, int(round(w * gh / gw)))
    uh = max(1, int(round(h * UNDERLINE_H)))
    gap = max(1, int(round(h * UNDERLINE_GAP)))
    total_h = h + gap + uh
    canvas = Image.new('RGBA', (w, total_h), (0, 0, 0, 0))
    glyph = mask.resize((w, h), Image.LANCZOS)
    canvas.paste(Image.new('RGBA', (w, h), INK + (255,)), (0, 0), glyph)
    ImageDraw.Draw(canvas).rectangle(
        [0, h + gap, w - 1, h + gap + uh - 1],
        fill=BRAND + (255,))
    return canvas


def place_mark(canvas, mark, center):
    cx, cy = center
    canvas.alpha_composite(mark, (int(round(cx - mark.width / 2)),
                                  int(round(cy - mark.height / 2))))
    return canvas


def rounded_mask(size, radius_ratio=0.22):
    scale = 4
    mask = Image.new('L', (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * scale - 1, size * scale - 1],
        radius=int(size * scale * radius_ratio), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def circle_mask(size):
    scale = 4
    mask = Image.new('L', (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * scale - 1, size * scale - 1], fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def legacy_icon(size, mask, round_icon=False):
    tile = Image.new('RGBA', (size, size), PAPER + (255,))
    ratio = ROUND_MARK_RATIO if round_icon else LEGACY_MARK_RATIO
    place_mark(tile, compose_mark(size * ratio, mask), (size / 2, size / 2))
    tile.putalpha(rounded_mask(size) if not round_icon else circle_mask(size))
    return tile


def foreground(size, mask):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    place_mark(canvas, compose_mark(size * FG_MARK_RATIO, mask), (size / 2, size / 2))
    return canvas


def monochrome(size, mask):
    """monochrome 层：同形白色剪影（系统按 alpha 染色）。"""
    layer = foreground(size, mask)
    solid = Image.new('RGBA', layer.size, (255, 255, 255, 0))
    solid.putalpha(layer.getchannel('A'))
    return solid


def splash(width, height, mask):
    img = Image.new('RGBA', (width, height), PAPER + (255,))
    short = min(width, height)
    d = ImageDraw.Draw(img, 'RGBA')
    mark = compose_mark(short * SPLASH_MARK_RATIO, mask)
    x = (width - mark.width) // 2
    y = (height - mark.height) // 2 - int(short * 0.06)
    img.alpha_composite(mark, (x, y))

    sub = 'M I X M A P P   A C C O U N T'
    size = max(7, int(short * 0.026))
    font = load_font(size)
    tw = d.textbbox((0, 0), sub, font=font)[2]
    d.text(((width - tw) / 2, y + mark.height + short * 0.05), sub, font=font, fill=MUTED + (255,))
    return img


DENSITIES = {
    'mdpi': (48, 108),
    'hdpi': (72, 162),
    'xhdpi': (96, 216),
    'xxhdpi': (144, 324),
    'xxxhdpi': (192, 432),
}

SPLASHES = {
    'drawable': [(480, 320)],
    'drawable-port-mdpi': [(320, 480)],
    'drawable-land-mdpi': [(480, 320)],
    'drawable-port-hdpi': [(480, 800)],
    'drawable-land-hdpi': [(800, 480)],
    'drawable-port-xhdpi': [(720, 1280)],
    'drawable-land-xhdpi': [(1280, 720)],
    'drawable-port-xxhdpi': [(960, 1600)],
    'drawable-land-xxhdpi': [(1600, 960)],
    'drawable-port-xxxhdpi': [(1280, 1920)],
    'drawable-land-xxxhdpi': [(1920, 1280)],
}


def master_logo(size, mask, mark_ratio=H5_MARK_RATIO):
    img = Image.new('RGBA', (size, size), PAPER + (255,))
    place_mark(img, compose_mark(size * mark_ratio, mask), (size / 2, size / 2))
    return img


def main():
    mask = render_wordmark()
    gw, gh = mark_geometry(mask)

    written = 0
    for density, (legacy, fg) in DENSITIES.items():
        out_dir = os.path.join(RES, f'mipmap-{density}')
        os.makedirs(out_dir, exist_ok=True)
        legacy_icon(legacy, mask).save(
            os.path.join(out_dir, 'ic_launcher.png'), 'PNG', optimize=True)
        legacy_icon(legacy, mask, round_icon=True).save(
            os.path.join(out_dir, 'ic_launcher_round.png'), 'PNG', optimize=True)
        foreground(fg, mask).save(
            os.path.join(out_dir, 'ic_launcher_foreground.png'), 'PNG', optimize=True)
        written += 3

    for folder, sizes in SPLASHES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        for w, h in sizes:
            splash(w, h, mask).save(os.path.join(out_dir, 'splash.png'), 'PNG', optimize=True)
            written += 1

    bg_path = os.path.join(RES, 'values', 'ic_launcher_background.xml')
    os.makedirs(os.path.dirname(bg_path), exist_ok=True)
    with open(bg_path, 'w', encoding='utf-8', newline='') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        f.write('    <color name="ic_launcher_background">#F4F4F1</color>\n</resources>\n')
    written += 1

    master_logo(512, mask).convert('RGB').save(STORE_ICON, 'PNG', optimize=True)
    written += 1

    # H5 侧：页头 logo / PWA 图标 / favicon 全部由同一母版派生
    os.makedirs(STATIC, exist_ok=True)
    for name, px, ratio in (('logo.png', 1024, 0.80), ('logo-192.png', 192, 0.84),
                            ('logo-48.png', 48, 0.88), ('favicon.png', 48, 0.88)):
        master_logo(px, mask, ratio).convert('RGB').save(
            os.path.join(STATIC, name), 'PNG', optimize=True)
        written += 1

    print(f'✓ 生成 {written} 个文件（图标 15 + 启动图 11 + 背景色 1 + 上架图 1 + H5 4）')
    print(f'  字标掩膜 {gw}×{gh}（字形 “{WORD}”），底线 {UNDERLINE_H:.0%} 高 / 间距 {UNDERLINE_GAP:.0%}')
    print(f'  48dp 图标字标宽 {round(48 * LEGACY_MARK_RATIO)}px，字高 {round(48 * LEGACY_MARK_RATIO * gh / gw)}px')
    print(f'  输出目录：{RES}')


if __name__ == '__main__':
    main()
