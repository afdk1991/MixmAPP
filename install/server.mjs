#!/usr/bin/env node
/**
 * MixmAPP 安装向导（WordPress 式 /install）
 *
 * 设计目标：一台干净的腾讯云 CVM / 轻量应用服务器，root 执行一次引导脚本，
 * 之后全部在浏览器里点完 —— 不再需要手改 nginx、手写 .env、手工建库、手工迁移。
 *
 * 与 WordPress 的对应关系：
 *   wp-config.php           → /etc/mixmapp/api.env（600，root:root）
 *   wp-admin/install.php    → 本文件（127.0.0.1:8090，带一次性 token）
 *   wp-content/uploads      → 对象存储（COS/S3）或 /var/www/mixmapp-site
 *   wp_options              → PostgreSQL（本机或云 PG）
 *   一键镜像                → CVM 自定义镜像 / 轻量应用服务器镜像
 *
 * 安全模型：
 *   - 默认只监听 127.0.0.1，浏览器通过 SSH 隧道访问；--public 时才绑 0.0.0.0（需自行加 ACL）
 *   - 所有 /api/* 必须带 ?token= 或 x-install-token 头，token 在引导脚本里生成并写入
 *     /etc/mixmapp/install-token（600）
 *   - 安装完成后写 /etc/mixmapp/installed.lock，安装器自身拒绝一切写操作，并由引导脚本停掉服务
 *
 * 用法：
 *   node install/server.mjs --port 8090 [--dev] [--root <release 目录>]
 *   --dev 为预演模式（不写系统文件、不调 systemctl，只走完流程并打印计划），可用于本机演示
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return !v || v.startsWith('--') ? true : v;
};
const PORT = Number(argOf('port', 8090));
const DEV = Boolean(argOf('dev', false));
const PUBLIC = Boolean(argOf('public', false));
const RELEASE_ROOT = (() => {
  const raw = String(argOf('root', REPO_ROOT));
  // 安装中途会把 current 软链切到新发布的 release，这里先解析成真实路径，
  // 否则后面按 current/index.html 找 H5 会指到一个不含前端的新目录。
  try {
    return fs.realpathSync(raw);
  } catch {
    return raw;
  }
})();
/**
 * 同机演练/多站点共存用的沙箱前缀：给了 --prefix 就把 etc/releases/current/web
 * 全部收在 <prefix> 下，service 名与 nginx 站点文件也另起，避免碰到线上站点。
 */
const PREFIX = argOf('prefix', null) === true ? null : argOf('prefix', null);
const SERVICE_NAME = String(argOf('service-name', 'mixmapp-api'));
// 日志目录固定 /var/log/mixmapp；文件名按服务名派生（默认 mixmapp-api，自定义 drill 各写各的），
// 避免多实例/演练把日志追加到生产 api.log。
const LOG_DIR = '/var/log/mixmapp';
const LOG_TAG = SERVICE_NAME.replace(/[^a-zA-Z0-9_-]+/g, '-');
const NGINX_CONF = argOf('nginx-conf', null) === true ? null : argOf('nginx-conf', null);
const NGINX_LISTEN = argOf('nginx-listen', null) === true ? null : argOf('nginx-listen', null);
const H5_OVERRIDE = argOf('h5', null) === true ? null : argOf('h5', null);

// ---------- 路径（dev / 沙箱前缀 / 正式，三级） ----------
const PATHS = DEV
  ? {
      etc: path.join(os.tmpdir(), 'mixmapp-install-dev', 'etc'),
      token: path.join(os.tmpdir(), 'mixmapp-install-dev', 'etc', 'install-token'),
      lock: path.join(os.tmpdir(), 'mixmapp-install-dev', 'etc', 'installed.lock'),
      releases: path.join(os.tmpdir(), 'mixmapp-install-dev', 'opt', 'releases'),
      current: path.join(os.tmpdir(), 'mixmapp-install-dev', 'opt', 'current'),
      web: path.join(os.tmpdir(), 'mixmapp-install-dev', 'www'),
    }
  : PREFIX
    ? {
        etc: path.join(PREFIX, 'etc'),
        token: path.join(PREFIX, 'etc', 'install-token'),
        lock: path.join(PREFIX, 'etc', 'installed.lock'),
        releases: path.join(PREFIX, 'releases'),
        current: path.join(PREFIX, 'current'),
        web: path.join(PREFIX, 'www'),
      }
    : {
        etc: '/etc/mixmapp',
        token: '/etc/mixmapp/install-token',
        lock: '/etc/mixmapp/installed.lock',
        releases: '/opt/mixmapp/releases',
        current: '/opt/mixmapp/current',
        web: '/var/www/mixmapp-site',
      };

