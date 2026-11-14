#!/usr/bin/env bash
# 原子发布：解包 → 切 symlink → 迁移 → 重启 → 健康检查，失败自动回滚。
# 用法：ARTIFACT=/tmp/api.tar.gz WEB_ARTIFACT=/tmp/web.tar.gz bash deploy/atomic-release.sh
# WEB_ARTIFACT 可选；给了就把 H5 解到 release/web，由 nginx 直接服务 current/web。
# CATALOG_ARTIFACT 可选；给了就把商品数据（catalog.json + 可选 products/ 图片）落到全局持久目录，
#   不依赖 git 追踪（.gitignore 已排除 catalog.json / source/images / storage / release）。
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/mixmapp}
ARTIFACT=${ARTIFACT:?缺少 ARTIFACT（node 产物压缩包路径）}
WEB_ARTIFACT=${WEB_ARTIFACT:-}
SERVICE=${SERVICE:-mixmapp-api}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8080/api/v1/healthz}
KEEP_RELEASES=${KEEP_RELEASES:-5}
ENV_FILE=${ENV_FILE:-/etc/mixmapp/api.env}
# 商品数据随包发布（可选）：数据落到全局持久目录，不随 release symlink 回滚。
# catalog.json 由 api.env 的 MALL_CATALOG_FILE 指向、MALL_CATALOG_SOURCE 控制接管。
CATALOG_ARTIFACT=${CATALOG_ARTIFACT:-}
CATALOG_DIR=${CATALOG_DIR:-/opt/mixmapp/prod-catalog}
STORAGE_DIR=${STORAGE_DIR:-/var/lib/mixmapp/storage}
# 发布成功后校验目录源是否接管（需 api.env 已配好两个 MALL_CATALOG_* 变量）
VERIFY_CATALOG=${VERIFY_CATALOG:-0}

# 迁移与重启都需要 api.env 里的 DATABASE_URL；systemd 的 EnvironmentFile 不会自动
# 出现在当前 shell，所以这里显式加载一次。
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

STAMP=$(date +%Y%m%d%H%M%S)
RELEASE="$APP_DIR/releases/$STAMP"
PREV=$(readlink -f "$APP_DIR/current" 2>/dev/null || true)

echo "▶ 发布 $STAMP（上一版：${PREV:-无}）"
mkdir -p "$RELEASE" "$APP_DIR/releases" /var/log/mixmapp
tar -xzf "$ARTIFACT" -C "$RELEASE"

if [ ! -f "$RELEASE/dist/index.js" ]; then
  echo "✗ 产物缺少 dist/index.js"
  exit 1
fi

# H5 与 API 同版本发布：先解包并校验入口，缺入口就直接失败，不切 symlink。
if [ -n "$WEB_ARTIFACT" ]; then
  mkdir -p "$RELEASE/web"
  tar -xzf "$WEB_ARTIFACT" -C "$RELEASE/web"
  if [ ! -f "$RELEASE/web/index.html" ]; then
    echo "✗ H5 产物缺少 web/index.html"
    exit 1
  fi
  echo "▶ H5 已解包到 $RELEASE/web"
fi

# 商品数据落位（可选）：gitignore 排除了 catalog.json / source/images / storage / release，
# CI checkout 默认没有这份数据，必须由发布链路显式携带；缺数据会静默降级到只剩 6 条演示品。
# 放在切 symlink 之前：数据不合法就直接失败、不切版本。数据目录是全局持久的，回滚代码不影响它。
if [ -n "$CATALOG_ARTIFACT" ]; then
  if [ ! -f "$CATALOG_ARTIFACT" ]; then
    echo "✗ 指定了 CATALOG_ARTIFACT 但文件不存在：$CATALOG_ARTIFACT"
    exit 1
  fi
  mkdir -p "$CATALOG_DIR"
  tar -xzf "$CATALOG_ARTIFACT" -C "$CATALOG_DIR"
  # 兼容两种打包结构：平铺（tar -C release/prod-catalog .）或带一层目录（tar -C release prod-catalog）。
  # 后者解包后 catalog.json 落在 $CATALOG_DIR/prod-catalog/，这里展平到 $CATALOG_DIR。
  if [ ! -f "$CATALOG_DIR/catalog.json" ] && [ -f "$CATALOG_DIR/prod-catalog/catalog.json" ]; then
    cp -a "$CATALOG_DIR/prod-catalog"/. "$CATALOG_DIR"/
    echo "▶ 已展平带一层 prod-catalog/ 目录的数据包"
  fi
  if [ ! -f "$CATALOG_DIR/catalog.json" ]; then
    echo "✗ 数据包缺少 catalog.json（解包目录：$CATALOG_DIR）"
    exit 1
  fi
  if ! node -e 'const fs=require("node:fs");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!Array.isArray(c.products)||!c.products.length)process.exit(1)' "$CATALOG_DIR/catalog.json"; then
    echo "✗ catalog.json 无法解析或 products 为空"
    exit 1
  fi
  echo "▶ catalog.json 已落位 $CATALOG_DIR/catalog.json"
  # 幂等配置 api.env（systemd 重启后生效）：目录源模式 + 数据文件绝对路径。
  # 已配置则不覆盖，避免冲掉运维自定义值；生产 admin 面 404 时目录源是唯一数据通路。
  if [ -f "$ENV_FILE" ] && ! grep -qE '^MALL_CATALOG_SOURCE=' "$ENV_FILE"; then
    printf '\nMALL_CATALOG_SOURCE=%s\nMALL_CATALOG_FILE=%s\n' \
      "${MALL_CATALOG_SOURCE:-force}" "$CATALOG_DIR/catalog.json" >> "$ENV_FILE"
    echo "▶ api.env 已配置 MALL_CATALOG_SOURCE / MALL_CATALOG_FILE"
  fi
  # 数据包内若自带 products/（catalog-lead 定稿目录，872 张 <sha1>.jpg）或历史 images/，
  # 统一同步到 STORAGE_DIR/products/ 并放开 nginx 读权限，正好命中 /media/products/<sha1>.jpg。
  IMG_SRC=""
  for d in "$CATALOG_DIR/products" "$CATALOG_DIR/images"; do
    [ -d "$d" ] && IMG_SRC="$d" && break
  done
  if [ -n "$IMG_SRC" ]; then
    mkdir -p "$STORAGE_DIR/products"
    cp -a "$IMG_SRC"/. "$STORAGE_DIR/products"/
    if id -u www-data >/dev/null 2>&1; then
      chgrp -R www-data "$STORAGE_DIR" 2>/dev/null || true
      chmod -R o+rX "$STORAGE_DIR" || true
      chmod o+rx /var/lib/mixmapp 2>/dev/null || true
    fi
    IMG_COUNT=$(find "$STORAGE_DIR/products" -type f | wc -l)
    echo "▶ 商品图片已同步到 $STORAGE_DIR/products/（$IMG_COUNT 个文件）"
    if [ "$IMG_COUNT" -lt "${MIN_IMAGES:-871}" ]; then
      echo "✗ 商品图片数不足：$IMG_COUNT < ${MIN_IMAGES:-871}"
      exit 1
    fi
  fi
