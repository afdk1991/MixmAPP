#!/usr/bin/env bash
#
# install-wizard-service.sh — MixmAPP 安装向导「独立常驻」systemd 单元管理脚本
#
# 与 /opt/mixmapp/current 解耦：向导脚本/页面固定落在 /opt/mixmapp/installer/，
# 不再依赖某次 release 里是否打包了 install/；本脚本只落 unit 文件，
# 默认不 enable、不 start（本机已存在 /etc/mixmapp/installed.lock 时向导本身也会拒写）。
#
# 子命令：
#   --print            只打印将要写入的 unit 内容与将要执行的命令，不落盘
#   install            写 unit、daemon-reload；不 enable、不 start
#   status             systemctl status + systemctl cat + 8090 端口占用归属
#   remove             停 → disable → 删 unit → daemon-reload（仅在确已停止时删）
#
# 用法：
#   sudo bash install-wizard-service.sh --print
#   sudo bash install-wizard-service.sh install
#   sudo bash install-wizard-service.sh status
#   sudo bash install-wizard-service.sh remove
set -euo pipefail

UNIT_NAME="mixmapp-installer-standalone"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}.service"
INSTALLER_DIR="/opt/mixmapp/installer"
SERVER_JS="${INSTALLER_DIR}/server.mjs"
UI_HTML="${INSTALLER_DIR}/ui.html"
TOKEN_FILE="/etc/mixmapp/install-token"
WIZARD_PORT="${MIXMAPP_INSTALL_PORT:-8090}"
RELEASE_ROOT="/opt/mixmapp/current"
NODE_BIN="$(command -v node 2>/dev/null || true)"
[ -n "${NODE_BIN}" ] || NODE_BIN="/usr/bin/node"

log()  { printf '[installer-unit] %s\n' "$*"; }
warn() { printf '[installer-unit][warn] %s\n' "$*" >&2; }
die()  { printf '[installer-unit][fail] %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "请用 root 执行（sudo bash 脚本名 子命令）"
}

render_unit() {
  cat <<UNIT
[Unit]
Description=MixmAPP 安装向导（独立常驻，不随 release 切换）
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALLER_DIR}
# 参数与 install/server.mjs 源码严格对应：--port 监听端口；--root 指定取 dist/node_modules/infra 的 release 根目录。
# 不传 --public，默认绑定 127.0.0.1（见 server.mjs 的 server.listen 逻辑）。
ExecStart=${NODE_BIN} ${SERVER_JS} --port ${WIZARD_PORT} --root ${RELEASE_ROOT}
Restart=on-failure
RestartSec=2
# 安装令牌由 server.mjs 直接读取 ${TOKEN_FILE}（600, root:root），不写入 unit 或 Environment，避免明文落盘。
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
}

token_status() {
  # 只显示路径/属主/权限/大小，绝不打印令牌明文
  if [ -f "${TOKEN_FILE}" ]; then
    local perm owner size
    perm="$(stat -c '%a' "${TOKEN_FILE}")"
    owner="$(stat -c '%U:%G' "${TOKEN_FILE}")"
    size="$(stat -c '%s' "${TOKEN_FILE}")"
    log "令牌文件：${TOKEN_FILE} 权限=${perm} 属主=${owner} 大小=${size}B（内容不显示）"
  else
    warn "令牌文件不存在：${TOKEN_FILE}（向导首次启动时会自行生成一个 600 令牌）"
  fi
}

cmd_print() {
  log "== 将写入的 unit：${UNIT_PATH} =="
  render_unit
  log ""
  log "== install 子命令将依次执行（--print 不落盘）=="
  cat <<CMDS
  1. 备份已有 unit（若存在）：cp -a ${UNIT_PATH} /root/backup-unit-${UNIT_NAME}-<ts>.service
  2. 写入 unit：${UNIT_PATH}
  3. systemctl daemon-reload
  （不执行 systemctl enable，不执行 systemctl start）
CMDS
  token_status
  [ -f "${SERVER_JS}" ] || warn "未发现 ${SERVER_JS}（install 前请先把 HEAD 的 install/ 落到 ${INSTALLER_DIR}）"
}