// ---------- 小工具 ----------
const run = async (file, args, opts = {}) => {
  try {
    const { stdout, stderr } = await exec(file, args, { timeout: opts.timeout ?? 120_000, maxBuffer: 8 << 20 });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message;
    return { ok: false, out, code: error.code ?? -1 };
  }
};
const sh = (script, opts) => run('bash', ['-lc', script], opts);
const exists = (p) => fs.existsSync(p);
const readToken = () => {
  try {
    return fs.readFileSync(PATHS.token, 'utf8').trim();
  } catch {
    return '';
  }
};
const installed = () => exists(PATHS.lock);

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.(?!-)[a-z0-9-]{1,63})+$/i;
const DB_URL_RE = /^postgres(?:ql)?:\/\/[^\s"'`]+$/i;
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5.-]{1,19}$/;

// ---------- 环境检查 ----------
async function checkEnv() {
  const checks = [];
  const push = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix });

  const platform = process.platform;
  push(
    '操作系统',
    platform === 'linux',
    platform === 'linux' ? `${os.type()} ${os.release()} (${os.arch()})` : `当前是 ${platform}，正式安装需要 Linux（本机可用 --dev 预演）`,
    '腾讯云 CVM 选 Ubuntu 22.04 / 24.04 或 Debian 12',
  );

  push('Node.js ≥ 20', Number(process.versions.node.split('.')[0]) >= 20, `node ${process.versions.node}`, '安装脚本会自动装 Node 22');

  const rootUser = typeof process.getuid === 'function' && process.getuid() === 0;
  push('root 权限', rootUser || DEV, rootUser ? 'uid=0' : '非 root（dev 预演放行，正式安装必须 root）', '用 sudo 执行引导脚本');

  const df = await sh("df -h / | tail -1 | awk '{print $4}'");
  const free = df.ok ? df.out.replace(/\s+/g, ' ').trim() : '';
  const freeGb = parseFloat(free) || 0;
  push('磁盘可用 ≥ 2GB', DEV || freeGb >= 2, free ? `根分区剩余 ${free}` : '无法读取磁盘信息', '扩容云硬盘或清理 /var/log');

  const nginx = await sh('nginx -v 2>&1');
  push('nginx 已安装', nginx.ok, nginx.ok ? nginx.out : '未安装', '安装脚本会 apt install nginx');

  const psql = await sh('psql --version');
  push('PostgreSQL 客户端', psql.ok, psql.ok ? psql.out : '未安装（也可只填云数据库连接串）', 'apt install postgresql-client');

  const systemd = await sh('systemctl --version | head -1');
  push('systemd 可用', systemd.ok || DEV, systemd.ok ? systemd.out : '未检测到 systemd', '轻量应用服务器/CVM 默认满足；容器内安装请改用 Docker 方案');

  const occupied = await sh("ss -lntp 2>/dev/null | grep -E ':(80|443)\\s' | wc -l");
  push('80/443 端口空闲', DEV || Number((occupied.out || '0').trim()) >= 0, 'nginx 占用 80/443 属于正常', '若被其它站点占用，安装器会与你确认是否共存');

  const certbot = await sh('certbot --version 2>&1');
  push('certbot（可选，自动签发证书）', true, certbot.ok ? certbot.out : '未安装：可先 HTTP，装完再 certbot --nginx', 'apt install certbot python3-certbot-nginx');

  return { checks, summary: { total: checks.length, failed: checks.filter((c) => !c.ok).length } };
}

// ---------- 数据库 ----------
async function testDb(url) {
  if (!DB_URL_RE.test(url)) return { ok: false, detail: '连接串格式应为 postgres://user:pass@host:5432/db' };
  if (DEV) return { ok: true, detail: '预演模式：跳过真实连接' };
  const r = await sh(`psql "${url.replace(/"/g, '')}" -v ON_ERROR_STOP=1 -c "select current_database(), version()"`);
  if (!r.ok) {
    return { ok: false, detail: r.out.split('\n').slice(-4).join(' ').slice(0, 400) };
  }
  return { ok: true, detail: r.out.split('\n')[2]?.slice(0, 120) ?? 'select 1 成功' };
}

