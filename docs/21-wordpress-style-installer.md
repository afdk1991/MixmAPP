# 17 · 像 WordPress 一样安装 MixmAPP

目标：一台**干净的腾讯云服务器**（CVM 或轻量应用服务器），运维只会两件事 ——
`bash install.sh`，然后在浏览器里点完 5 步。装完就有：入口首页、后端 API、PostgreSQL、nginx、HTTPS、第一个账号。
不需要 SSH 进去改配置，也不需要知道 `pnpm`、`tsup`、`drizzle` 是什么。

本文对应仓库里已经落地的实现：

| 文件 | 作用 | WordPress 对应物 |
|---|---|---|
| `scripts/install.sh` | 装运行时、解包、起向导 | 上传 zip + 打开 `wp-admin/install.php` |
| `install/server.mjs` | 向导后端（零依赖 Node 服务） | `install.php` 的 `wp_install()` |
| `install/ui.html` | 向导前端（5 步） | `install.php` 的表单页 |
| `scripts/package-installer.mjs` | 打安装包 `mixmapp-install-<ver>.tar.gz` | 官方 zip 发行包 |
| `/etc/mixmapp/api.env` | 运行配置（600） | `wp-config.php` |
| `/etc/mixmapp/installed.lock` | 装完标记，向导自动失效 | `wp-config.php` 里的 `WP_INSTALLING` 消失 |
| `infra/sql/*.sql` | 库结构 | WordPress 的 `wp-admin/includes/schema.php` |

---

## 1. 为什么不能直接照抄 WordPress

WordPress 能“传到虚拟主机 → 打开 install.php”，是因为它运行在 **PHP + MySQL** 上，而虚拟主机天生带这两样。
MixmAPP 是 **uni-app H5 单文件 + Fastify(Node) + PostgreSQL**，没有 Node 运行时的空间放不了。

所以要做同一件事，只能把“运行时”这一层也包进来。三种形态，按运维能力从低到高：

| 形态 | 用户体验 | 适合 | 本仓库状态 |
|---|---|---|---|
| **A. 引导脚本 + 浏览器向导** | `bash install.sh` → 点 5 步 | 单台 CVM / 轻量应用服务器，长期运营 | ✅ 已实现 |
| **B. Docker Compose 一键** | `docker compose up -d` | 多实例、容器化运维、CI 发版 | ⏳ 未做（见第 8 节） |
| **C. 云市场镜像 / 自定义镜像** | 买机器时选“MixmAPP 镜像”，开机即向导 | 对外售卖、批量交付、白标客户 | ⏳ 需要做镜像（第 7 节） |

A 是最短路径，也是 B、C 的地基：镜像里跑的其实就是 A。

---

## 2. 安装链路的责任划分

```
你（root）
  └─ bash install.sh mixmapp-install-0.0.0.tar.gz
       ├─ apt 装 nginx / postgresql / certbot，Node 22（缺才装）
       ├─ 解包到 /opt/mixmapp/releases/<时间戳>，做 current 软链
       ├─ 写 /etc/mixmapp/install-token（600，一次性令牌）
       └─ 起 mixmapp-installer.service → 只监听 127.0.0.1:8090
             │
             └─ 浏览器（SSH 隧道）打开 http://127.0.0.1:8090/?token=…
                  1 环境检查   → 9 项体检，红项给修复命令
                  2 数据库     → 本机代建库/角色 or 填云 PG 连接串，测通
                  3 站点与账号 → 域名、API 端口、第一个账号、要不要证书
                  4 安装       → 写 api.env → 发布后端 → 迁移 → systemd → 健康检查
                                 → 部署 H5 → nginx 站点 → certbot → 建账号 → 写 lock
                  5 完成       → 给出 adminToken / 配置路径 / 站点地址
```

安装器做的每件事都是**幂等且可复跑**的：目录已存在就复用，软链原子切换，`nginx -t` 通过才 reload。

---

## 3. 向导 5 步具体做什么

### 第 1 步 · 环境检查
9 项：操作系统、Node 版本、root、磁盘、nginx、psql 客户端、systemd、80/443 占用、certbot。
红项不是“报错”，而是带上修复命令（`apt install ...`），因为引导脚本已经把这批包装好了。

### 第 2 步 · 数据库
两条路：

- **本机 PostgreSQL**：向导执行
  ```sql
  create role mixmapp login password '…';
  create database mixmapp owner mixmapp;
  ```
  然后自动 `psql "…" -c "select 1"` 验证，把连接串回填到下一步。
