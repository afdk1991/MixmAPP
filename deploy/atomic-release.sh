#!/usr/bin/env bash
# 原子发布：解包 → 切 symlink → 迁移 → 重启 → 健康检查，失败自动回滚。
# 用法：ARTIFACT=/tmp/api.tar.gz bash deploy/atomic-release.sh
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/mixmapp}
ARTIFACT=${ARTIFACT:?缺少 ARTIFACT（node 产物压缩包路径）}
SERVICE=${SERVICE:-mixmapp-api}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8080/api/v1/healthz}
KEEP_RELEASES=${KEEP_RELEASES:-5}

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

ln -sfn "$RELEASE" "$APP_DIR/current"

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
      systemctl restart "$SERVICE"
      echo "已回滚到 $PREV"
    fi
    exit 1
  fi
  sleep 1
done

# 只保留最近 N 个版本
ls -1dt "$APP_DIR"/releases/* | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

echo "✓ 发布完成：$RELEASE"
