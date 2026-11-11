#!/usr/bin/env bash
# 回滚到上一个 release（或指定序号：bash deploy/rollback.sh 2 表示回退两个版本）
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/mixmapp}
SERVICE=${SERVICE:-mixmapp-api}
STEPS=${1:-1}

mapfile -t RELEASES < <(ls -1dt "$APP_DIR"/releases/* 2>/dev/null)
if [ "${#RELEASES[@]}" -le "$STEPS" ]; then
  echo "✗ 没有可回滚的历史版本"
  exit 1
fi
TARGET=${RELEASES[$STEPS]}
echo "▶ 回滚到 $TARGET"
ln -sfn "$TARGET" "$APP_DIR/current"
systemctl restart "$SERVICE"
sleep 2
if curl -fsS --max-time 5 http://127.0.0.1:8080/api/v1/healthz > /dev/null; then
  echo "✓ 回滚完成且健康"
else
  echo "✗ 回滚后仍不健康，请人工介入"
  exit 1
fi