- **云数据库**（腾讯云 PG / Neon / Supabase）：直接填 `postgres://…`，点“只测已有连接串”。

> 生产上推荐云 PG（跨可用区、自动备份）；单机自建 PG 适合预算有限的起步期。
> 仓库的 `DB_TARGET` 机制支持两套连接串并存（`DATABASE_URL_CLOUDBASE` / `DATABASE_URL_LOCAL`），
> 装完还能用 `POST /api/v1/admin/db/switch` 热切换，不用改配置文件。

### 第 3 步 · 站点与账号
- 域名：必须已解析到本机（`A` 记录）。安装器只信域名，不猜 IP。
- API 内部端口：默认 8080，只监听 127.0.0.1，不对外暴露。
- 第一个账号：走真实注册接口 `POST /api/v1/auth/register/username`，因此账号体系、发号器（`accountNo`）、
  JWT 全按线上逻辑生成，不是塞一条假数据进库。
- HTTPS：勾选则 `certbot --nginx -n --agree-tos -m <邮箱> -d <域名> --redirect`。

### 第 4 步 · 安装（真正的“装”）
顺序固定，任一步失败即中止并返回日志尾部：

1. 写 `/etc/mixmapp/api.env`（600）：随机 `JWT_SECRET`（32B）、随机 `ADMIN_TOKEN`、`DATABASE_URL`、
   `DB_TARGET`、`CORS_ORIGINS=https://<域名>`、`RUN_MIGRATIONS=1`、`NODE_ENV=production`。
2. 发布后端：`/opt/mixmapp/releases/<ts>/{dist,node_modules,infra}` + 原子软链 `current`。
3. 迁移：`node dist/db/migrate.js`（带 env，读 `infra/sql`，按文件名顺序执行，已执行过的跳过）。
4. systemd：写 `mixmapp-api.service`（User=mixmapp、`ProtectSystem=strict`、日志追加）
   → `daemon-reload` → `enable --now`。
5. 健康检查：轮询 `http://127.0.0.1:<port>/api/v1/healthz`，最长 30s。
6. 部署 H5：把单文件 `index.html` 覆盖到 `/var/www/mixmapp-site/index.html`。
7. nginx：渲染站点配置（`root`、`/assets/` 长缓存、`index.html` 不缓存、history 回退、`/mixmapp/` 反代）
   → `nginx -t` → `reload`。
8. 证书（可选）。
9. 建第一个账号。
10. 写 `installed.lock`：`{installedAt, domain, apiPort, dbTarget, webRoot}`。

### 第 5 步 · 完成
页面输出 `adminToken`、`jwtSecret`、配置路径、站点地址，并提示“安装器已关闭”。

---

## 4. 安全设计（这几条不能省）

| 风险 | 处理 |
|---|---|
| 安装页被公网扫到 | 默认只绑 `127.0.0.1`；公网必须先建 SSH 隧道。`--public` 是显式选择，不默认 |
| 安装页被陌生人点 | 所有 `/api/*` 校验 `x-install-token` / `?token=`，令牌由 `install.sh` 生成，600 权限，不出现在日志 |
| 装完还能被重装 | `installed.lock` 存在时，安装器一律 `409 already-installed`，拒绝一切写操作 |
| 配置文件被读取 | `api.env` 权限 600；systemd 以 `mixmapp` 用户跑，`ReadWritePaths` 只给必要目录 |
| 命令注入 | 域名走正则、端口走整数区间、连接串走 `postgres://` 前缀白名单；SQL 里的库名/用户名同样正则校验 |
| 证书私钥 | 交给 certbot 管（`/etc/letsencrypt`），安装器只调用不持有 |

---

## 5. 路径与数据落点

```
/opt/mixmapp/
├── releases/20261113213353/   # 每次安装/发版一个目录：dist + node_modules + infra
├── current -> releases/…      # 原子软链，回滚就是切软链
/etc/mixmapp/
├── api.env                    # 运行配置（600）
├── install-token              # 一次性安装令牌（600）
└── installed.lock             # 装完标记（600）
/var/www/mixmapp-site/index.html   # 前端整站（单文件 H5）
/var/log/mixmapp/{api.log,api.err.log}
/etc/nginx/conf.d/<域名>.conf
/etc/systemd/system/{mixmapp-api.service,mixmapp-installer.service}
```

