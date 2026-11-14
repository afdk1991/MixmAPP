#!/bin/bash
# egluosi 商城目录同步入口（生产：每周日 00:00 Asia/Shanghai）
# - 加载生产 API 环境变量（DATABASE_URL_LOCAL 等）
# - flock 防重入；失败 30s 后 --resume 断点续跑一次
# - 全部输出追加到 $STATE_DIR/sync.log（超过 5MB 轮转一份）
# - 失败告警：可选 SYNC_ALERT_WEBHOOK（企业微信/钉钉文本 webhook）
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
export LANG=C.UTF-8

APP_ROOT=${APP_ROOT:-/opt/mixmapp/current}
export APP_ROOT
STATE_DIR=${SYNC_STATE_DIR:-/var/lib/mixmapp/catalog-sync}
# 传给 cli.mjs，避免状态/报告跟着启动目录落到 release 目录里
export SYNC_STATE_DIR="$STATE_DIR"
LOG="$STATE_DIR/sync.log"
mkdir -p "$STATE_DIR/reports"

if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 5242880 ]; then
  mv -f "$LOG" "$LOG.1"
fi

exec 9>"$STATE_DIR/run.lock"
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') [skip] 已有同步任务在运行" >>"$LOG"
  exit 0
fi

if [ -f /etc/mixmapp/api.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/mixmapp/api.env
  set +a
fi

CLI="$APP_ROOT/scripts/catalog/cli.mjs"

TS=$(date '+%F %T %Z')
echo "===== [$TS] catalog sync start =====" >>"$LOG"

node "$CLI" sync >>"$LOG" 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  echo "$(date '+%F %T %Z') [retry] 首次失败 code=$code，30s 后断点续跑" >>"$LOG"
  sleep 30
  node "$CLI" sync --resume >>"$LOG" 2>&1
  code=$?
fi

TS=$(date '+%F %T %Z')
if [ "$code" -eq 0 ]; then
  echo "===== [$TS] catalog sync OK =====" >>"$LOG"
else
  echo "===== [$TS] catalog sync FAILED code=$code =====" >>"$LOG"
  if [ -n "${SYNC_ALERT_WEBHOOK:-}" ]; then
    curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[mixmapp] catalog sync 失败 code=$code，详见 $LOG\"}}" \
      "$SYNC_ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
fi
exit "$code"
