#!/usr/bin/env bash
# MixmAPP 自托管站点：单文件 H5 一键切换 / 回滚脚本（在生产机以 root 执行）
#
# 切换到单文件 H5：
#   bash rollback-to-single-h5.sh --h5 /path/index.html [--sha256 <hex>] [--keep-assets] [--dry-run]
#   bash rollback-to-single-h5.sh --from-package /root/mixmapp-install-0.0.0.tar.gz [--sha256 <hex>]
# 回退到目录快照：
#   bash rollback-to-single-h5.sh --restore /root/backup-site-<YYYYMMDDHHMMSS>.tgz
#
# 安全顺序：源文件存在且非空 → sha256 校验（若给定期望值）→ 整目录快照 →
#   原子替换（先写 .tmp 再 mv）→ nginx -t → systemctl reload nginx → 五项复核。
# 任一步失败：自动从刚打的快照恢复目录，nginx -t + reload，并打印“已自动回退”。
#
# 可调环境变量：
#   SITE_DIR=/var/www/mixmapp-site   站点根目录
#   BACKUP_DIR=/root                 快照 / 旧资产存放目录
#   CHECK_HOST=cloud.mixm.top         复核用主机名
#   CHECK_RESOLVE=127.0.0.1           复核解析到的回环地址
set -euo pipefail

# ---------- 常量 ----------
SITE_DIR="${SITE_DIR:-/var/www/mixmapp-site}"
BACKUP_DIR="${BACKUP_DIR:-/root}"
CHECK_HOST="${CHECK_HOST:-cloud.mixm.top}"
CHECK_RESOLVE="${CHECK_RESOLVE:-127.0.0.1}"
INDEX_NAME="index.html"
SINGLE_MIN_BYTES=$((300 * 1024))
SINGLE_MAX_BYTES=$((500 * 1024))

# ---------- 参数 ----------
DRY_RUN=0
KEEP_ASSETS=0
H5_PATH=""
PKG_PATH=""
EXPECT_SHA=""
RESTORE_TGZ=""

usage() {
  cat <<'USAGE'
用法：
  切换：
    --h5 <路径>              显式指定单文件 HTML（与 --from-package 二选一）
    --from-package <tar.gz>  从安装包内解出 index.html 作为源
    --sha256 <期望值>        对源文件做 sha256 校验，不匹配即中止
    --keep-assets            保留 assets/、static/ 原位；默认移入备份目录
    --dry-run                只打印计划与校验，不写任何文件
  回退：
    --restore <备份tgz>      从整目录快照解包覆盖站点目录
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --h5)            H5_PATH="${2:-}"; shift 2 ;;
    --from-package)  PKG_PATH="${2:-}"; shift 2 ;;
    --sha256)        EXPECT_SHA="${2:-}"; shift 2 ;;
    --restore)       RESTORE_TGZ="${2:-}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --keep-assets)   KEEP_ASSETS=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)
      printf '[fail] 未知参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# ---------- 运行状态 ----------
MODE=""
STAMP="$(date +%Y%m%d%H%M%S)"
SRC=""
SRC_BYTES=0
SRC_SIZE_LABEL=""
SRC_SHA=""
WORKDIR=""
BACKUP_TGZ=""
BACKUP_ASSETS_DIR=""
PRE_RESTORE_TGZ=""
SNAPSHOT_READY=0
ROLLBACK_DONE=0

# ---------- 日志 / 工具 ----------
log_ok()  { printf '[ok] %s\n' "$*"; }
log_fail(){ printf '[fail] %s\n' "$*" >&2; }
log_info(){ printf '[..] %s\n' "$*"; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "缺少 sha256sum / shasum，无法做 sha256 校验"
  fi
}

file_bytes() {
  if stat -c '%s' "$1" >/dev/null 2>&1; then
    stat -c '%s' "$1"
  else
    stat -f '%z' "$1"
  fi
}

# ---------- 模式判定 ----------
if [ -n "$RESTORE_TGZ" ]; then
  MODE="restore"