数据库表：`users / bindings / refresh_tokens / sms_codes / payments / push_tokens`（`infra/sql/0001…0005`）。
对象存储：默认 `STORAGE_PROVIDER=dev`（落磁盘）；接 COS/S3 只需改 `S3_*` 四项，向导第 3 步可手填。

---

## 6. 腾讯云落地操作手册（CVM / 轻量应用服务器，共 4 步）

```bash
# ① 打包（本地或 CI，产物 release/mixmapp-install-0.0.0.tar.gz）
pnpm --filter @mixmapp/api build
node scripts/build-h5-single.mjs
node scripts/package-installer.mjs --skip-build

# ② 传包 + 引导脚本（引导脚本要单独放在包外面，它负责解包）
scp -i mixmapp_deploy release/mixmapp-install-0.0.0.tar.gz root@<服务器IP>:/root/
scp -i mixmapp_deploy scripts/install.sh root@<服务器IP>:/root/

# ③ 服务器上执行引导
ssh -i mixmapp_deploy root@<服务器IP>
bash /root/install.sh /root/mixmapp-install-0.0.0.tar.gz

# ④ 建隧道 → 浏览器点 5 步
ssh -L 8090:127.0.0.1:8090 root@<服务器IP>
# 打开 install.sh 打印的 http://127.0.0.1:8090/?token=…
```

注意事项：
- 安全组只放 22 / 80 / 443；**8090 不要开**（向导靠隧道访问）。
- 域名解析要先做，否则 certbot 必失败；证书失败不影响 HTTP 站点可用，可稍后 `certbot --nginx -d <域>` 补。
- 轻量应用服务器（Lighthouse）同样适用，它只是 CVM 的简化控制台，系统还是 Ubuntu/Debian。

### 做成“买机器就带安装向导”的镜像（形态 C）
1. 找一台干净 CVM，只跑到第 ③ 步之前（装好依赖 + 解包，不执行安装）。
2. 执行 `sysprep` 式清理：`/etc/mixmapp/installed.lock` 删除、`api.env` 清空、`install-token` 重置、nginx 默认站点恢复。
3. 关机 → 控制台“制作自定义镜像” → 之后开机器选该镜像，开机自动起 installer，控制台里给 token URL。
4. 若要上云市场，补：镜像说明、计费方式、开机自检脚本、许可证与隐私声明。

---

## 7. 与现有 CI 的关系（不要两套并行）

- **安装器 = 首次装机**：建库、写配置、起服务、发证书。
- **CI（`.github/workflows/deploy.yml` + `deploy/atomic-release.sh`）= 后续发版**：只替换 `releases/<新时间戳>` 并切 `current`，以及覆盖 `/var/www/mixmapp-site/index.html`。
- 两者共用同一套目录约定，所以“装完的机器”可以直接被 CI 接管，不需要重装。
- 回滚：`deploy/rollback.sh` 切回上一个 release；H5 回滚就是把上一个 `index.html` 覆盖回去。
- 已知缺口：`atomic-release.sh` 目前**不产出** `/opt/mixmapp/current/web`，所以 nginx 的 `root` 必须是 `/var/www/mixmapp-site`（见 `docs/20-entry-hosting.md`）。若以后流水线真的产出 `web/`，两处择一，不要各写一半。

---

## 8. 现状与下一步

已可用（本地预演已验证全流程 12 步返回成功）：
- `install/server.mjs`、`install/ui.html`、`scripts/install.sh`、`scripts/package-installer.mjs`；
- `--dev` 预演模式：不写系统文件、不调 systemctl，用来本机演示与回归。

待补（按优先级）：
1. **Docker Compose 形态**：`api` + `postgres` + `nginx` 三容器，向导作为 `installer` profile 一次性运行。
2. **对象存储向导页**：COS/S3 的 bucket 连通性测试 + 公共读 URL 校验。
3. **备份/告警**：装完自动写 `mixmapp-backup.timer`（每日 `pg_dump` + H5 快照，保留 7 天）。
4. **多站点共存**：同机第二个域名时，向导要检测端口与 `server_name` 冲突，而不是无脑覆盖。
5. **certbot 失败重试**：DNS 未生效时给“稍后重试”按钮，而不是让整个安装失败。
6. **镜像构建脚本**：把第 6 节的手工步骤写成 `scripts/make-image.md` + 自检脚本。

---

## 9. 验收清单（装完照着打勾）