async function provisionLocalDb({ dbName, dbUser, dbPassword }) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(dbName)) return { ok: false, detail: '库名只能是字母数字下划线' };
  if (!/^[a-z_][a-z0-9_]{0,30}$/i.test(dbUser)) return { ok: false, detail: '用户名只能是字母数字下划线' };
  if (DEV) return { ok: true, detail: '预演模式：跳过建库' };

  const pg = await sh('pg_isready -q');
  if (pg.code === 3 || !pg.ok) {
    const start = await sh('systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null; sleep 1; pg_isready -q');
    if (!start.ok) return { ok: false, detail: 'PostgreSQL 未运行：systemctl start postgresql 失败' };
  }
  // 注意：不要用 PL/pgSQL 的 $$ 包装（经 bash 传参时 $$ 会被展开成 PID），改成先查后建
  const psqlAsPostgres = (sql) => sh(`cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -tAc ${JSON.stringify(sql)}`);

  const roleExists = (await psqlAsPostgres(`select 1 from pg_roles where rolname='${dbUser}'`)).out.includes('1');
  if (!roleExists) {
    const created = await psqlAsPostgres(`create role ${dbUser} login password '${dbPassword.replace(/'/g, "''")}'`);
    if (!created.ok) return { ok: false, detail: `建角色失败：${created.out.slice(-300)}` };
  }

  const dbExists = (await psqlAsPostgres(`select 1 from pg_database where datname='${dbName}'`)).out.includes('1');
  if (!dbExists) {
    const created = await psqlAsPostgres(`create database ${dbName} owner ${dbUser}`);
    if (!created.ok) return { ok: false, detail: `建库失败：${created.out.slice(-300)}` };
  }

  return {
    ok: true,
    detail: `角色 ${dbUser} 与数据库 ${dbName} 就绪`,
    url: `postgres://${dbUser}:${encodeURIComponent(dbPassword)}@127.0.0.1:5432/${dbName}`,
  };
}

// ---------- 安装步骤 ----------
function buildEnvFile(cfg) {
  const lines = [
    '# MixmAPP 运行配置（由安装向导生成，权限 600，请勿提交到仓库）',
    'NODE_ENV=production',
    'APP_NAME=MixmAPP',
    'APP_VERSION=0.0.0.0',
    'HOST=127.0.0.1',
    `PORT=${cfg.apiPort}`,
    `PUBLIC_BASE_URL=${cfg.publicBase}`,
    `CORS_ORIGINS=${cfg.origin}`,
    `JWT_SECRET=${cfg.jwtSecret}`,
    'JWT_ACCESS_TTL_SEC=900',
    'JWT_REFRESH_TTL_DAYS=30',
    `DB_TARGET=${cfg.dbTarget}`,
    `DATABASE_URL=${cfg.databaseUrl}`,
    cfg.databaseUrlCloudbase ? `DATABASE_URL_CLOUDBASE=${cfg.databaseUrlCloudbase}` : 'DATABASE_URL_CLOUDBASE=',
    `DATABASE_URL_LOCAL=${cfg.databaseUrl}`,
    `ADMIN_TOKEN=${cfg.adminToken}`,
    'RUN_MIGRATIONS=1',
    'ALLOW_MEMORY_STORE=0',
    'ID_STRATEGY=snowflake',
    'SNOWFLAKE_WORKER_ID=0',
    'SMS_PROVIDER=console',
    'DEV_ECHO_SMS_CODE=0',
    'OAUTH_WECHAT_APP_ID=',
    'OAUTH_WECHAT_APP_SECRET=',
    'OAUTH_QQ_APP_ID=',
    'OAUTH_QQ_APP_KEY=',
    'OAUTH_GITHUB_CLIENT_ID=',
    'OAUTH_GITHUB_CLIENT_SECRET=',
    'OAUTH_APPLE_CLIENT_ID=',
    'ONEKEY_PROVIDER=dev',
    'ONEKEY_ENDPOINT=',
    'ONEKEY_APP_ID=',
    'ONEKEY_APP_SECRET=',
    'USERNAME_DENYLIST=',
    'PAY_WECHAT_APP_ID=',
    'PAY_WECHAT_MCH_ID=',
    'PAY_WECHAT_SERIAL_NO=',
    'PAY_WECHAT_PRIVATE_KEY=',
    'PAY_WECHAT_API_V3_KEY=',
    'PAY_WECHAT_PLATFORM_PUBLIC_KEY=',
    'PAY_ALIPAY_APP_ID=',
    'PAY_ALIPAY_PRIVATE_KEY=',
    'PAY_ALIPAY_PUBLIC_KEY=',
    'MAP_PROVIDER=dev',
    'AMAP_KEY=',
    'STORAGE_PROVIDER=dev',
    'S3_ENDPOINT=',
    'S3_REGION=',
    'S3_BUCKET=',
    'S3_ACCESS_KEY_ID=',
    'S3_SECRET_ACCESS_KEY=',
    'S3_PUBLIC_BASE_URL=',
    'PUSH_PROVIDER=dev',
    'JPUSH_APP_KEY=',
    'JPUSH_MASTER_SECRET=',
    'AI_PROVIDER=dev',
    'AI_BASE_URL=',
    'AI_API_KEY=',
    'AI_MODEL=',
    '',
  ];
  return lines.join('\n');
}

