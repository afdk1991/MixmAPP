#!/bin/bash
# 商城货源同步入口（生产：每周日 00:00 Asia/Shanghai）
# - 依次跑 egluosi、hznzcn 两个货源站，各自独立：状态文件、锁、日志、失败重试互不影响
# - 任一源失败只影响自己，另一个照常跑；全部结束才汇总退出码
# - 加载生产 API 环境变量（DATABASE_URL_LOCAL 等）
# - flock 防重入；单源失败 30s 后 --resume 断点续跑一次
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

# 可用 CATALOG_SITES 覆盖（例如只跑一个源做排障）
SITES=${CATALOG_SITES:-"egluosi hznzcn"}

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

run_site() {
  local site="$1"
  local code
  echo "$(date '+%F %T %Z') ===== [$site] sync start =====" >>"$LOG"
  node "$CLI" sync --site "$site" >>"$LOG" 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "$(date '+%F %T %Z') [$site] [retry] 首次失败 code=$code，30s 后断点续跑" >>"$LOG"
    sleep 30
    node "$CLI" sync --site "$site" --resume >>"$LOG" 2>&1
    code=$?
  fi
  if [ "$code" -eq 0 ]; then
    echo "$(date '+%F %T %Z') ===== [$site] sync OK =====" >>"$LOG"
  else
    echo "$(date '+%F %T %Z') ===== [$site] sync FAILED code=$code =====" >>"$LOG"
  fi
  return "$code"
}

FAILED=""
for site in $SITES; do
  # 每个源独立执行：失败只记录，继续下一个
  run_site "$site" || FAILED="$FAILED $site"
done

TS=$(date '+%F %T %Z')
if [ -z "$FAILED" ]; then
  echo "===== [$TS] catalog sync OK（$SITES）=====" >>"$LOG"
  exit 0
fi

echo "===== [$TS] catalog sync FAILED:$FAILED =====" >>"$LOG"
if [ -n "${SYNC_ALERT_WEBHOOK:-}" ]; then
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[mixmapp] catalog sync 失败:$FAILED，详见 $LOG\"}}" \
    "$SYNC_ALERT_WEBHOOK" >/dev/null 2>&1 || true
fi
exit 1