cmd_install() {
  require_root
  [ -f "${SERVER_JS}" ] || die "缺少 ${SERVER_JS}，请先部署向导文件到 ${INSTALLER_DIR}"
  [ -f "${UI_HTML}" ] || die "缺少 ${UI_HTML}"
  [ -x "${NODE_BIN}" ] || die "找不到 node（${NODE_BIN}）"

  local ts="$(date +%Y%m%d%H%M%S)"
  if [ -f "${UNIT_PATH}" ]; then
    local backup="/root/backup-unit-${UNIT_NAME}-${ts}.service"
    cp -a "${UNIT_PATH}" "${backup}"
    log "已备份旧 unit → ${backup}"
  fi

  local tmp="${UNIT_PATH}.tmp.$$"
  render_unit > "${tmp}"
  install -m 0644 "${tmp}" "${UNIT_PATH}"
  rm -f -- "${tmp}"
  log "unit 已写入：${UNIT_PATH}"

  systemctl daemon-reload
  log "daemon-reload 完成；未 enable、未 start（按要求保持 inactive）"
  token_status
  log "需要复装时再手动启动：systemctl start ${UNIT_NAME}"
}

cmd_status() {
  log "== systemctl status ${UNIT_NAME} =="
  systemctl status "${UNIT_NAME}" --no-pager --lines=10 || warn "unit 未处于 active（inactive / not-found 均属正常）"
  log ""
  log "== systemctl cat ${UNIT_NAME} =="
  systemctl cat "${UNIT_NAME}" || warn "未找到 unit 文件：${UNIT_PATH}"
  log ""
  log "== 端口 ${WIZARD_PORT} 占用归属 =="
  local listeners
  listeners="$(ss -lntp 2>/dev/null | grep ":${WIZARD_PORT}[[:space:]]" || true)"
  if [ -z "${listeners}" ]; then
    log "127.0.0.1:${WIZARD_PORT} 当前无监听者（空闲）"
  else
    printf '%s\n' "${listeners}"
    local pid
    pid="$(printf '%s\n' "${listeners}" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
    if [ -n "${pid}" ]; then
      local cg
      cg="$(cat /proc/${pid}/cgroup 2>/dev/null || true)"
      case "${cg}" in
        *"${UNIT_NAME}"*) log "监听者属于本单元：${UNIT_NAME} (pid=${pid})" ;;
        *) warn "监听者 pid=${pid} 不属于本单元（cgroup：${cg:-未知}），属其它会话/进程，本脚本不处置" ;;
      esac
    fi
  fi
}

cmd_remove() {
  require_root
  # 路径强校验，防止误删
  [ "${UNIT_PATH}" = "/etc/systemd/system/${UNIT_NAME}.service" ] || die "unit 路径校验失败：${UNIT_PATH}"

  if systemctl list-unit-files "${UNIT_NAME}.service" 2>/dev/null | grep -q "${UNIT_NAME}"; then
    log "停止单元（若在运行）…"
    systemctl stop "${UNIT_NAME}" 2>/dev/null || true
    if systemctl is-active --quiet "${UNIT_NAME}" 2>/dev/null; then
      die "单元仍处于 active，拒绝删除 unit 文件"
    fi
    systemctl disable "${UNIT_NAME}" 2>/dev/null || true
  else
    log "未发现已安装的单元，跳过 stop/disable"
  fi

  if [ -f "${UNIT_PATH}" ]; then
    rm -f -- "${UNIT_PATH}"
    log "已删除 unit：${UNIT_PATH}"
  else
    log "unit 文件不存在：${UNIT_PATH}"
  fi
  systemctl daemon-reload
  log "remove 完成"
}

case "${1:-}" in
  --print|-p) cmd_print ;;
  install)    cmd_install ;;
  status)      cmd_status ;;
  remove)      cmd_remove ;;
  ""|help|-h|--help)
    sed -n '2,20p' "$0" ;;
  *) die "未知子命令：$1（可用：--print | install | status | remove）" ;;
esac