fi

ln -sfn "$RELEASE" "$APP_DIR/current"

# 版本号写回 api.env（幂等）：线上 /healthz 与 /meta 报出的 version 取自 APP_VERSION，
# 不写回就会一直沿用旧值（曾长期显示 0.0.0-preview，与产物版本脱节）。
# 取值顺序：显式传入 APP_VERSION > 产物内 version.json > 当前 release 的 version.json。
# 只覆盖 APP_VERSION 这一行，其余运维配置不动；解析不出就保留原值并告警。
if [ -z "${APP_VERSION:-}" ]; then
  for f in "$RELEASE/version.json" "$APP_DIR/current/version.json"; do
    if [ -f "$f" ]; then
      APP_VERSION=$(node -e 'const v=require(process.argv[1]);const formal=["stable","release"].includes(v.channel);const pub=v.channel==="release"&&Array.isArray(v.released)&&v.released.length?v.released[v.released.length-1]:null;process.stdout.write(pub||(v.next+(formal?"":"-"+v.channel)));' "$f" 2>/dev/null || true)
      [ -n "${APP_VERSION:-}" ] && break
    fi
  done
fi
if [ -n "${APP_VERSION:-}" ] && [ -f "$ENV_FILE" ]; then
  PREV_APP_VERSION=$(grep -E '^APP_VERSION=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)
  if grep -qE '^APP_VERSION=' "$ENV_FILE"; then
    sed -i "s|^APP_VERSION=.*|APP_VERSION=$APP_VERSION|" "$ENV_FILE"
  else
    printf '\nAPP_VERSION=%s\n' "$APP_VERSION" >> "$ENV_FILE"
  fi
  echo "▶ api.env APP_VERSION=$APP_VERSION"
else
  echo "⚠ 未能确定 APP_VERSION，沿用 api.env 现值"
fi

echo "▶ 执行数据库迁移"
(cd "$APP_DIR/current" && node dist/db/migrate.js)

echo "▶ 重启服务"
systemctl restart "$SERVICE"

echo "▶ 等待健康检查"
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 "$HEALTH_URL" > /tmp/mixmapp-health.json; then
    echo "✓ 健康检查通过"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "✗ 健康检查失败，开始回滚"
    if [ -n "$PREV" ]; then
      ln -sfn "$PREV" "$APP_DIR/current"
      # 版本号同步回滚，避免旧代码报新版本号
      if [ -n "${PREV_APP_VERSION:-}" ]; then
        sed -i "s|^APP_VERSION=.*|APP_VERSION=$PREV_APP_VERSION|" "$ENV_FILE"
      fi
      systemctl restart "$SERVICE"
      echo "已回滚到 $PREV"
    fi
    exit 1
  fi
  sleep 1
done

# 可选：目录源接管验收。放在健康检查之后，不改上面的回滚逻辑；
# 失败只以非零退出并给出指引，代码版本已发布，按 deploy/CATALOG-DEPLOY.md 处理或 rollback.sh 回退。
if [ "$VERIFY_CATALOG" = "1" ]; then
  echo "▶ 校验 catalog 目录源是否接管"
  if curl -fsS --max-time 5 "$HEALTH_URL" > /tmp/mixmapp-catalog-health.json && \
     grep -q '"catalogSource":"catalog"' /tmp/mixmapp-catalog-health.json; then
    echo "✓ catalog 目录源已接管"
  else
    echo "✗ catalog 目录源未生效：检查 api.env 的 MALL_CATALOG_SOURCE / MALL_CATALOG_FILE 与数据文件"
    exit 1
  fi
fi

# 只保留最近 N 个版本
ls -1dt "$APP_DIR"/releases/* | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

echo "✓ 发布完成：$RELEASE"