```bash
curl -sS -o /dev/null -w "root=%{http_code}\n"   https://<域名>/            # 200
curl -sS -o /dev/null -w "healthz=%{http_code}\n" https://<域名>/mixmapp/api/v1/healthz   # 200
curl -sS -o /dev/null -w "meta=%{http_code}\n"    https://<域名>/mixmapp/api/v1/meta      # 200
systemctl is-enabled mixmapp-api && systemctl is-active mixmapp-api        # enabled / active
systemctl is-active mixmapp-installer                                     # inactive（装完应停）
ls -l /etc/mixmapp/api.env                                                # 600
psql "$DATABASE_URL" -c "select count(*) from users"                       # ≥1（第一个账号）
```

向导进程若还在跑：`systemctl disable --now mixmapp-installer`（安装器写 lock 后本应自动拒绝写入，但建议停掉）。

---

## 10. 同机演练（已在 115.159.159.11 真机验证）

生产机不能直接装（会重建 `/opt/mixmapp`、覆盖 vhost、抢 8080）。所以安装器支持**沙箱前缀**，在同一台机器上完整跑一遍再拆掉：

```bash
# ① 上传向导 + 用生产 release 当“安装包”（只读复制，不改动它）
scp -r install root@<IP>:/root/rehearsal/
ssh root@<IP>
# ② 沙箱启动：独立前缀、独立端口、独立 service、独立 nginx 站点（127.0.0.1:8099）
systemd-run --unit=mixmapp-rehearsal-installer --collect /usr/local/bin/node \
  /root/rehearsal/install/server.mjs --port 8093 \
  --prefix /opt/mixmapp-rehearsal \
  --root /opt/mixmapp/current \
  --h5 /var/www/mixmapp-site/index.html \
  --service-name mixmapp-api-rehearsal \
  --nginx-conf /etc/nginx/conf.d/zz-mixmapp-rehearsal.conf \
  --nginx-listen 127.0.0.1:8099
# ③ 浏览器/接口走完 5 步（令牌在 /opt/mixmapp-rehearsal/etc/install-token）
```

真机实测结果（Ubuntu 22.04 / Node 22.20 / PG 14.24）：

| 检查 | 结果 |
|---|---|
| 12 个安装步骤 | 全部 `ok`，无一步失败 |
| 直连 API `:8095/api/v1/healthz`、`/meta` | 200 / 200 |
| 经 nginx 测试站 `Host: rehearsal.local` 的 `/` | 200、472,024 字节 |
| 同一站点的深链接 `/pages/mall/index` | 200（SPA 回退生效） |
| 同一站点的 `/mixmapp/api/v1/healthz` | 200（反代生效） |
| 第一个账号 | `{"created":true,"username":"mixowner"}`，`users` 表 1 行 |
| 装完再 POST `/api/install` | `409 already-installed`（lock 生效） |
| 线上站点 `https://cloud.mixm.top/` | root 200、`healthz` 200、`/pages/tools/ids` 410，全程未变 |

演练期间发现并已修掉的真机 bug（都很典型，写在这里避免复现）：

1. **`$$` 被 bash 展开**：本机建库原来用 PL/pgSQL 的 `do $$ … end $$`，经 `bash -lc "…"` 传参时 `$$` 变成 PID，SQL 语法错误。改成“先查 `pg_roles` / `pg_database`，不存在再 `create`”。
2. **`ExecStart` 写死 `/usr/bin/node`**：这台机的 node 在 `/usr/local/bin/node`，服务直接 `203/EXEC` 起不来。改成用运行向导的 `process.execPath`。
3. **nginx 模板 `root undefined`**：模板引用了 `cfg.webRoot`，但该字段没传进 install()，生成 `root undefined;`，站点 404。改成直接引用 `PATHS.web`。

另外一条不是 bug、但值得写进向导提示的规则：用户名命中保留词会 422（`username-policy` 里含 `admin`），
所以“第一个账号”不要用 `xxxadmin` 这类名字；安装器现在会把这个 422 的真实原因回显到安装日志，而不是吞掉。

演练清理（已执行，机器上无残留）：

```bash
systemctl disable --now mixmapp-api-rehearsal; rm -f /etc/systemd/system/mixmapp-api-rehearsal.service
systemctl stop mixmapp-rehearsal-installer
rm -f /etc/nginx/conf.d/zz-mixmapp-rehearsal.conf; nginx -t && systemctl reload nginx
rm -rf /opt/mixmapp-rehearsal /root/rehearsal
sudo -u postgres psql -tAc "drop database if exists mixmapp_rehearsal"; sudo -u postgres psql -tAc "drop role if exists mixmapp_rehearsal"
```