function nginxConf(cfg) {
  return `# MixmAPP —— 由安装向导生成（${new Date().toISOString()}）
server {
    listen ${cfg.listenLine};
    server_name ${cfg.domain};

    client_max_body_size 12m;
    server_tokens off;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json application/manifest+json image/svg+xml;

    root ${PATHS.web};
    index index.html;

    # 入口 HTML 不缓存，发版立即生效
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    # history 路由回退：/pages/mall/index 这类深链接落回 index.html
    location / {
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri/ /index.html;
    }

    # 已下线的页面（ID 试算器）：直接 410
    location = /pages/tools/ids { return 410; }
    location ^~ /pages/tools/ { return 410; }

    # 兼容单文件 H5 内置的相对基址 /api/v1（等价于 /mixmapp/api/v1）
    location /api/ {
        proxy_pass http://127.0.0.1:${cfg.apiPort}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }

    # API 反代（前缀 /mixmapp/ 被剥掉）
    location /mixmapp/ {
        proxy_pass http://127.0.0.1:${cfg.apiPort}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }

    location = /mixmapp {
        return 301 /mixmapp/;
    }
}
`;
}

const systemdUnit = () => `[Unit]
Description=MixmAPP API${SERVICE_NAME === 'mixmapp-api' ? '' : ` (${SERVICE_NAME})`}
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=mixmapp
Group=mixmapp
WorkingDirectory=${PATHS.current}
EnvironmentFile=${PATHS.etc}/api.env
ExecStart=${process.execPath} ${PATHS.current}/dist/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${PATHS.etc} ${LOG_DIR}
LimitNOFILE=65535
StandardOutput=append:${LOG_DIR}/${LOG_TAG}.log
StandardError=append:${LOG_DIR}/${LOG_TAG}.err.log

[Install]
WantedBy=multi-user.target
`;

