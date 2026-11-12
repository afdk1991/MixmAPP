#!/usr/bin/env bash
# 数据库落点开关：cloudbase = 权威云 PG，local = 云服务器本机 PG。
# 两个连接串同时存在于 api.env，切 DB_TARGET 后重启服务；健康检查不通过会自动切回。
# 用法：sudo bash deploy/db-target.sh [status|cloudbase|local]
set -euo pipefail

ENV_FILE=${ENV_FILE:-/etc/mixmapp/api.env}
SERVICE=${SERVICE:-mixmapp-api}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8080/healthz}
ACTION=${1:-status}

current_target() {
  grep -E '^DB_TARGET=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true
}

has_var() {
  local name="$1"
  grep -qE "^${name}=.+" "$ENV_FILE"
}

show_health() {
  curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | head -c 800 || echo '(健康检查不可用)'
  echo
}

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 找不到 $ENV_FILE（可用 ENV_FILE=... 指定）"
  exit 1
fi

case "$ACTION" in
  status)
    echo "ENV_FILE=$ENV_FILE"
    echo "DB_TARGET=$(current_target || echo '(未设置，代码默认 cloudbase)')"
    if has_var DATABASE_URL_CLOUDBASE; then echo "DATABASE_URL_CLOUDBASE=已配置"; else echo "DATABASE_URL_CLOUDBASE=未配置"; fi
    if has_var DATABASE_URL_LOCAL; then echo "DATABASE_URL_LOCAL=已配置"; else echo "DATABASE_URL_LOCAL=未配置"; fi
    if has_var DATABASE_URL; then echo "DATABASE_URL=已配置（兜底）"; else echo "DATABASE_URL=未配置"; fi
    echo "--- 当前线上健康检查 ---"
    show_health
    exit 0
    ;;

  cloudbase|local)
    if [ "$ACTION" = cloudbase ] && ! has_var DATABASE_URL_CLOUDBASE; then
      echo "✗ DATABASE_URL_CLOUDBASE 未配置，无法切到云 PG。先写入 $ENV_FILE 再重试。"
      exit 1
    fi
    if [ "$ACTION" = local ] && ! has_var DATABASE_URL_LOCAL; then
      echo "✗ DATABASE_URL_LOCAL 未配置，无法切到本机 PG。先写入 $ENV_FILE 再重试。"
      exit 1
    fi

    PREV=$(current_target || true)
    cp -a "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
    if grep -qE '^DB_TARGET=' "$ENV_FILE"; then
      sed -i "s/^DB_TARGET=.*/DB_TARGET=$ACTION/" "$ENV_FILE"
    else
      printf '\nDB_TARGET=%s\n' "$ACTION" >> "$ENV_FILE"
    fi
    echo "▶ DB_TARGET: ${PREV:-cloudbase(默认)} → $ACTION"

    systemctl restart "$SERVICE"
    for i in $(seq 1 25); do
      if curl -fsS --max-time 3 "$HEALTH_URL" >/tmp/mixmapp-dbtarget-health.json 2>/dev/null; then
        if grep -q "\"dbTarget\":\"$ACTION\"" /tmp/mixmapp-dbtarget-health.json; then
          echo "✓ 已切到 $ACTION 并通过健康检查"
          show_health
          exit 0
        fi
      fi
      sleep 1
    done

    echo "✗ 切到 $ACTION 后健康检查未通过，回滚到 ${PREV:-cloudbase}"
    if [ -n "${PREV:-}" ]; then
      sed -i "s/^DB_TARGET=.*/DB_TARGET=$PREV/" "$ENV_FILE"
    else
      sed -i '/^DB_TARGET=/d' "$ENV_FILE"
    fi
    systemctl restart "$SERVICE"
    sleep 2
    show_health
    exit 1
    ;;

  *)
    echo "用法：sudo bash deploy/db-target.sh [status|cloudbase|local]"
    exit 2
    ;;
esac
