#!/usr/bin/env python3
"""商品图缩略图生成器（服务端一次性 / 增量都可重复执行）。

为什么需要：
- 商城列表与详情原来直接加载 1000×1000 原图（平均约 180KB，最大近 1MB），
  移动端首屏要下十几张，浪费带宽也拖慢 LCP；
- 服务器没有 image_filter / sharp，最稳的做法是离线生成固定档位缩略图，
  由 nginx 直接静态直出并长缓存，运行时零 CPU 开销。

产物命名（与前端 apps/app/src/api/client.ts 的 thumbUrl 一一对应）：
    <sha1>.jpg  →  <sha1>-480.jpg / <sha1>-960.jpg
    <sha1>.png  →  <sha1>-480.png / <sha1>-960.png （保留 PNG，避免透明底变黑）
    <sha1>.webp →  <sha1>-480.webp / <sha1>-960.webp

安全约定：
- 只写同目录下的派生文件，绝不覆盖或删除原图；
- 已存在且不早于原图的缩略图直接跳过，可反复执行；
- 单张失败只告警，不中断整批。

用法：
    python3 scripts/media-thumbs.py --root /var/lib/mixmapp/storage/products
    python3 scripts/media-thumbs.py --root ... --sizes 480,960 --workers 2
"""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import sys
import time

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - 部署机缺依赖时给出明确指引
    print("需要 Pillow：apt-get install -y python3-pil", file=sys.stderr)
    raise SystemExit(2)

# 只处理真实商品图后缀；不碰 .bak / .json 等旁路文件。
SUPPORTED = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}


def target_path(original: str, size: int) -> str:
    """<dir>/<stem><ext> → <dir>/<stem>-<size><ext>。"""
    stem, ext = os.path.splitext(original)
    return f"{stem}-{size}{ext.lower()}"


def needs_build(original: str, target: str) -> bool:
    """缩略图缺失或比原图旧时需要重建。"""
    if not os.path.exists(target):
        return True
    return os.path.getmtime(target) < os.path.getmtime(original)


def build_one(original: str, sizes: list[int], quality: int) -> tuple[int, int]:
    """生成单张图的所有档位，返回 (生成数, 产出字节数)。"""
    ext = os.path.splitext(original)[1].lower()
    fmt = SUPPORTED.get(ext)
    if not fmt:
        return (0, 0)

    # 先判断是否有任何档位需要生成，避免无谓的解码。
    pending = [size for size in sizes if needs_build(original, target_path(original, size))]
    if not pending:
        return (0, 0)

    created = 0
    written = 0
    try:
        with Image.open(original) as image:
            # 手机拍摄图可能带 EXIF 方向，先摆正再缩放，避免缩略图横躺。
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            for size in pending:
                # 原图比目标还小时不放大，直接跳过（避免糊图与无意义的流量）。
                if width <= size and height <= size:
                    continue
                ratio = size / float(min(width, height))
                # BILINEAR：在 1000→480/960 这种缩幅下与 LANCZOS 肉眼差异很小，
                # 但吞吐高数倍；9386 张原图全量生成时总耗时从小时级降到十几分钟。
                resized = image.resize(
                    (max(1, round(width * ratio)), max(1, round(height * ratio))),
                    Image.BILINEAR,
                )
                output = target_path(original, size)
                if fmt == "JPEG":
                    # JPEG 不支持透明：统一铺白底，避免 PNG 转 JPEG 后出现黑块。
                    if resized.mode in ("RGBA", "LA", "P"):
                        background = Image.new("RGB", resized.size, (255, 255, 255))
                        background.paste(resized.convert("RGBA"), mask=resized.convert("RGBA").split()[-1])
                        resized = background
                    else:
                        resized = resized.convert("RGB")
                    resized.save(output, "JPEG", quality=quality, optimize=True, progressive=True)
                elif fmt == "PNG":
                    resized.save(output, "PNG", optimize=True)
                else:
                    resized.save(output, "WEBP", quality=quality, method=4)
                created += 1
                written += os.path.getsize(output)
    except Exception as error:  # 单张失败不影响整批
        print(f"[thumb] 跳过 {os.path.basename(original)}：{error}", file=sys.stderr)
    return (created, written)


def main() -> int:
    parser = argparse.ArgumentParser(description="生成商品图 480/960 缩略图")
    parser.add_argument("--root", required=True, help="商品图目录（原图与缩略图同目录）")
    parser.add_argument("--sizes", default="480,960", help="逗号分隔的档位，默认 480,960")
    parser.add_argument("--quality", type=int, default=78, help="JPEG / WebP 质量，默认 78")
    parser.add_argument("--workers", type=int, default=2, help="并行进程数，默认 2")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 张（调试用）")
    args = parser.parse_args()

    sizes = [int(item) for item in args.sizes.split(",") if item.strip().isdigit()]
    if not sizes:
        print("--sizes 至少给一个数字", file=sys.stderr)
        return 2

    import re

    # 排除已经生成的 -480 / -960 派生文件，否则会把缩略图当成原图再扫一遍。
    thumb_name = re.compile(r"-(?:480|960)\.[a-z0-9]+$", re.IGNORECASE)
    files = [
        os.path.join(args.root, name)
        for name in os.listdir(args.root)
        if os.path.splitext(name)[1].lower() in SUPPORTED
        and not name.startswith(".")
        and not thumb_name.search(name)
    ]
    files.sort()
    if args.limit:
        files = files[: args.limit]

    started = time.time()
    created_total = 0
    bytes_total = 0
    done = 0
    with concurrent.futures.ProcessPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(build_one, path, sizes, args.quality) for path in files]
        for future in concurrent.futures.as_completed(futures):
            created, written = future.result()
            created_total += created
            bytes_total += written
            done += 1
            if done % 500 == 0:
                print(f"[thumb] {done}/{len(files)} 张已扫描，新增 {created_total} 个缩略图", flush=True)

    cost = time.time() - started
    print(
        f"[thumb] ✓ 完成：扫描 {len(files)} 张，新增 {created_total} 个缩略图，"
        f"产出 {bytes_total / 1024 / 1024:.1f} MB，用时 {cost:.1f}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
