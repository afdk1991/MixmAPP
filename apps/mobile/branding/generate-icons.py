#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""MixmAPP Android 图标 / 启动图生成器（唯一事实源，改动请改这里再重跑）。

画法取自 apps/app/src/components/mx-logo/mx-logo.vue：
  方框内 “MX” 连字 + 品牌青底线；深底态用 $deep 作底、$paper 作字。
色值取自 apps/app/src/uni.scss。

用法（仓库根）：
    python apps/mobile/branding/generate-icons.py

产物（apps/mobile/android/app/src/main/res）：
    mipmap-{mdpi..xxxhdpi}/ic_launcher.png          48/72/96/144/192 深底圆角方块
    mipmap-{...}/ic_launcher_round.png              同上，圆形裁切
    mipmap-{...}/ic_launcher_foreground.png         108/162/216/324/432 透明层（自适应图标前景）
    drawable{,-port,-land}-*/splash.png             与 Capacitor 原有尺寸一一对应
"""
import os
import struct
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RES = os.path.join(ROOT, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res')

DEEP = '#0b0f0e'          # $deep 主视觉深场
DEEP_3 = '#1d2a26'        # $deep-3 描边
PAPER = '#f4f4f1'         # $paper 暖白
BRAND = '#0f9d8f'         # $brand 品牌青
SOFT = (244, 244, 241, 18)   # 深底上的方框填充 rgba(244,244,241,0.07)
BORDER = (244, 244, 241, 66)  # 深底上的描边 rgba(244,244,241,0.26)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\seguibl.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
]


def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_monogram(canvas, box, fill_bg=None, border=None, mono=PAPER, underline=BRAND):
    """在 box=(x,y,w,h) 内画 MX 连字 + 品牌底线；fill_bg/border 传 None 表示只画字（透明前景）。"""
    x, y, w, h = box
    radius = int(w * 0.14)
    if fill_bg or border:
        # 半透明的方框必须走 alpha_composite，ImageDraw 在 RGBA 画布上会直接写入 alpha 而不是混合
        layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [x, y, x + w, y + h], radius=radius,
            fill=fill_bg, outline=border, width=max(1, int(w * 0.006)))
        canvas.alpha_composite(layer)
    d = ImageDraw.Draw(canvas, 'RGBA')
    # 字号：让 “MX” 视觉宽度约占方框 52%
    size = int(h * 0.52)
    while size > 8:
        f = load_font(size)
        tw = d.textbbox((0, 0), 'MX', font=f)[2]
        if tw <= w * 0.54:
            break
        size -= 1
    f = load_font(size)
    bbox = d.textbbox((0, 0), 'MX', font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = x + (w - tw) / 2 - bbox[0]
    ty = y + h * 0.44 - (bbox[1] + th / 2)
    d.text((tx, ty), 'MX', font=f, fill=mono)
    # 底线：左右各缩进 18%，高度 3.3%，底边距离下方 22%
    bh = max(1, int(h * 0.033))
    d.rectangle([x + w * 0.18, y + h * 0.78 - bh, x + w * 0.82, y + h * 0.78], fill=underline)


def circle_mask(size):
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def legacy_icon(size, round_icon=False, background=DEEP, outline=None):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if round_icon:
        draw_monogram(img, (0, 0, size, size), mono=PAPER)
        tile = Image.new('RGBA', (size, size), background)
        draw_monogram(tile, (0, 0, size, size), mono=PAPER)
        tile.putalpha(circle_mask(size))
        return Image.alpha_composite(img, tile)
    draw_monogram(img, (0, 0, size, size), fill_bg=background, border=outline, mono=PAPER)
    return img


def foreground(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inset = size * 0.17   # 内容收在 66% 安全区内
    draw_monogram(img, (inset, inset, size - inset * 2, size - inset * 2), mono=PAPER)
    return img


def splash(width, height):
    img = Image.new('RGBA', (width, height), DEEP)
    d = ImageDraw.Draw(img)
    short = min(width, height)
    box = int(short * 0.20)
    cx, cy = width // 2, height // 2
    draw_monogram(img, (cx - box // 2, cy - box * 0.62, box, box),
                  fill_bg=SOFT, border=BORDER, mono=PAPER)
    # 字标
    size = max(10, int(short * 0.085))
    f = load_font(size)
    word = 'MixmAPP'
    tw = d.textbbox((0, 0), word, font=f)[2]
    d.text((cx - tw / 2 - int(size * 0.02), cy + box * 0.52), word, font=f, fill=PAPER)
    # 等宽小字
    size2 = max(7, int(short * 0.036))
    f2 = load_font(size2)
    sub = 'M U L T I - E N D   I D E N T I T Y'
    sw = d.textbbox((0, 0), sub, font=f2)[2]
    d.text((cx - sw / 2, cy + box * 0.52 + size * 1.5), sub, font=f2,
           fill=(244, 244, 241, 128))
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


def save(img, folder, name):
    out = os.path.join(RES, folder)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, name)
    img.save(path, 'PNG', optimize=True)
    return path


def main():
    written = 0
    for density, (legacy, fg) in DENSITIES.items():
        save(legacy_icon(legacy), f'mipmap-{density}', 'ic_launcher.png')
        save(legacy_icon(legacy, round_icon=True), f'mipmap-{density}', 'ic_launcher_round.png')
        save(foreground(fg), f'mipmap-{density}', 'ic_launcher_foreground.png')
        written += 3
    for folder, sizes in SPLASHES.items():
        for w, h in sizes:
            save(splash(w, h), folder, 'splash.png')
            written += 1
    # 自适应图标的底色资源
    bg_path = os.path.join(RES, 'values', 'ic_launcher_background.xml')
    with open(bg_path, 'w', encoding='utf-8', newline='') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n')
        f.write('    <color name="ic_launcher_background">#0B0F0E</color>\n</resources>\n')
    written += 1
    print(f'✓ 生成 {written} 个文件：图标 15 + 启动图 11 + 背景色 1')
    print(f'  输出目录：{RES}')


if __name__ == '__main__':
    main()