async function install(cfg, push) {
  const log = [];
  const step = (title) => {
    log.push({ title, at: new Date().toISOString() });
    push?.(title);
    return title;
  };

  step('校验入参');
  if (!DOMAIN_RE.test(cfg.domain)) throw new Error('域名不合法');
  if (!Number.isInteger(cfg.apiPort) || cfg.apiPort < 1024 || cfg.apiPort > 65535) throw new Error('API 端口不合法');
  if (!DB_URL_RE.test(cfg.databaseUrl)) throw new Error('数据库连接串不合法');

  step(`准备目录 ${PATHS.etc}`);
  if (!DEV) {
    await fsp.mkdir(PATHS.etc, { recursive: true, mode: 0o750 });
    await fsp.mkdir(LOG_DIR, { recursive: true });
    await fsp.mkdir(PATHS.releases, { recursive: true });
    await fsp.mkdir(PATHS.web, { recursive: true });
  }

  step(`写入运行配置 ${PATHS.etc}/api.env`);
  if (!DEV) {
    await fsp.writeFile(`${PATHS.etc}/api.env`, buildEnvFile(cfg), { mode: 0o600 });
  }

  step(`发布后端到 ${PATHS.releases}/<时间戳>`);
  if (!DEV) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const target = `${PATHS.releases}/${ts}`;
    await sh(`mkdir -p ${target} && cp -a ${RELEASE_ROOT}/dist ${target}/ && cp -a ${RELEASE_ROOT}/node_modules ${target}/ 2>/dev/null || true`);
    // infra/sql 必须随 release 一起，迁移脚本按 cwd/infra/sql 查找
    await sh(`cp -a ${RELEASE_ROOT}/infra ${target}/ 2>/dev/null || true`);
    // 前端与向导也要随 release 一起，否则 current 切过去之后 H5 / 重跑向导都会丢
    await sh(`cp -a ${RELEASE_ROOT}/index.html ${target}/ 2>/dev/null || true`);
    await sh(`cp -a ${RELEASE_ROOT}/install ${RELEASE_ROOT}/scripts ${target}/ 2>/dev/null || true`);
    await sh(`ln -sfn ${target} ${PATHS.current}.tmp && mv -Tf ${PATHS.current}.tmp ${PATHS.current}`);
  }

  step('数据库结构迁移');
  const migrate = DEV
    ? { ok: true, out: '预演：将执行 node dist/db/migrate.js' }
    : await sh(`cd ${PATHS.current} && set -a && . ${PATHS.etc}/api.env && set +a && node dist/db/migrate.js`);
  if (!migrate.ok) throw new Error(`迁移失败：${migrate.out.slice(-500)}`);

  step('注册 systemd 服务');
  if (!DEV) {
    await fsp.writeFile(`/etc/systemd/system/${SERVICE_NAME}.service`, systemdUnit(), { mode: 0o644 });
    await sh(`systemctl daemon-reload && systemctl enable --now ${SERVICE_NAME}`);
  }

  step('等待 API 健康检查');
  let healthy = false;
  for (let i = 0; i < 20; i += 1) {
    if (DEV) {
      healthy = true;
      break;
    }
    const r = await sh(`curl -fsS http://127.0.0.1:${cfg.apiPort}/api/v1/healthz`);
    if (r.ok) {
      healthy = true;
      break;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  if (!healthy) throw new Error(`API 未在 30s 内就绪，请查看 ${LOG_DIR}/${LOG_TAG}.err.log`);

  step('部署前端单文件 H5');
  const h5 =
    (H5_OVERRIDE && exists(H5_OVERRIDE) ? H5_OVERRIDE : null) ??
    ['release/mixmapp-h5-single.html', 'h5/index.html', 'index.html']
      .map((p) => path.join(RELEASE_ROOT, p))
      .find(exists);
  if (!h5) throw new Error('release 里没有单文件 H5（先跑 node scripts/build-h5-single.mjs 或使用打包好的安装包）');
  if (!DEV) await fsp.copyFile(h5, `${PATHS.web}/index.html`);

  step('生成 nginx 站点并 reload');
  if (!DEV) {
    const confPath = NGINX_CONF || `/etc/nginx/conf.d/${cfg.domain}.conf`;
    await fsp.writeFile(confPath, nginxConf(cfg), { mode: 0o644 });
    const t = await sh('nginx -t');
    if (!t.ok) throw new Error(`nginx -t 失败：${t.out.slice(-400)}`);
    await sh('systemctl reload nginx');
  }

  step('按需签发 HTTPS 证书');
  if (!DEV && cfg.https && !PREFIX) {
    const cert = await sh(`certbot --nginx -n --agree-tos -m ${cfg.adminEmail} -d ${cfg.domain} --redirect`);
    if (!cert.ok) log.push({ title: `certbot 未完成（可稍后手动重试）：${cert.out.slice(-300)}` });
  }

  step('创建第一个账号');
  let account = null;
  if (!DEV) {
    const payload = JSON.stringify({ username: cfg.adminUsername, password: cfg.adminPassword, nickname: cfg.adminUsername });
    const r = await sh(
      `curl -sS -w '\\n%{http_code}' -X POST http://127.0.0.1:${cfg.apiPort}/api/v1/auth/register/username -H 'content-type: application/json' -d '${payload.replace(/'/g, "'\\''")}'`,
    );
    const code = Number((r.out.match(/(\d{3})\s*$/) ?? [])[1] ?? 0);
    if (code === 200 || code === 201) {
      account = { created: true, username: cfg.adminUsername };
    } else {
      // 账号建不起来不算装机失败，但必须把真实原因带出来（例如用户名命中保留词）
      const body = r.out.replace(/\s\d{3}\s*$/, '').trim();
      let reason = body.slice(-200);
      try {
        reason = JSON.parse(body).message ?? reason;
      } catch {}
      account = { created: false, username: cfg.adminUsername, httpCode: code, reason };
      log.push({ title: `账号未创建（HTTP ${code}）：${reason}` });
    }
  }

  step('写安装完成标记');
  if (!DEV) {
    await fsp.writeFile(
      PATHS.lock,
      JSON.stringify(
        {
          installedAt: new Date().toISOString(),
          domain: cfg.domain,
          apiPort: cfg.apiPort,
          dbTarget: cfg.dbTarget,
          webRoot: PATHS.web,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }

  return {
    log,
    summary: {
      domain: cfg.domain,
      apiPort: cfg.apiPort,
      adminToken: cfg.adminToken,
      jwtSecret: cfg.jwtSecret,
      envFile: `${PATHS.etc}/api.env`,
      webRoot: PATHS.web,
      h5Source: h5,
      nginxConf: NGINX_CONF || `/etc/nginx/conf.d/${cfg.domain}.conf`,
      service: SERVICE_NAME,
      prefix: PREFIX,
      account,
      preview: DEV,
    },
  };
}

// ---------- HTTP ----------
const UI = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
const serveUi = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(UI);
};
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1 << 20) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/install')) return serveUi(req, res);

  if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

  if (installed()) {
    return json(res, 409, {
      error: 'already-installed',
      message: '本机已安装完成。如需重装，先停掉安装器并确认迁移策略，再删除 /etc/mixmapp/installed.lock。',
    });
  }

  const provided = String(req.headers['x-install-token'] ?? url.searchParams.get('token') ?? '');
  const expected = readToken() || process.env.INSTALL_TOKEN || '';
  if (!expected) return json(res, 401, { error: 'no-token', message: '未找到安装令牌，请用 scripts/install.sh 启动安装器' });
  if (provided !== expected) return json(res, 401, { error: 'bad-token', message: '安装令牌不正确' });

  if (url.pathname === '/api/state') {
    return json(res, 200, {
      installed: installed(),
      dev: DEV,
      platform: `${os.type()} ${os.release()}`,
      node: process.versions.node,
      paths: PATHS,
    });
  }

  if (url.pathname === '/api/env/check') {
    return json(res, 200, await checkEnv());
  }

  if (url.pathname === '/api/db/test' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, await testDb(String(body.url ?? '')));
  }

  if (url.pathname === '/api/db/provision' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, await provisionLocalDb(body));
  }

  if (url.pathname === '/api/install' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = {
      domain: String(body.domain ?? '').trim().toLowerCase(),
      https: Boolean(body.https),
      apiPort: Number(body.apiPort ?? 8080),
      publicBase: `https://${body.domain}/mixmapp/api/v1`,
      origin: `https://${body.domain}`,
      databaseUrl: String(body.databaseUrl ?? ''),
      databaseUrlCloudbase: body.databaseUrlCloudbase ? String(body.databaseUrlCloudbase) : '',
      dbTarget: body.databaseUrlCloudbase ? 'cloudbase' : 'server',
      adminUsername: String(body.adminUsername ?? '').trim(),
      adminPassword: String(body.adminPassword ?? ''),
      adminEmail: String(body.adminEmail ?? ''),
      jwtSecret: crypto.randomBytes(32).toString('base64url'),
      adminToken: crypto.randomBytes(24).toString('base64url'),
      // nginx：正式默认 80 + 443 跳转，同机演练可用 --nginx-listen 127.0.0.1:8099 隔离
      listenLine: NGINX_LISTEN ?? '80;\n    listen [::]:80',
      confPath: NGINX_CONF,
    };
    if (!USERNAME_RE.test(cfg.adminUsername)) return json(res, 400, { error: '用户名需 2-20 位字母/数字/中文/下划线/点' });
    if (cfg.adminPassword.length < 8 || !/[a-zA-Z]/.test(cfg.adminPassword)) {
      return json(res, 400, { error: '密码至少 8 位且含字母' });
    }
    if (cfg.https && !cfg.adminEmail) return json(res, 400, { error: '自动签发证书需要填邮箱（用于 ACME 通知）' });
    try {
      const result = await install(cfg, null);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { error: 'install-failed', message: String(error.message ?? error) });
    }
  }

  return json(res, 404, { error: 'not found' });
});

// ---------- 启动 ----------
// 引导脚本会把 token 写进 PATHS.token；dev 模式（或运维手工启动时）缺失就现生成一个，
// 避免出现“装不了又不知道为什么”的死状态。
if (!exists(PATHS.token)) {
  await fsp.mkdir(path.dirname(PATHS.token), { recursive: true });
  await fsp.writeFile(PATHS.token, crypto.randomBytes(18).toString('base64url'), { mode: 0o600 });
}

server.listen(PORT, PUBLIC ? '0.0.0.0' : '127.0.0.1', () => {
  const token = readToken() || '(未找到 install-token)';
  console.info(`[installer] http://127.0.0.1:${PORT}/?token=${token}`);
  console.info(`[installer] mode=${DEV ? 'dev(预演)' : 'production'} release=${RELEASE_ROOT}`);
  console.info(`[installer] lock=${PATHS.lock} installed=${installed()}`);
});

