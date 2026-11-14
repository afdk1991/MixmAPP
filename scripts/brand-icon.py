"""MixmAPP 平台级品牌资产一键生成器（新设计体系 · 2026-11-14）。

视觉体系（与 apps/app/src/uni.scss 令牌、components/mx-logo/mx-logo.vue 一致）：
  - 深场：$deep #0b0f0e；启动图渐变收尾 #17322c（规范第 3 节允许的深场渐变色标）
  - 纸面：$paper #f4f4f1；品牌青：$brand #0f9d8f
  - 标志：方框内 800 字重 “MX” 连字 + 方框下方品牌青底线（左右各缩进 18%，底边距 22%）

产出目标：
  H5 / PWA 静态图标（apps/app/src/static/）
    logo.png            1024×1024
    logo-192.png         192×192
    logo-48.png           48×48
    favicon.png          64×64
  H5 启动图
    splash.png           沿用现有像素尺寸（现 1242×2688），不改变引用路径
  Android 图标（apps/mobile/android/app/src/main/res/）
    mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
    mipmap-*/ic_launcher_round.png
    mipmap-*/ic_launcher_foreground.png   （自适应图标 / Android 12+ 启动屏前景）
  Android 启动图
    drawable{,-port,-land}-*/splash.png    逐个对齐现有文件的真实像素尺寸
  文档母版（docs/brand/）
    logo-1024.png
    wordmark-1024x256.png

幂等性：纯确定性绘制，无随机、无时间戳写入；重复运行覆盖同一批目标文件，
不创建多余文件，不触碰任何 .vue / .scss / .json / 配置 / 构建缓存。

运行（仓库根目录）：
    python scripts/brand-icon.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "apps" / "app" / "src" / "static"
RES = ROOT / "apps" / "mobile" / "android" / "app" / "src" / "main" / "res"
DOC_OUT = ROOT / "docs" / "brand"

# ---------- 品牌色（与 uni.scss 令牌一致） ----------
DEEP = (11, 15, 14, 255)          # $deep #0b0f0e
DEEP_BOTTOM = (23, 50, 44, 255)   # #17322c 深场渐变收尾
PAPER = (244, 244, 241, 255)      # $paper #f4f4f1
BRAND = (15, 157, 143, 255)       # $brand #0f9d8f
BORDER = (244, 244, 241, 66)      # 深底描边 rgba(paper, .26)
SOFT = (244, 244, 241, 13)        # 深底方框软填充 rgba(paper, .05)
SUB_FILL = (244, 244, 241, 132)    # 深底次要说明字 rgba(paper, .52)

BOLD_FONTS = [
    r"C:\Windows\Fonts\seguibl.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
MONO_FONTS = [
    r"C:\Windows\Fonts\consola.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    r"C:\Windows\Fonts\cour.ttf",
]

# Android 密度：(legacy 图标边长, 自适应前景边长)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

# 启动图兜底尺寸（仅当 res 下不存在同名文件时使用；正常以现有文件真实尺寸为准）
FALLBACK_SPLASH = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-land-mdpi": (480, 320),
    "drawable-port-hdpi": (480, 800),
    "drawable-land-hdpi": (800, 480),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-xxxhdpi": (1920, 1280),
}

H5_SPLASH_NAME = "splash.png"
H5_SPLASH_FALLBACK = (1242, 2688)


# ---------- 字体 ----------
def _font(candidates, size):
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def fit_bold(draw, text, max_w, max_h, start=300):
    """按可用宽高反解 800 字重字号，保证 MX / 字标不越框。"""
    size = int(start)
    while size > 8:
        f = _font(BOLD_FONTS, size)
        box = draw.textbbox((0, 0), text, font=f)
        if (box[2] - box[0]) <= max_w and (box[3] - box[1]) <= max_h:
            return f
        size -= 2
    return _font(BOLD_FONTS, 8)


# ---------- 基础绘制 ----------
def vertical_gradient(w, h, top, bottom):
    """纵向深场渐变（规范第 3 节允许的深场色标）。"""
    if w < 2 or h < 2:
        return Image.new("RGBA", (max(w, 1), max(h, 1)), top)
    line = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / (h - 1)
        line.putpixel((0, y), tuple(
            round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)
        ) + (255,))
    return line.resize((w, h), Image.LANCZOS)


def draw_mark(canvas, box, soft=True, border=True, mono=PAPER):
    """在 box=(x,y,w,h) 内画 MX 方框标志：软填充 + 发丝描边 + MX + 品牌青底线。"""
    x, y, w, h = box
    radius = int(min(w, h) * 0.14)
    if soft or border:
        # 半透明方框必须走 alpha_composite，避免 ImageDraw 直接写入 alpha
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [x, y, x + w, y + h],
            radius=radius,
            fill=SOFT if soft else None,
            outline=BORDER if border else None,
            width=max(1, int(w * 0.008)),
        )
        canvas.alpha_composite(layer)

    d = ImageDraw.Draw(canvas, "RGBA")
    f = fit_bold(d, "MX", w * 0.56, h * 0.52, start=h * 0.55)
    b = d.textbbox((0, 0), "MX", font=f)
    tw, th = b[2] - b[0], b[3] - b[1]
    tx = x + (w - tw) / 2 - b[0]
    ty = y + h * 0.44 - (b[1] + th / 2)
    d.text((tx, ty), "MX", font=f, fill=mono)

    bh = max(1, int(h * 0.033))
    d.rectangle(
        [x + w * 0.18, y + h * 0.78 - bh, x + w * 0.82, y + h * 0.78],
        fill=BRAND,
    )


def tracked_width(draw, text, font, tracking):
    width = 0
    for ch in text:
        b = draw.textbbox((0, 0), ch, font=font)
        width += b[2] - b[0] + tracking
    return width - tracking


def draw_tracked(draw, x, y, text, font, fill, tracking=0):
    cx = x
    for ch in text:
        draw.text((cx, y), ch, font=font, fill=fill)
        b = draw.textbbox((0, 0), ch, font=font)
        cx += (b[2] - b[0]) + tracking


def circle_mask(size):
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    return mask.resize((size, size), Image.LANCZOS)


# ---------- 产物构图 ----------
def make_icon(size, round_icon=False, foreground=False):
    """应用图标：深底方框标志；round 圆形裁切；foreground 透明自适应前景。"""
    if foreground:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inset = size * 0.17  # 收在 66% 安全区内
        draw_mark(img, (inset, inset, size - 2 * inset, size - 2 * inset),
                  soft=False, border=False)
        return img

    img = Image.new("RGBA", (size, size), DEEP)
    if round_icon:
        tile = Image.new("RGBA", (size, size), DEEP)
        inset = size * 0.22
        draw_mark(tile, (inset, inset, size - 2 * inset, size - 2 * inset),
                  soft=False, border=False)
        tile.putalpha(circle_mask(size))
        return tile

    inset = size * 0.16
    draw_mark(img, (inset, inset, size - 2 * inset, size - 2 * inset),
              soft=True, border=True)
    return img


def make_splash(w, h):
    """启动图：深场渐变 + 居中 MX 方框 + MIXMAPP 字标 + 等宽小字。"""
    img = vertical_gradient(w, h, DEEP, DEEP_BOTTOM)
    d = ImageDraw.Draw(img)
    short = min(w, h)

    box = int(short * 0.24)
    word_size = max(12, int(short * 0.085))
    sub_size = max(8, int(short * 0.034))

    f_word = fit_bold(d, "MIXMAPP", w * 0.7, word_size * 1.25, start=word_size)
    f_sub = _font(MONO_FONTS, sub_size)

    wb = d.textbbox((0, 0), "MIXMAPP", font=f_word)
    word_w, word_h = wb[2] - wb[0], wb[3] - wb[1]
    sub_track = max(1, int(sub_size * 0.18))
    sub_w = tracked_width(d, "MULTI-END IDENTITY", f_sub, sub_track)

    gap1 = box * 0.28
    gap2 = box * 0.18
    group_h = box + gap1 + word_h + gap2 + sub_size

    cx, cy = w / 2, h / 2
    top = cy - group_h / 2
    draw_mark(img, (cx - box / 2, top, box, box), soft=True, border=True)
    d.text((cx - word_w / 2 - wb[0], top + box + gap1),
           "MIXMAPP", font=f_word, fill=PAPER)
    draw_tracked(d, cx - sub_w / 2, top + box + gap1 + word_h + gap2,
                 "MULTI-END IDENTITY", f_sub, SUB_FILL, sub_track)
    return img


def make_wordmark(w, h):
    """文档用横版字标：左侧 MX 方框 + 右侧 MIXMAPP 与等宽小字。"""
    img = Image.new("RGBA", (w, h), DEEP)
    d = ImageDraw.Draw(img)

    side = int(h * 0.62)
    left = int(h * 0.19)
    draw_mark(img, (left, (h - side) / 2, side, side), soft=True, border=True)

    tx = left + side + int(h * 0.22)
    f_word = fit_bold(d, "MIXMAPP", w - tx - h * 0.1, h * 0.34,
                      start=int(h * 0.30))
    f_sub = _font(MONO_FONTS, int(h * 0.14))

    wb = d.textbbox((0, 0), "MIXMAPP", font=f_word)
    word_h = wb[3] - wb[1]
    sub = "MULTI-END IDENTITY"
    sub_track = max(1, int(h * 0.026))

    gap = h * 0.08
    total_h = word_h + gap + h * 0.14
    top = (h - total_h) / 2
    d.text((tx, top), "MIXMAPP", font=f_word, fill=PAPER)
    draw_tracked(d, tx, top + word_h + gap, sub, f_sub, SUB_FILL, sub_track)
    return img


# ---------- 尺寸发现（按现有文件真实像素对齐） ----------
def existing_size(path: Path):
    if not path.exists():
        return None
    try:
        with Image.open(path) as im:
            return im.size
    except OSError:
        return None


def discover_android_splashes():
    """返回 {目录名: (w,h)}；已存在的以真实尺寸为准，缺失的走兜底表。"""
    targets = dict(FALLBACK_SPLASH)
    if RES.exists():
        for p in RES.glob("drawable*/splash.png"):
            size = existing_size(p)
            if size:
                targets[p.parent.name] = size
    return targets


# ---------- 落盘 ----------
def save(img: Image.Image, path: Path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    records.append((path, img.size[0], img.size[1], path.stat().st_size))


def main():
    STATIC.mkdir(parents=True, exist_ok=True)
    DOC_OUT.mkdir(parents=True, exist_ok=True)
    records = []

    # 1) H5 / PWA 静态图标
    save(make_icon(1024), STATIC / "logo.png", records)
    save(make_icon(192), STATIC / "logo-192.png", records)
    save(make_icon(48), STATIC / "logo-48.png", records)
    save(make_icon(64), STATIC / "favicon.png", records)

    # 2) H5 启动图：沿用现有像素尺寸，路径不变
    h5_splash = STATIC / H5_SPLASH_NAME
    h5_size = existing_size(h5_splash) or H5_SPLASH_FALLBACK
    save(make_splash(*h5_size), h5_splash, records)

    # 3) Android 图标（legacy 方/圆 + 自适应前景）
    for density, (legacy, fg) in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        save(make_icon(legacy, round_icon=False), folder / "ic_launcher.png", records)
        save(make_icon(legacy, round_icon=True), folder / "ic_launcher_round.png", records)
        save(make_icon(fg, foreground=True), folder / "ic_launcher_foreground.png", records)

    # 4) Android 启动图（逐个对齐现有像素尺寸）
    for folder, (w, h) in discover_android_splashes().items():
        save(make_splash(w, h), RES / folder / "splash.png", records)

    # 5) 文档母版
    save(make_icon(1024), DOC_OUT / "logo-1024.png", records)
    save(make_wordmark(1024, 256), DOC_OUT / "wordmark-1024x256.png", records)

    # 日志：绝对路径 + 像素尺寸 + 字节数
    print(f"✓ 共生成 {len(records)} 个品牌资产：")
    for path, w, h, nbytes in records:
        print(f"  {path}  {w}×{h}  {nbytes} bytes")


if __name__ == "__main__":
    main()