elif [ -n "$H5_PATH" ] || [ -n "$PKG_PATH" ]; then
  MODE="switch"
else
  die "必须指定 --h5 <路径>、--from-package <tar.gz> 或 --restore <备份tgz>"
fi

if [ "$(id -u)" -ne 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "非 root 且为 dry-run：仅做计划与校验，不写文件"
  else
    die "请用 root 执行（sudo bash $0 ...）"
  fi
fi

# ---------- 自动回滚 ----------
restore_site_from_tgz() {
  local tgz="$1"
  if [ -z "$tgz" ] || [ ! -f "$tgz" ]; then
    log_fail "备份不存在：${tgz:-（空）}"
    return 1
  fi
  log_info "从快照恢复目录：$tgz → $SITE_DIR"
  # 仅清理本次残留的已知临时文件；不对未校验路径做 rm -rf
  if [ -f "$SITE_DIR/$INDEX_NAME.tmp" ]; then
    rm -f -- "$SITE_DIR/$INDEX_NAME.tmp"
  fi
  tar -xzf "$tgz" -C "$SITE_DIR"
  log_ok "目录已按快照恢复"
}

auto_rollback() {
  [ "$ROLLBACK_DONE" -eq 0 ] || return 0
  ROLLBACK_DONE=1
  if [ "$MODE" = "switch" ] && [ "$SNAPSHOT_READY" -eq 1 ] && [ -n "$BACKUP_TGZ" ] && [ -f "$BACKUP_TGZ" ]; then
    log_info "切换失败，自动从快照回退：$BACKUP_TGZ"
    restore_site_from_tgz "$BACKUP_TGZ" || true
    nginx -t >/dev/null 2>&1 || true
    systemctl reload nginx >/dev/null 2>&1 || true
    log_ok "已自动回退"
  elif [ "$MODE" = "restore" ] && [ -n "$PRE_RESTORE_TGZ" ] && [ -f "$PRE_RESTORE_TGZ" ]; then
    log_info "回退失败，从恢复前备份再次恢复：$PRE_RESTORE_TGZ"
    restore_site_from_tgz "$PRE_RESTORE_TGZ" || true
    systemctl reload nginx >/dev/null 2>&1 || true
    log_ok "已自动回退到恢复前状态"
  fi
}

die() {
  log_fail "$*"
  auto_rollback
  exit 1
}

on_err() {
  local rc=$?
  auto_rollback
  exit "$rc"
}
trap on_err ERR

cleanup_workdir() {
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf -- "$WORKDIR"
  fi
}
trap cleanup_workdir EXIT

# ---------- 源文件解析 ----------
resolve_source() {
  if [ -n "$PKG_PATH" ]; then
    [ -f "$PKG_PATH" ] && [ -s "$PKG_PATH" ] || die "安装包不存在或为空：$PKG_PATH"
    local member
    member="$(tar -tzf "$PKG_PATH" 2>/dev/null | grep -E '(^|/)index\.html$' | head -n1 || true)"
    [ -n "$member" ] || die "包内未找到 index.html：$PKG_PATH"
    if [ "$DRY_RUN" -eq 1 ]; then
      log_info "[dry-run] 包内候选成员：$member（不解包、不写文件）"
      SRC="$PKG_PATH::$member"
      SRC_BYTES=0
      SRC_SIZE_LABEL="（dry-run 未解包，大小待解包后确定）"
      SRC_SHA="（dry-run 未解包，跳过哈希）"
      return 0
    fi
    WORKDIR="$(mktemp -d -t mixmapp-h5.XXXXXX)"
    tar -xzf "$PKG_PATH" -C "$WORKDIR" "$member"
    SRC="$WORKDIR/$member"
  else
    SRC="$H5_PATH"
  fi
  [ -f "$SRC" ] && [ -s "$SRC" ] || die "源 H5 不存在或为空：$SRC"
  SRC_BYTES="$(file_bytes "$SRC")"
  SRC_SIZE_LABEL="${SRC_BYTES} 字节"
  SRC_SHA="$(sha256_of "$SRC")"
  log_ok "源文件存在且非空：$SRC（$SRC_SIZE_LABEL，sha256=$SRC_SHA）"
}

verify_sha256() {
  if [ -z "$EXPECT_SHA" ]; then
    log_info "未提供 --sha256，跳过期望值比对（实际 sha256=$SRC_SHA）"
    return 0
  fi
  local expect lower
  expect="$(printf '%s' "$EXPECT_SHA" | tr 'A-F' 'a-f')"
  lower="$(printf '%s' "$SRC_SHA" | tr 'A-F' 'a-f')"
  if [ "$lower" != "$expect" ]; then
    die "sha256 不匹配：期望 $expect，实际 $lower；已中止，未改动站点"
  fi
  log_ok "sha256 校验通过：$lower"
}

# ---------- 快照 ----------
take_snapshot() {
  local stamp="$1"
  BACKUP_TGZ="$BACKUP_DIR/backup-site-$stamp.tgz"
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] 将整目录快照到 $BACKUP_TGZ（不写文件）"
    return 0
  fi
  [ -d "$SITE_DIR" ] || die "站点目录不存在：$SITE_DIR"
  log_info "整目录快照：$SITE_DIR → $BACKUP_TGZ"
  tar czf "$BACKUP_TGZ" -C "$SITE_DIR" .
  SNAPSHOT_READY=1
  if [ -f "$SITE_DIR/$INDEX_NAME" ]; then
    log_ok "快照完成；原 $INDEX_NAME sha256=$(sha256_of "$SITE_DIR/$INDEX_NAME")"
  else
    log_ok "快照完成；原目录无 $INDEX_NAME"
  fi
}

