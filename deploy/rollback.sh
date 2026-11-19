#!/usr/bin/env bash
# 回滚到上一个 release（或指定序号：bash deploy/rollback.sh 2 表示回退两个版本）
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/mixmapp}
SERVICE=${SERVICE:-mixmapp-api}
ENV_FILE=${ENV_FILE:-/etc/mixmapp/api.env}
STEPS=${1:-1}

mapfile -t RELEASES < <(ls -1dt "$APP_DIR"/releases/* 2>/dev/null)
if [ "${#RELEASES[@]}" -le "$STEPS" ]; then
  echo "✗ 没有可回滚的历史版本"
  exit 1
fi
TARGET=${RELEASES[$STEPS]}
echo "▶ 回滚到 $TARGET"
ln -sfn "$TARGET" "$APP_DIR/current"

# 版本号同步回滚目标包：代码切回旧版后，env 里的 APP_VERSION 必须随之回退，
# 否则进程会沿用 env 旧号/新号，与实际运行代码版本脱节。口径与 atomic-release.sh 一致。
ROLLBACK_VERSION=""
if [ -f "$TARGET/version.json" ]; then
  ROLLBACK_VERSION=$(node -e 'const v=require(process.argv[1]);const base=String(v.version??"0.0.0");const ch=String(v.channel??"release");if(ch==="release"){process.stdout.write(base)}else{const n=Number((v.counters??{})[ch]??0);process.stdout.write(base+"-"+ch+(n>0?"."+n:""))}' "$TARGET/version.json" 2>/dev/null || true)
fi
if [ -n "$ROLLBACK_VERSION" ] && [ -f "$ENV_FILE" ]; then
  if grep -qE '^APP_VERSION=' "$ENV_FILE"; then
    sed -i "s|^APP_VERSION=.*|APP_VERSION=$ROLLBACK_VERSION|" "$ENV_FILE"
  else
    printf '\nAPP_VERSION=%s\n' "$ROLLBACK_VERSION" >> "$ENV_FILE"
  fi
  echo "▶ api.env APP_VERSION=$ROLLBACK_VERSION（随回滚目标包）"
fi

systemctl restart "$SERVICE"
sleep 2
if curl -fsS --max-time 5 http://127.0.0.1:8080/api/v1/healthz > /dev/null; then
  echo "✓ 回滚完成且健康"
else
  echo "✗ 回滚后仍不健康，请人工介入"
  exit 1
fi
