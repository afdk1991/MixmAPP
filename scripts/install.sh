#!/usr/bin/env bash
# MixmAPP 安装引导（在腾讯云 CVM / 轻量应用服务器上以 root 执行）
#
#   bash install.sh                 # 用同目录的 mixmapp-install.tar.gz
#   bash install.sh /path/app.tar.gz
#
# 它只做“装运行时 + 解包 + 起向导”这一段；建库、写配置、发证书、起服务都在浏览器里完成，
# 对应 WordPress 的 wp-admin/install.php。
set -euo pipefail

PKG="${1:-$(dirname "$0")/mixmapp-install.tar.gz}"
PORT="${MIXMAPP_INSTALL_PORT:-8090}"

log() { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 root 执行（sudo bash install.sh）"
[ -f "$PKG" ] || die "找不到安装包：$PKG"

# ---------- 1. 系统依赖 ----------
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  log "安装系统依赖（nginx / postgresql / certbot）"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg nginx postgresql postgresql-client \
    certbot python3-certbot-nginx tar >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  log "安装系统依赖（dnf）"
  dnf install -y nginx postgresql-server postgresql certbot tar >/dev/null
else
  die "只支持 apt/dnf 系发行版；其它系统请用 Docker 方案"
fi

# ---------- 2. Node 22 ----------
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  log "安装 Node.js 22（NodeSource）"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "node $(node -v)"

# ---------- 3. 解包 ----------
TS="$(date +%Y%m%d%H%M%S)"
REL="/opt/mixmapp/releases/$TS"
log "解包到 $REL"
mkdir -p "$REL" /opt/mixmapp /etc/mixmapp /var/log/mixmapp /var/www/mixmapp-site
tar -xzf "$PKG" -C "$REL"
ln -sfn "$REL" /opt/mixmapp/current

id mixmapp >/dev/null 2>&1 || useradd -r -m -d /var/lib/mixmapp -s /bin/bash mixmapp
chown -R mixmapp:mixmapp /opt/mixmapp "$REL" 2>/dev/null || true
chown -R mixmapp:mixmapp /var/log/mixmapp
chmod 750 /etc/mixmapp

# ---------- 4. 安装令牌 ----------
TOKEN_FILE=/etc/mixmapp/install-token
if [ ! -f "$TOKEN_FILE" ]; then
  head -c 24 /dev/urandom | base64 | tr -d '\n=+/' > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"

# ---------- 5. 向导服务 ----------
cat >/etc/systemd/system/mixmapp-installer.service <<UNIT
[Unit]
Description=MixmAPP 安装向导
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mixmapp/current
Environment=INSTALL_TOKEN=$TOKEN
ExecStart=$(command -v node) /opt/mixmapp/current/install/server.mjs --port $PORT --root /opt/mixmapp/current
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now mixmapp-installer >/dev/null
sleep 1

IP="$(curl -fsS -m 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<MSG

────────────────────────────────────────────────────────
 安装向导已启动（只监听 127.0.0.1:$PORT，外网不可直达）

 ① 本机已开浏览器：直接打开
    http://127.0.0.1:$PORT/?token=$TOKEN

 ② 你在自己电脑上操作，先建隧道再打开：
    ssh -L $PORT:127.0.0.1:$PORT root@$IP
    然后浏览器打开 http://127.0.0.1:$PORT/?token=$TOKEN

 装完向导会自动写 /etc/mixmapp/installed.lock 并停止本服务。
 安装日志： journalctl -u mixmapp-installer -f
────────────────────────────────────────────────────────
MSG