# ---------- 原子替换 ----------
apply_switch() {
  local target="$SITE_DIR/$INDEX_NAME"
  local tmp="$SITE_DIR/$INDEX_NAME.tmp"

  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] 将原子替换 $target（先写 $tmp 再 mv），源 $SRC_SIZE_LABEL"
    if [ "$KEEP_ASSETS" -eq 1 ]; then
      log_info "[dry-run] --keep-assets：保留 assets/、static/ 原位"
    else
      log_info "[dry-run] 默认：assets/、static/ 将移入备份目录，不保留在站点目录"
    fi
    return 0
  fi

  cp -- "$SRC" "$tmp"
  local tmp_bytes
  tmp_bytes="$(file_bytes "$tmp")"
  [ "$tmp_bytes" = "$SRC_BYTES" ] || die "临时文件大小不符：$tmp_bytes != $SRC_BYTES"
  mv -f -- "$tmp" "$target"
  log_ok "原子替换完成：$target（${tmp_bytes} 字节）"

  if [ "$KEEP_ASSETS" -eq 0 ]; then
    BACKUP_ASSETS_DIR="$BACKUP_DIR/backup-site-$STAMP-assets"
    mkdir -p "$BACKUP_ASSETS_DIR"
    local d
    for d in assets static; do
      if [ -d "$SITE_DIR/$d" ]; then
        mv -- "$SITE_DIR/$d" "$BACKUP_ASSETS_DIR/$d"
        log_ok "已移出 $SITE_DIR/$d → $BACKUP_ASSETS_DIR/$d"
      fi
    done
  else
    log_info "保留 assets/、static/ 原位（--keep-assets）"
  fi
}

# ---------- nginx ----------
nginx_test() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] 将执行 nginx -t"
    return 0
  fi
  nginx -t
  log_ok "nginx -t 通过"
}

nginx_reload() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] 将执行 systemctl reload nginx"
    return 0
  fi
  systemctl reload nginx
  log_ok "nginx 已 reload"
}

# ---------- 五项复核 ----------
curl_code() {
  local url="$1" code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 \
    --resolve "$CHECK_HOST:443:$CHECK_RESOLVE" \
    --resolve "$CHECK_HOST:80:$CHECK_RESOLVE" "$url" 2>/dev/null || true)"
  printf '%s' "$code"
}

