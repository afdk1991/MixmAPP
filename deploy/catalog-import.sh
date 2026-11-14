#!/usr/bin/env bash
# 生产机「商品数据落位 + 内嵌只读目录源启用」一次性脚本。
# ----------------------------------------------------------------------------
# 策略（2026-11-14 调整，请勿再按「往 DB 灌 15k 行」理解）：
#   1) 生产 /api/v1/admin/* 整体 404（未配 ADMIN_TOKEN），HTTP 管理通道不可用，
#      不能远程调 admin/mall/import 灌数据。
#   2) .gitignore 排除 catalog.json / source/images / storage / release，
#      CI checkout 里没有这份数据；数据必须由发布链路显式携带（CATALOG_ARTIFACT
#      或本脚本从开发机直送的数据包），不能依赖 git 追踪。
#   3) catalog-lead 的 API 内嵌只读目录源（services/api/src/modules/catalog-source.ts）
#      会把 catalog.json 懒加载成内存索引并接管商城公开读：不写 DB、不需要 ADMIN_TOKEN、
#      幂等可重跑。由 api.env 的 MALL_CATALOG_SOURCE / MALL_CATALOG_FILE 控制。
#
# 本脚本职责：校验并落位 catalog.json → 同步 872 张图片到 STORAGE_DIR/products/
#   → 本地资产硬预检 → 幂等配置 api.env → 重启服务 → 提示验收。
# 仅在【生产机】由 root/发布用户执行；不含任何远程地址与凭据，不在本会话执行。
#
# 用法（生产机上，数据包已解包到 CATALOG_DIR）：
#   sudo CATALOG_DIR=/opt/mixmapp/prod-catalog STORAGE_DIR=/var/lib/mixmapp/storage \
#        DEPLOY_CATALOG=1 bash /opt/mixmapp/deploy/catalog-import.sh
# ----------------------------------------------------------------------------
set -euo pipefail

if [ "${DEPLOY_CATALOG:-0}" != "1" ]; then
  echo "SKIP DEPLOY_CATALOG!=1，未执行商品数据落位（设为 1 才会启用目录源）"
  exit 0
fi

CATALOG_DIR=${CATALOG_DIR:-/opt/mixmapp/prod-catalog}
STORAGE_DIR=${STORAGE_DIR:-/var/lib/mixmapp/storage}
ENV_FILE=${ENV_FILE:-/etc/mixmapp/api.env}
SERVICE=${SERVICE:-mixmapp-api}
MALL_CATALOG_SOURCE=${MALL_CATALOG_SOURCE:-force}
MIN_IMAGES=${MIN_IMAGES:-871}
MIN_PRODUCTS=${MIN_PRODUCTS:-10000}
RESTART_SERVICE=${RESTART_SERVICE:-1}
IMG_SRC=${IMG_SRC:-}
CATALOG_JSON="$CATALOG_DIR/catalog.json"
PRODUCTS_DIR="$STORAGE_DIR/products"

echo "▶ 商品数据落位 CATALOG_DIR=$CATALOG_DIR STORAGE_DIR=$STORAGE_DIR"

# 兼容带一层目录的数据包（tar -C release prod-catalog 解到 /opt/mixmapp/ 时的形态）
if [ ! -f "$CATALOG_JSON" ] && [ -f "$CATALOG_DIR/prod-catalog/catalog.json" ]; then
  CATALOG_DIR="$CATALOG_DIR/prod-catalog"
  CATALOG_JSON="$CATALOG_DIR/catalog.json"
  echo "  ▶ 检测到带一层 prod-catalog/ 目录，已切换 CATALOG_DIR=$CATALOG_DIR"
fi

