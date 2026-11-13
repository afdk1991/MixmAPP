"""把 Android 启动图从 2:3 / 3:2 适配到手机主流的 9:20 / 20:9。

做法：等比缩放到目标短边，再用原图底色补齐长边，不拉伸画面。
"""

from pathlib import Path

from PIL import Image

RES = Path(__file__).resolve().parents[1] / "apps/mobile/android/app/src/main/res"

# 密度 -> (目标宽, 目标高)，竖屏 9:20，横屏 20:9
PORT = {
    "mdpi": (320, 711),
    "hdpi": (480, 1067),
    "xhdpi": (720, 1600),
    "xxhdpi": (960, 2133),
    "xxxhdpi": (1080, 2400),
}
LAND = {k: (h, w) for k, (w, h) in PORT.items()}


def fit(src: Path, dst_w: int, dst_h: int) -> None:
    img = Image.open(src).convert("RGB")
    fill = img.getpixel((0, 0))
    scale = min(dst_w / img.width, dst_h / img.height)
    new_w, new_h = round(img.width * scale), round(img.height * scale)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", (dst_w, dst_h), fill)
    canvas.paste(resized, ((dst_w - new_w) // 2, (dst_h - new_h) // 2))
    canvas.save(src, optimize=True)
    print(f"{src.relative_to(RES)} -> {dst_w}x{dst_h}")


for density, (w, h) in PORT.items():
    fit(RES / f"drawable-port-{density}/splash.png", w, h)
for density, (w, h) in LAND.items():
    fit(RES / f"drawable-land-{density}/splash.png", w, h)