run_checks() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] 跳过线上五项复核"
    return 0
  fi

  local code size body_tmp

  # 1. / 200 且字节数落在单文件量级 300KB–500KB
  body_tmp="$(mktemp)"
  code="$(curl -sS -o "$body_tmp" -w '%{http_code}' --max-time 8 \
    --resolve "$CHECK_HOST:443:$CHECK_RESOLVE" \
    --resolve "$CHECK_HOST:80:$CHECK_RESOLVE" "https://$CHECK_HOST/" 2>/dev/null || true)"
  size="$(file_bytes "$body_tmp")"
  rm -f -- "$body_tmp"
  if [ "$code" = "200" ] && [ "$size" -ge "$SINGLE_MIN_BYTES" ] && [ "$size" -le "$SINGLE_MAX_BYTES" ]; then
    log_ok "GET / → $code，$size 字节（$SINGLE_MIN_BYTES–$SINGLE_MAX_BYTES 区间）"
  else
    die "复核失败：GET / → $code，$size 字节（期望 200 且 $SINGLE_MIN_BYTES–$SINGLE_MAX_BYTES 字节）"
  fi

  # 2. API 健康检查 200
  code="$(curl_code "https://$CHECK_HOST/mixmapp/api/v1/healthz")"
  [ "$code" = "200" ] || die "复核失败：/mixmapp/api/v1/healthz → $code（期望 200）"
  log_ok "GET /mixmapp/api/v1/healthz → $code"

  # 3. 已下线页面 410
  code="$(curl_code "https://$CHECK_HOST/pages/tools/ids")"
  [ "$code" = "410" ] || die "复核失败：/pages/tools/ids → $code（期望 410）"
  log_ok "GET /pages/tools/ids → $code"

  # 4. 能力矩阵 200
  code="$(curl_code "https://$CHECK_HOST/api/v1/meta")"
  [ "$code" = "200" ] || die "复核失败：/api/v1/meta → $code（期望 200）"
  log_ok "GET /api/v1/meta → $code"

  # 5. 明文 HTTP 301 跳转
  code="$(curl_code "http://$CHECK_HOST/")"
  [ "$code" = "301" ] || die "复核失败：http://$CHECK_HOST/ → $code（期望 301）"
  log_ok "GET http://$CHECK_HOST/ → $code（301 跳转）"
}

# ---------- 切换主流程 ----------
do_switch() {
  resolve_source
  verify_sha256
  take_snapshot "$STAMP"
  apply_switch
  nginx_test
  nginx_reload
  run_checks
  log_ok "单文件 H5 切换完成：$SITE_DIR/$INDEX_NAME"
  echo
  printf '本次备份：%s\n' "$BACKUP_TGZ"
  printf '回退命令：bash %s --restore %s\n' "$0" "$BACKUP_TGZ"
}

# ---------- 回退主流程 ----------
do_restore() {
  [ -f "$RESTORE_TGZ" ] && [ -s "$RESTORE_TGZ" ] || die "备份包不存在或为空：$RESTORE_TGZ"
  PRE_RESTORE_TGZ="$BACKUP_DIR/backup-site-pre-restore-$STAMP.tgz"

  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] 将先备份当前目录到 $PRE_RESTORE_TGZ，再解包 $RESTORE_TGZ 覆盖 $SITE_DIR"
    return 0
  fi

  mkdir -p "$BACKUP_DIR"
  tar czf "$PRE_RESTORE_TGZ" -C "$SITE_DIR" .
  log_ok "恢复前已备份当前目录：$PRE_RESTORE_TGZ"

  restore_site_from_tgz "$RESTORE_TGZ"
  nginx_test
  nginx_reload
  run_checks
  log_ok "回退完成：$RESTORE_TGZ"
  echo
  printf '恢复前备份：%s\n' "$PRE_RESTORE_TGZ"
  printf '再次回退命令：bash %s --restore %s\n' "$0" "$PRE_RESTORE_TGZ"
}

if [ "$MODE" = "switch" ]; then
  do_switch
else
  do_restore
fi