# 0. catalog.json 硬预检：存在、可解析、products 数量达标
[ -f "$CATALOG_JSON" ] || { echo "✗ 找不到 $CATALOG_JSON"; exit 1; }
PRODUCT_COUNT=$(node -e '
  const fs=require("node:fs");
  const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  process.stdout.write(String(Array.isArray(c.products)?c.products.length:0));
' "$CATALOG_JSON") || { echo "✗ catalog.json 不是合法 JSON"; exit 1; }
if [ "$PRODUCT_COUNT" -le "$MIN_PRODUCTS" ]; then
  echo "✗ catalog.json products 数量不足：$PRODUCT_COUNT <= $MIN_PRODUCTS"
  exit 1
fi
echo "  catalog.json 可解析，products=$PRODUCT_COUNT ($(du -h "$CATALOG_JSON" | cut -f1))"

# 1. 图片同步到 STORAGE_DIR/products/（root 执行，绕开 systemd ProtectSystem=strict）
#    优先 products/（catalog-lead 定稿目录），兼容历史 images/；也可用 IMG_SRC 显式指定。
if [ -z "$IMG_SRC" ]; then
  for d in "$CATALOG_DIR/products" "$CATALOG_DIR/images" "$CATALOG_DIR/storage/products"; do
    [ -d "$d" ] && IMG_SRC="$d" && break
  done
fi
if [ -n "$IMG_SRC" ] && [ "$(readlink -f "$IMG_SRC")" != "$(readlink -f "$PRODUCTS_DIR")" ]; then
  mkdir -p "$PRODUCTS_DIR"
  cp -a "$IMG_SRC"/. "$PRODUCTS_DIR"/
  echo "  图片已同步：$IMG_SRC → $PRODUCTS_DIR"
elif [ -n "$IMG_SRC" ]; then
  echo "  图片：源与目标同一目录，无需拷贝"
else
  echo "  ⚠ 数据包内未找到图片目录，跳过同步（将依赖下一步的文件数校验）"
fi

# 2. 图片目录硬预检：文件数达标（团队实测 872 张有效图片）
IMG_COUNT=$(find "$PRODUCTS_DIR" -type f 2>/dev/null | wc -l)
if [ "$IMG_COUNT" -lt "$MIN_IMAGES" ]; then
  echo "✗ 商品图片数不足：$IMG_COUNT < $MIN_IMAGES（目录 $PRODUCTS_DIR）"
  exit 1
fi
echo "  图片数=$IMG_COUNT ≥ $MIN_IMAGES ✓"

# 3. 修权限：nginx worker(www-data) 必须能穿越 /var/lib/mixmapp 并读图（docs/07 §18 踩坑）
if id -u www-data >/dev/null 2>&1; then
  chgrp -R www-data "$STORAGE_DIR" 2>/dev/null || true
  chmod -R o+rX "$STORAGE_DIR" || true
  chmod o+rx /var/lib/mixmapp 2>/dev/null || true
  echo "  权限：已对 www-data 放开 $STORAGE_DIR 读/穿越"
fi

# 4. 幂等配置 api.env：MALL_CATALOG_SOURCE + MALL_CATALOG_FILE
#    已配置则不覆盖，避免冲掉运维的自定义值。
[ -f "$ENV_FILE" ] || { echo "✗ 找不到 $ENV_FILE"; exit 1; }
if ! grep -qE '^MALL_CATALOG_SOURCE=' "$ENV_FILE"; then
  printf '\nMALL_CATALOG_SOURCE=%s\nMALL_CATALOG_FILE=%s\n' \
    "$MALL_CATALOG_SOURCE" "$CATALOG_JSON" >> "$ENV_FILE"
  echo "  api.env 已追加 MALL_CATALOG_SOURCE=$MALL_CATALOG_SOURCE MALL_CATALOG_FILE=$CATALOG_JSON"
else
  echo "  api.env 已存在 MALL_CATALOG_SOURCE 配置，保留原值："
  grep -E '^MALL_CATALOG_(SOURCE|FILE)=' "$ENV_FILE"
fi

# 5. 重启服务让 env 与目录源生效（CI 走 atomic-release.sh 时可设 RESTART_SERVICE=0）
if [ "$RESTART_SERVICE" = "1" ]; then
  systemctl restart "$SERVICE"
  echo "  已重启 $SERVICE"
else
  echo "  RESTART_SERVICE!=1，跳过重启（请确认发布流程已重启服务）"
fi

echo "✓ 数据落位完成。请执行验收："
echo "    CATALOG_FILE=$CATALOG_JSON STORAGE_DIR=$STORAGE_DIR \\"
echo "      node /opt/mixmapp/deploy/catalog-verify.mjs https://www.mixm.top"
echo "  预期：healthz 的 checks.catalogSource=catalog、6 个真实中文类目、Σcount>10000、/media 200"
