# 商城 15,037 条商品「看得到」· 生产部署执行清单

> 目标：把 https://eg.egluosi.com/b2b/ 的 15,037 条商品在生产 `https://cloud.mixm.top/` 可见（含图片），并把预览版切成正式版。
> 域名口径：`eg.egluosi.com` 是第三方商品来源站，**不在 DNSPod 导出表内**，也无等价表内主机，标记 **pending 待确认**，仅作数据来源保留；本项目对外域名一律为 `cloud.mixm.top`。
> **本清单只描述操作，本会话未执行任何写生产动作**（未 systemctl、未 curl POST、未 ssh 变更、未 push、未触发发布）。
> 所有对生产机的写操作都标注 `[需凭据/授权]`，执行前必须由用户提供 SSH 凭据并确认。

---

## 0. 步骤归属速查

| # | 步骤 | 谁执行 | 需用户凭据/授权 | 能否 CI 自动 |
|---|------|--------|----------------|--------------|
| 1 | 前置只读检查 | 本机 | 否（公网只读） | 可 |
| 2 | 备份 DB / nginx 配置 | 生产机 | **是** | 否 |
| 3 | **重新构建并替换全部静态产物** | 主代理统一构建阶段 | 否（本地构建） | **可**（deploy.yml build:h5 + 抽检） |
| 4 | 发布 API + H5（原子发布） | CI 或手动 | **是**（首次需配 secrets） | **可**（deploy.yml） |
| 5 | **落位 catalog.json + 872 图 + 配置目录源 env** | 生产机 / CI | **是** | 开关 `DEPLOY_CATALOG=1` 后可 |
| 6 | 配置 nginx `/media/` + 重载 | 生产机 | **是** | 否（改生产配置，建议人工） |
| 7 | 逐项验收（curl + 本地资产） | 本机 / 生产机 | 否（只读） | **可**（catalog-verify.mjs） |
| 8 | 失败回滚 | 生产机 | **是** | 否 |

**策略定型（重要）**：生产 `/api/v1/admin/*` 整体 404（未配 `ADMIN_TOKEN`），**无法走 HTTP 管理通道远程灌 15k 数据**；且 `.gitignore` 排除了 `catalog.json / source/images / storage / release`，CI checkout 里没有商品数据。因此修复路径不是「往生产 PG 导库」，而是：
**把 `catalog.json` 作为数据文件随发布包送到生产机 + 图片同步到 `STORAGE_DIR/products/` + 用 `MALL_CATALOG_SOURCE` / `MALL_CATALOG_FILE` 让 API 内嵌只读目录源（CatalogSource）接管商城公开读**。不写 DB、不需要 ADMIN_TOKEN、幂等可重跑。

**本会话能否直连生产：不能**（详见 §2.4）。缺：当前有效的 `DEPLOY_HOST` / `DEPLOY_USER` 值、`DEPLOY_SSH_KEY_B64`（CI secret）或可用私钥、重装后有效的主机指纹。本机 `~/.ssh/mixmapp_deploy` 私钥与 `known_hosts` 有历史记录，但 docs/07 §18 记录服务器 2026-11-13 重装后 SSH 报 `Permission denied (publickey,password)`、主机指纹变化，旧密钥大概率失效；`~/.ssh/config` 也无生产 Host 别名。**严禁**用本机 `~/.ssh/{mx_pw,try_pw,try_kbd}.py` 等脚本猜测密码/绕过鉴权。

---

## 1. 现状与根因（一手实测，勿重复调研）

| 现象 / 结论 | 根因 / 证据 |
|---|---|
| `GET /media/products/<sha1>.jpg` → 404 | ① 872 张图在开发机 `storage/products/`，**从未同步到生产** `STORAGE_DIR=/var/lib/mixmapp/storage/products/`；② nginx 生产配置 `/etc/nginx/conf.d/cloud.mixm.top.conf` 重装后 `/media/` location 可能丢失，且 `location /` 的 `try_files $uri $uri/ /index.html` 会把 `/media/*` 抢走回退成 HTML；③ `/var/lib/mixmapp` 原 `750` 属组 `mixmapp`，nginx worker(www-data) 无法穿越（docs/07 §18 踩坑）。 |
| **决定性断点：CI/发布包里没有商品数据** | `.gitignore` 明确排除 `tools/egluosi-importer/source/catalog.json`(33.98MB)、`source/images/`、`storage/`、`release/`。CI checkout 出来的代码**根本没有这份数据**；若只打 git 内容，`CatalogSource` 会「未找到 catalog.json → 优雅降级到数据库」，于是又只剩 6 条演示品。发布链路必须**显式携带**数据，不依赖 git 追踪。 |
| 生产无法远程灌库 | `GET /api/v1/admin/mall/import` → 404、`/api/v1/admin/db` → 404，管理面整体 404（生产未配置 `ADMIN_TOKEN`）。`POST /admin/mall/import` 通道不可用，且 35.6MB 整包经公网 nginx（`client_max_body_size` 25m）会 413。 |
| 商城只有 6 条演示品 | 生产库无真实目录商品 + 线上旧构建；`atomic-release.sh` 只做 migrate+restart+healthz，从不携带数据，健康检查也只查 status/db（「假绿」）。 |
| 数据层本身健康 | 本机 8094 API 全量翻页实测：page 1..301、pageSize 50 → `rows=15043`、`uniqueIds=15043`、`duplicates=0`、`errors=0`。分页/排序/去重没问题，问题纯粹在「生产库没这批数据 + 线上旧构建」。 |
| 图片文件本身健康 | `storage/products/` 魔数抽查正常（`.jpg = ffd8ffe0`、`.png = 89504e47`），线上 404 是 nginx `/media` 直出/同步问题，**不是文件损坏**。 |
| 前缀可用 | `GET /mixmapp/api/v1/mall/categories` → 200（前端注入路径可用）；`GET /api/v1/healthz` → 200。两条前缀都反代到后端 `/api/v1/*`（见 §6）。 |
| `version` 带 `-preview` 后缀 | 线上仍是旧构建，需重新发布正式版（三段式基线 `0.0.0`）。 |
| **已发布静态产物本身就是「预览版/离线」** | `release/` 下多份 HTML 残留旧渠道后缀版本号与「单码多端预览版」字样；其中 3 份的 API 基址注入了**失效域名** `https://cloud.mix.top/mixmapp/api/v1`（实测 schannel SSL 握手失败 `SEC_E_ILLEGAL_MESSAGE`），而正确的是 `https://cloud.mixm.top/mixmapp/api/v1`。用户看到的很可能就是这些旧产物——**只改源码不重发产物无效**。 |

**前缀关系核对结论**（别改坏 API 反代）：
- 前端 `window.__MIXMAPP_API_BASE__="/mixmapp/api/v1"`；nginx `location /mixmapp/ { proxy_pass http://127.0.0.1:8080/; }`（**带结尾 `/`** 剥掉 `/mixmapp` 前缀）→ 后端 `/api/v1/*`。
- 实测 `GET /api/v1/healthz` 也 200，对应 `location /api/ { proxy_pass http://127.0.0.1:8080; }`（不带 `/`，路径原样）。
- `/media/` 是**根路径**，与 `/mixmapp/` 前缀互不隶属。必须显式 `location /media/`（比 `location /` 长，最长前缀优先），才不会被 SPA `try_files` 抢走。统一对外 API 基址为 **`https://cloud.mixm.top/mixmapp/api/v1`**（同域相对写法 `/mixmapp/api/v1` 亦可），**严禁 `cloud.mix.top`**。

**不依赖 nginx 的兜底（只读核对，未改 services/api/**）**：`app.ts:168-170` 在 `storage.provider==='local'` 时注册 `mediaRoutes`，且该注册**无 prefix**（主路由在 `app.ts:182` 才带 `{prefix:'/api/v1'}`），即后端根路径 `/media/*`；`LocalStorage.publicUrl()` = `/media/${key}`（storage.ts:163）。catalog-lead 已给 `media.ts` 增加多根兜底（`STORAGE_DIR`、仓库 `storage/`、`cwd/storage/`、随包 `catalog/images/`，并把 `products/<sha1>` 映射到抓取端 `source/images/<basename>`）。所需 env：`STORAGE_PROVIDER=local`（默认，config.ts:270）、`STORAGE_DIR=/var/lib/mixmapp/storage`（生产默认，config.ts:279）、`STORAGE_API_BASE`（默认 `/mixmapp/api/v1`，只影响上传预签名，不影响读图）。结论：只要图片落到 `products/`，即使不配 nginx `/media/`，API 也能直出；nginx alias 直出仍是首选（少一次进程内查盘）。

---

## 2. 前置检查（只读，本机即可）

```bash
SITE=https://cloud.mixm.top

# 2.1 现状快照（全部只读 GET）
curl -fsS "$SITE/api/v1/healthz"; echo          # 改动前：version 带 -preview 后缀, storage=local, db=ok
curl -fsS "$SITE/api/v1/meta"; echo            # 改动前：env=production, catalogSource.source=unavailable/db
curl -fsS "$SITE/api/v1/mall/categories"; echo # 改动前：6 条演示类目 featured/life/digital/wear
curl -fsS "$SITE/api/v1/mall/products?page=1&pageSize=20"; echo  # 改动前：前 3 条为 首发限定礼盒/冲锋衣/理线坞
curl -sS -o /dev/null -w 'media HTTP %{http_code}\n' \
  "$SITE/media/products/000518191826ddfe69815af4ffe2513f1ca0de08.jpg"   # 改动前：404

# 2.2 生产管理面 / 前缀通道（一手实测结论，复测用）
curl -sS -o /dev/null -w 'admin/import %{http_code}\n' "$SITE/api/v1/admin/mall/import"  # 404
curl -sS -o /dev/null -w 'admin/db     %{http_code}\n' "$SITE/api/v1/admin/db"          # 404
curl -sS -o /dev/null -w 'mixmapp/categories %{http_code}\n' \
  "$SITE/mixmapp/api/v1/mall/categories"                                                 # 200
curl -sS -o /dev/null -w 'wrong-domain %{http_code}\n' https://cloud.mix.top/api/v1/healthz || true  # SSL 失败

# 2.3 本机数据资产（这些数据被 gitignore 排除，CI 里没有，必须显式携带）
ls -la tools/egluosi-importer/source/catalog.json    # 约 35.6MB
find storage/products -type f | wc -l                # 872
find storage/products -type f -name '*.jpg' -exec sh -c 'head -c4 "$1" | od -An -tx1' _ {} \; | head -3  # ffd8ffe0
ls -la release/prod-catalog/                        # catalog.json(34M) + products/(872) + import.sh + deploy-catalog.{mjs,sh}
find release/prod-catalog/products -type f | wc -l  # 872

# 2.4 GitHub Actions 所需 secrets/vars（值在仓库设置里，本机不存）
#   secrets: DEPLOY_SSH_KEY_B64、DEPLOY_HOST、DEPLOY_USER
#   vars:    MIXMAPP_API_BASE(默认 /mixmapp/api/v1)、HEALTH_BASE_URL、
#            DEPLOY_CATALOG(默认未设=关闭)、SITE_BASE_URL(默认 https://cloud.mixm.top)、
#            EXPECT_VERSION(可选)
# 只读验证能否直连（**仅探活，不执行任何写操作**；需用户先提供 DEPLOY_USER/DEPLOY_HOST 并确认指纹）：
#   ssh -i ~/.ssh/mixmapp_deploy -o BatchMode=yes -o ConnectTimeout=5 \
#       -o StrictHostKeyChecking=accept-new <DEPLOY_USER>@<DEPLOY_HOST> 'echo ok'
# 结论：本会话不执行该命令；凭据不完整且密钥疑似失效，需用户补齐后再验。
```

---

## 3. 备份 `[需凭据/授权]`

```bash
# 生产机上执行（ssh 登录后）
STAMP=$(date +%Y%m%d%H%M%S)
sudo -u mixmapp bash -lc 'set -a; . /etc/mixmapp/api.env; set +a; \
  pg_dump "$DATABASE_URL" | gzip > /var/backups/mixmapp-'"$STAMP"'.sql.gz'
sudo cp /etc/nginx/conf.d/cloud.mixm.top.conf "/etc/nginx/conf.d/cloud.mixm.top.conf.bak.$STAMP"
sudo cp /etc/systemd/system/mixmapp-api.service "/etc/systemd/system/mixmapp-api.service.bak.$STAMP"
readlink -f /opt/mixmapp/current | sudo tee /opt/mixmapp/prev-release-$STAMP.txt   # 回滚指针
sudo find /var/lib/mixmapp/storage/products -type f 2>/dev/null | wc -l
```

---

## 4. 重新构建并替换全部静态产物 `[发布必做]`

> **这一节交给主代理在最终统一构建阶段处理**；deploy-lead 的边界不允许覆盖 `release/` 下已有文件，此处只列清单与抽检命令，不自己动手改。

**问题清单**（`release/` 下已发布的历史产物）：

| 文件 | 残留问题 |
|---|---|
| `release/mixmapp-h5-single.html`、`release/cs-index.html`、`release/pages-index.html` | 含旧渠道后缀版本号 + 「单码多端预览版」；API 基址注入**失效域名** `https://cloud.mix.top/mixmapp/api/v1` |
| `release/site/index.html`、`release/cloudbase-site/index.html`、`release/cloudbase-site/404.html`、`release/MixmAPP/index.html`、`release/api-stage/dist/chunk-*.js` | 含旧渠道后缀版本号 |

**必做动作**：用正式版源码 + `MIXMAPP_API_BASE=https://cloud.mixm.top/mixmapp/api/v1`（或同域相对 `/mixmapp/api/v1`）**重新构建**并替换上述全部产物；统一 API 基址，禁用 `cloud.mix.top`。CI 的 `pnpm build:h5` 每次重建 H5，并已有「抽检 H5 产物（版本号/预览字样/API 基址）」step 拦截回归。

**产物抽检命令**（替换后执行，只读；三项都须无输出/为正确值）：

```bash
cd <仓库根>
for f in release/mixmapp-h5-single.html release/cs-index.html release/pages-index.html \
         release/site/index.html release/cloudbase-site/index.html \
         release/cloudbase-site/404.html release/MixmAPP/index.html; do
  [ -f "$f" ] || continue
  echo "--- $f"
  grep -cE '0\.[0-9]+\.[0-9]+\.[0-9]+|-[0-9]+\.[0-9]+\.[0-9]+-(preview|dev)' "$f" || true  # 期望 0（四段号/渠道后缀号）
  grep -c '单码多端预览版' "$f" || true                 # 期望 0
  grep -c 'cloud\.mix\.top/mixmapp' "$f" || true       # 期望 0（失效域名）
  grep -o '__MIXMAPP_API_BASE__="[^"]*"' "$f" | head -1 || true
  # 期望：/mixmapp/api/v1 或 https://cloud.mixm.top/mixmapp/api/v1
done
grep -rlEq '0\.[0-9]+\.[0-9]+\.[0-9]+' release/api-stage/dist/ && echo "✗ api-stage chunk 仍含四段号" || echo "✓ api-stage OK"
```

---

## 5. 发布 API + 前端 + 落位商品数据 `[需凭据/授权]`

### 5.1 CI 路径（推荐）
`deploy.yml` 的 `build` job 已把 `release/prod-catalog/`（若存在）打成 `catalog-<sha>.tar.gz` 随包发布；`api` job 在 `DEPLOY_SSH_KEY_B64/DEPLOY_HOST/DEPLOY_USER` 齐备时原子发布。
> 默认 `DEPLOY_CATALOG` 未设 = 关闭，这一步**只发布 API+H5**，与改造前行为一致。
> 设 `DEPLOY_CATALOG=1` 后，CI 依次执行「上传商品数据包 → 原子发布（含数据落位 + 配置 `MALL_CATALOG_*` env + 目录源校验）→ HTTP 增强验收 → 生产机本地资产硬验收」。
> **前提**：CI checkout 默认没有商品数据（gitignore 排除）。要么把数据注入 `release/prod-catalog/` 作为 artifact，要么走 §5.2 的开发机直送；缺数据时「上传商品数据包」step 会 fail-fast，绝不静默降级。

```bash
# 需用户授权（会写生产）
gh workflow run deploy.yml      # 需 gh 已登录且有权限；或 push main / 打 v* tag
```

### 5.2 手动路径（数据主路径：开发机直送生产机）
数据在本机、被 gitignore 排除，最可靠的是开发机打包后 `scp` 直送。**占位符 `<DEPLOY_USER>` / `<DEPLOY_HOST>` 需用户提供**。

```bash
KEY=~/.ssh/mixmapp_deploy
DEPLOY_USER=<用户提供>
DEPLOY_HOST=<用户提供>

# 5.2.1 开发机：直接打包 catalog-lead 已产出的分发包（不依赖 git 追踪）
#   release/prod-catalog/ = catalog.json(34M) + products/(872 张 <sha1>.jpg)
#   + import.sh（主入口）+ deploy-catalog.{mjs,sh}（可选导库）+ images-manifest.json + README.md
find release/prod-catalog/products -type f | wc -l    # 期望 872
# 与 catalog-lead README §3 统一为平铺打包：
tar -czf /tmp/catalog-data.tar.gz -C release/prod-catalog .      # 平铺（唯一推荐写法）
# 历史/离线分发若用带一层 prod-catalog/ 目录的包（tar -C release prod-catalog），
# atomic-release.sh / catalog-import.sh 会自动展平；手工解包加 --strip-components=1 亦可。
ls -lh /tmp/catalog-data.tar.gz                       # 压缩包约 29MB（未压缩目录约 75MB）

# 5.2.2 上传产物、脚本、数据包（统一重命名，避免远端变量展开问题）
scp -i "$KEY" api-<sha>.tar.gz   "$DEPLOY_USER@$DEPLOY_HOST:/tmp/api.tar.gz"
scp -i "$KEY" h5-<sha>.tar.gz    "$DEPLOY_USER@$DEPLOY_HOST:/tmp/web.tar.gz"
scp -i "$KEY" /tmp/catalog-data.tar.gz "$DEPLOY_USER@$DEPLOY_HOST:/tmp/catalog.tar.gz"
scp -i "$KEY" -r deploy          "$DEPLOY_USER@$DEPLOY_HOST:/tmp/mixmapp-deploy"

# 5.2.3 生产机：一条命令完成「代码发布 + 数据落位 + 目录源 env + 图片同步 + 重启 + 目录源校验」
#   atomic-release.sh 的 CATALOG_ARTIFACT 会把 catalog.json 落到 /opt/mixmapp/prod-catalog/（全局持久、
#   不随 release 回滚），校验 JSON 可解析，同步 products/ 图片并校验 ≥871，幂等追加
#   MALL_CATALOG_SOURCE / MALL_CATALOG_FILE 到 /etc/mixmapp/api.env，重启后校验
#   healthz 的 checks.catalogSource === catalog。
ssh -i "$KEY" "$DEPLOY_USER@$DEPLOY_HOST" '
  sudo mkdir -p /opt/mixmapp/deploy && sudo cp -r /tmp/mixmapp-deploy/* /opt/mixmapp/deploy/ &&
  sudo ARTIFACT=/tmp/api.tar.gz WEB_ARTIFACT=/tmp/web.tar.gz \
       CATALOG_ARTIFACT=/tmp/catalog.tar.gz VERIFY_CATALOG=1 \
       MALL_CATALOG_SOURCE=force \
       bash /opt/mixmapp/deploy/atomic-release.sh
'
```

> **可选路径 B（本地导库，与目录源互补）**：catalog-lead 的 `deploy-catalog.mjs` 可把 15,037 条真正灌进生产 PG（直连 `DATABASE_URL`，不走 HTTP admin，故不受生产 admin 面 404 影响），命令见 `release/prod-catalog/README.md` §3。两条路不冲突：目录源让商品「立刻可见」，导库让数据「持久化到 DB」；`MALL_CATALOG_SOURCE=auto` 时 DB 已有真实商品会自动让位。本清单主推目录源路径（无需 ADMIN_TOKEN、无需迁移、无需停机）。

**数据包自带主入口（可选，与 deploy/catalog-import.sh 等价）**：catalog-lead 定稿的 `release/prod-catalog/import.sh` 自包含、幂等，只依赖 node+bash：校验 `catalog.json`、以 root 同步 872 张图、幂等配置 `MALL_CATALOG_*`、`--dry-run` 只预检、`--import-db` 才可选灌库。总开关同为 `DEPLOY_CATALOG=1`。**与 `/opt/mixmapp/deploy/catalog-import.sh` 任选其一，不要重复执行**；本清单推荐后者（与 atomic-release.sh / deploy.yml 同一套路径与默认值）。直接调用示例：

```bash
sudo DEPLOY_CATALOG=1 CATALOG_DIR=/opt/mixmapp/prod-catalog \
     STORAGE_DIR=/var/lib/mixmapp/storage bash /opt/mixmapp/prod-catalog/import.sh --dry-run
```

**单独重跑数据落位**（改数据后无需重发代码，幂等）：
```bash
ssh -i "$KEY" "$DEPLOY_USER@$DEPLOY_HOST" '
  sudo mkdir -p /opt/mixmapp/prod-catalog && sudo tar -xzf /tmp/catalog.tar.gz -C /opt/mixmapp/prod-catalog &&
  sudo CATALOG_DIR=/opt/mixmapp/prod-catalog STORAGE_DIR=/var/lib/mixmapp/storage \
       DEPLOY_CATALOG=1 bash /opt/mixmapp/deploy/catalog-import.sh
'
```
`catalog-import.sh` 做四件硬校验：`catalog.json` 可解析且 `products > 10000`、图片数 `≥ 871`、权限放开给 www-data、幂等配置 `MALL_CATALOG_SOURCE/MALL_CATALOG_FILE`，然后重启服务。

**目录源 env 说明**（写入 `/etc/mixmapp/api.env`，重启后生效）：
```bash
MALL_CATALOG_SOURCE=force                       # force 确保目录源接管；auto 在 DB 已有真实商品时会让位给 DB
MALL_CATALOG_FILE=/opt/mixmapp/prod-catalog/catalog.json   # 绝对路径，指向随包发布的数据文件
```
`CatalogSource.resolveFile()` 也支持随包默认路径（`dist/catalog.json`、`current/catalog/`、`release/prod-catalog/` 等），但**显式 `MALL_CATALOG_FILE` 最可靠**：数据放在全局持久目录，不受 release symlink 切换影响。

**（可选）systemd 补 ReadWritePaths**：本方案图片由 root 脚本同步，不需要 API 进程写 `/var/lib/mixmapp`。若改走 API 写盘才需：
```bash
sudo sed -i 's#^ReadWritePaths=.*#ReadWritePaths=/opt/mixmapp /var/log/mixmapp /var/lib/mixmapp#' \
  /etc/systemd/system/mixmapp-api.service
sudo systemctl daemon-reload && sudo systemctl restart mixmapp-api
```

---

## 6. 配置 nginx `/media/` + 重载 `[需凭据/授权]`

仓库蓝本 `infra/nginx/api.mixm.top.conf`（2026-11-14 起取代 `mixmapp-api.conf`）与 `infra/nginx/img.mixm.top.conf` 已含 `/media/` 段；生产实际用 `/etc/nginx/conf.d/cloud.mixm.top.conf`（拓扑不同：`/` 是 SPA、`/mixmapp/` 剥前缀反代）。**不要整文件覆盖生产配置**（会破坏 TLS/certbot），只把下面 4 个 location 段合并进现有 `server {}` 块，完整可粘贴文件见 `infra/nginx/cloud.mixm.top.conf`。

```nginx
# ── 可直接粘贴进 /etc/nginx/conf.d/cloud.mixm.top.conf 的 server {} 块 ──
client_max_body_size 25m;

# 1) API 反代（不带 /mixmapp 前缀，探活/外部调用）
location /api/ {
    proxy_pass http://127.0.0.1:8080;          # 末尾不带 / → 路径原样
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_connect_timeout 5s;
    proxy_read_timeout 120s;
}

# 2) 前端同域 API 前缀 /mixmapp/api/v1（剥掉 /mixmapp）
location /mixmapp/ {
    proxy_pass http://127.0.0.1:8080/;         # 末尾带 / → 剥前缀
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_connect_timeout 5s;
    proxy_read_timeout 120s;
}

# 3) 本地存储图片直出（核心修复）
location /media/ {
    alias /var/lib/mixmapp/storage/;          # 必须用 alias，不能用 root
    try_files $uri =404;                      # 必须带 =404，别写 $uri $uri/ /index.html
    access_log off;
    expires 30d;                              # 生成 Cache-Control: max-age=2592000
    # 若需 immutable：删掉 expires，改用下行（同一响应头二选一）
    # add_header Cache-Control "public, max-age=2592000, immutable" always;
    # location 内出现 add_header 后 server 级安全头不再继承，补齐：
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    # 同域无需 CORS；仅当前端独立域托管时放开：
    # add_header Access-Control-Allow-Origin "*" always;
}

# 4) H5 SPA（保留现有，勿删）
location / {
    root /opt/mixmapp/current/web;            # 生产若指向 /var/www/mixmapp-site 按实际调整
    try_files $uri $uri/ /index.html;
}
```

**关键坑（docs/07 §18 实测）**：
- 用 `alias` 而非 `root`：`root /var/lib/mixmapp/storage` 会把 `/media/products/x.jpg` 映射到 `.../storage/media/products/x.jpg`（多一层 media）→ 404。
- `alias` 里**不能**写 `try_files $uri $uri/ /index.html`（带 URI 回退会重新走 location 匹配、拼错路径 404）；必须 `try_files $uri =404;` 硬兜底。
- 必须有显式 `location /media/`，否则 `/media/*` 被 `location /` 的 SPA `try_files` 抢走，回退成 `index.html`（HTML 200 而非图片）。

**目录权限 + 重载**：
```bash
sudo chgrp -R www-data /var/lib/mixmapp/storage
sudo chmod o+rx /var/lib/mixmapp /var/lib/mixmapp/storage
sudo chmod -R o+rX /var/lib/mixmapp/storage/products
sudo find /var/lib/mixmapp/storage/products -type f | wc -l   # 期望 ≥872
sudo nginx -t                       # 必须先通过
sudo systemctl reload nginx        # 平滑重载，不中断 API 反代
```

---

## 7. 重载
API 已由 `atomic-release.sh` 在发布时 `systemctl restart mixmapp-api`（catalog-import.sh 单独重跑数据时也会重启）；本节只需 `systemctl reload nginx`。若改过 systemd service，另需 `daemon-reload && restart mixmapp-api`。

---

## 8. 逐项验收（curl 命令 + 期望值）

```bash
SITE=https://cloud.mixm.top
API=$SITE/api/v1          # 也可改用 $SITE/mixmapp/api/v1，生产两条都反代到后端

# ① healthz：正式号 + 真库 + catalog 目录源接管  [必需]
curl -fsS "$API/healthz" | tee /tmp/health.json; echo
# 期望：HTTP 200，status="ok"，checks.db="ok"，checks.catalogSource="catalog"，
#       version=<三段正式号> —— 不含 "preview" / "dev" 后缀
node -e 'const j=require("/tmp/health.json");
  const ok = j.status==="ok" && j.checks?.db==="ok" && j.version &&
             !/preview|dev/i.test(j.version) &&
             j.checks?.catalogSource==="catalog";
  console.info(ok?"✓ 版本正式化 + 目录源接管":"✗ 仍是渠道版/目录源未接管",
    "version="+j.version,"catalogSource="+j.checks?.catalogSource);
  process.exit(ok?0:1)'

# ② /meta 复核目录源（可选，字段更全）
curl -fsS "$API/meta" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const c=JSON.parse(s).data.catalogSource;
  console.info("source="+c.source,"productCount="+c.productCount,"file="+c.file,"reason="+c.reason);
  process.exit(c.source==="catalog"?0:1)})'

# ③ categories：6 个真实中文类目 + Σcount > 10000  [必需]
curl -fsS "$API/mall/categories" | tee /tmp/cats.json; echo
# 期望：data 为数组，长度 = 6，类目名为中文，非演示码 featured/life/digital/wear，
#       6 个真实类目：EG螺丝类 6160 / 成品刀刃具类 5947 / EGM螺丝类 2251 /
#       手工具类 253 / 膨胀类 249 / 汽车螺丝类 177，各类目 count 之和 = 15037
node -e 'const j=require("/tmp/cats.json"); const a=j.data||[];
  const sum=a.reduce((n,c)=>n+(Number(c.count)||0),0);
  const demo=new Set(["featured","life","digital","wear"]);
  const real=a.filter(c=>!demo.has(String(c.code).toLowerCase()));
  const han=a.filter(c=>/[\u4e00-\u9fa5]/.test(String(c.name)));
  const ok=a.length>=6 && real.length>=6 && han.length>=6 && sum>10000;
  console.info(ok?"✓ 6 个真实中文类目 + 数量达标":"✗ 数据未生效",
    "类目="+a.length,"中文="+han.length,"Σcount="+sum);
  process.exit(ok?0:1)'

# ④ products?page=1&pageSize=20：真实五金商品，非演示品  [必需]
#    pageSize 只接受契约白名单 20/50/100（传 3 会 422）；这里取 20 后只看前 3 条
curl -fsS "$API/mall/products?page=1&pageSize=20" | tee /tmp/products.json; echo
# 期望：前 3 条真实五金商品，标题不再出现
#       「MixmAPP 首发限定礼盒 / 石墨黑轻量冲锋衣 / 桌面理线收纳坞」
node -e 'const j=require("/tmp/products.json"); const a=(j.data||[]).slice(0,3);
  const demo=["MixmAPP 首发限定礼盒","石墨黑轻量冲锋衣","桌面理线收纳坞"];
  const titles=a.map(p=>String(p.title??p.name??""));
  const ok=a.length===3 && !titles.some(t=>demo.some(d=>t.includes(d)));
  console.info(ok?"✓ 真实商品":"✗ 仍是演示品", titles.join(" / ")); process.exit(ok?0:1)'

# ⑤ /media/products/<真实 sha1>.jpg：200 + image/*  [必需]
IMG=$(grep -oE '/media/products/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)' /tmp/products.json | head -1)
IMG=${IMG:-/media/products/000518191826ddfe69815af4ffe2513f1ca0de08.jpg}
echo "抽检：$SITE$IMG"
curl -sS -o /dev/null -w 'HTTP %{http_code}  content-type=%{content_type}  bytes=%{size_download}\n' "$SITE$IMG"
# 期望：HTTP 200  content-type=image/jpeg（或 image/*）  bytes>0

# ⑥ 静态产物三项抽检（版本号 / 预览字样 / API 基址）—— 见 §4 命令
# 期望：无四段号 / 无渠道后缀号、无「单码多端预览版」、无 cloud.mix.top，基址为 cloud.mixm.top/mixmapp/api/v1

# ⑦ 一键验收（HTTP 全项，CI 也调用）
node deploy/catalog-verify.mjs "$SITE"
# 期望：全项 PASS，exit 0

# ⑧ 生产机本地资产硬验收（catalog.json 可解析 / 图片数 ≥ 871）
LOCAL_ONLY=1 CATALOG_FILE=/opt/mixmapp/prod-catalog/catalog.json \
  STORAGE_DIR=/var/lib/mixmapp/storage node /opt/mixmapp/deploy/catalog-verify.mjs
# 期望：2/2 通过（products>10000、图片数≥871）
```

| 验收项 | 命令 | 期望值 |
|--------|------|--------|
| 版本正式号 | `curl $SITE/api/v1/healthz` | `version` 不含 `preview` / `dev` 后缀，`db=ok` |
| **catalog 目录源接管** | `curl $SITE/api/v1/healthz` | `checks.catalogSource === "catalog"`（或 `/meta` 的 `data.catalogSource.source==="catalog"`） |
| 6 个真实中文类目 | `curl $SITE/api/v1/mall/categories` | `data.length>=6`、中文名、非演示码、`Σcount>10000` |
| 真实五金商品 | `curl "$SITE/api/v1/mall/products?page=1&pageSize=20"` | 前 3 条为真实商品名，无演示三品（pageSize 仅接受 20/50/100） |
| 图片直出 200 | `curl -o /dev/null -w '%{http_code}' $SITE/media/products/<sha1>.jpg` | `200` + `content-type: image/*` |
| **静态产物三项** | §4 抽检命令 | 无渠道后缀号 / 无预览字样 / 无 `cloud.mix.top` |
| **本地资产** | `LOCAL_ONLY=1 CATALOG_FILE=... STORAGE_DIR=... node deploy/catalog-verify.mjs` | `catalog.json` 可解析、图片数 `≥871` |
| 自动化汇总 | `node deploy/catalog-verify.mjs $SITE` | 全项 PASS，exit 0 |

---

## 9. 失败回滚 `[需凭据/授权]`

| 失败点 | 回滚动作 |
|--------|----------|
| 发布后 `healthz` 不通过 | `atomic-release.sh` **已自动**把 `current` symlink 指回上一版并重启；无需人工。人工可用 `sudo bash /opt/mixmapp/deploy/rollback.sh [步数]`。 |
| 数据落位失败 / 目录源未接管 | **不自动切版本**（数据与代码解耦）。先按 §8 ① 定位：`MALL_CATALOG_FILE` 路径是否存在、`MALL_CATALOG_SOURCE` 是否为 force/auto、api.env 是否重启生效、`catalog.json` 是否可解析。数据落位幂等，**修好后直接重跑 §5.2「单独重跑数据落位」即可**，不需回滚代码、不需动 DB。 |
| 验收发现仍是 6 条演示品 | 说明 CI/发布包没带 `catalog.json`（gitignore 断点）。按 §5.2 从开发机直送数据；`deploy.yml` 的「上传商品数据包」step 已做 fail-fast，不会静默通过。 |
| nginx 改坏 / reload 后站点异常 | `sudo cp /etc/nginx/conf.d/cloud.mixm.top.conf.bak.<STAMP> /etc/nginx/conf.d/cloud.mixm.top.conf && sudo nginx -t && sudo systemctl reload nginx`。 |
| 图片同步后仍 404 | 检查三件事：`ls /var/lib/mixmapp/storage/products/ \| wc -l`（≥871）、`namei -l /var/lib/mixmapp/storage/products/<file>`（各级对 www-data 有 x/r）、`sudo nginx -T \| grep -A8 'location /media'`。图片魔数已验证有效，不用查文件损坏。 |
| 需要整体回退到发布前 | ① `rollback.sh` 回退 release；② 恢复 nginx 备份 reload；③ 数据目录 `/opt/mixmapp/prod-catalog` 与图片不清（幂等、无害），如需移除 env 里的 `MALL_CATALOG_*` 需用户明确授权；④ DB 仅在明确授权下用 §3 备份恢复（`gunzip -c ... \| psql "$DATABASE_URL"`，**高危**）。 |

---

## 10. 未完成 / 需用户授权事项

1. **生产 SSH 凭据**：`DEPLOY_HOST` / `DEPLOY_USER` 的当前有效值、`DEPLOY_SSH_KEY_B64`（GitHub secret）或可用私钥；重装后主机指纹需重新确认。本会话**不能直连生产**，所有 §3~§7、§9 的生产机写操作都未执行。
2. **触发发布**：未 push / 未 `gh workflow run` / 未打 tag，需用户授权后执行。
3. **GitHub 仓库变量**：设置 `DEPLOY_CATALOG=1` 才会随发布携带并落位数据（另可配 `SITE_BASE_URL`、`EXPECT_VERSION`）。注意 CI checkout 默认无数据，需注入 artifact 或走 §5.2 开发机直送。
4. **静态产物替换**：§4 的 8 份 `release/` 历史产物需由**主代理在最终统一构建阶段**重新构建并替换（deploy-lead 边界不允许覆盖 `release/` 已有文件，未自行修改）。三项抽检命令已提供。
5. **catalog-lead 的数据包（已定稿）**：`release/prod-catalog/` = `catalog.json` 34M + `products/` 872 张 + `import.sh`（自包含主入口，默认不灌库、`--dry-run` 预检、`--import-db` 可选灌库）+ `deploy-catalog.{mjs,sh}` + `images-manifest.json` + `README.md`；6 个真实中文类目合计 15037。本清单 §5.2 直接打这个包直送生产机 `/opt/mixmapp/prod-catalog/`，与 catalog-lead README 的落位一致。该目录被 `.gitignore` 的 `release/` 排除，**CI checkout 仍没有它**，必须打包直传或注入 artifact。`deploy.yml` / `atomic-release.sh` / `catalog-import.sh` 已兼容平铺与带一层 `prod-catalog/` 目录两种 tar 结构，并做「目录不存在跳过 / 数据不合法失败」守卫；`import.sh` 与 `deploy/catalog-import.sh` 等价，任选其一勿重复执行。
6. **version-lead 的正式版本号**：验收默认只校验「非 preview」；精确比对设 `EXPECT_VERSION`（如 V1.0.0）。
7. **nginx 生产配置的合并**：`infra/nginx/cloud.mixm.top.conf` 是蓝本，生产 `/etc/nginx/conf.d/cloud.mixm.top.conf` 需人工合并 location 段（勿整文件覆盖，避免破坏 TLS/certbot）。
8. **systemd `ReadWritePaths`**：仓库 `infra/systemd/mixmapp-api.service:23` 未含 `/var/lib/mixmapp`（不在 deploy-lead 边界，未改）；本方案图片由 root 脚本同步，通常无需改，若改走 API 写盘则需补。
9. **生产 admin 面未配 `ADMIN_TOKEN`**：`POST /admin/mall/import` 返回 404，HTTP 灌库通道不可用；本清单已改为「数据文件随包 + 内嵌只读目录源」，无需 ADMIN_TOKEN。若将来要走 HTTP 导入，需用户授权配置该令牌并把 nginx `client_max_body_size` 提到 64m 以上。

---

## 11. hznzcn 源站（手动按需同步，不进定时）

> **策略（2026-11-26 起）**：`https://www.hznzcn.com` 恢复为**手动按需同步**，覆盖全部分页 × 全部叶子类目。
> **不挂 crontab**：生产机 IP 被源站 WAF 封，定时必然失败并浪费一天一次的重试。
> `run.sh` 的 `SITES` 默认仍只有 `egluosi`；hznzcn 只能人工显式触发。

### 11.1 策略

| 源 | 触发方式 | 说明 |
|---|---|---|
| `egluosi` | 定时，每日 02:30（Asia/Shanghai） | 唯一进 crontab 的源，`/opt/mixmapp/catalog-sync/run.sh`，默认全量全分类幂等累积 |
| `hznzcn` | **手动按需**（见 §11.3） | 不进 crontab；本地采集 + SSH 隧道写库 + 图片推送，可 `--resume` 跨多次累积到全量 |

服务器实际生效值（不是仓库文件）：

```bash
ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 \
  "crontab -l | grep catalog-sync; grep -n '^SITES=' /opt/mixmapp/catalog-sync/run.sh"
# 期望：
#   30 2 * * * /opt/mixmapp/catalog-sync/run.sh
#   SITES=${CATALOG_SITES:-"egluosi"}
```

> 生产机上的 `/opt/mixmapp/catalog-sync/run.sh` 是**独立副本**（不是 release 里的文件）。改完仓库
> `scripts/catalog/run.sh` 后要单独 `scp` 覆盖它；每次覆盖前先备份（安装脚本已保留 `run.sh.bak.<时间戳>`）。

### 11.2 为什么必须本地跑

生产机 IP 已被 hznzcn 源站 WAF 封（列表/详情直连返回连接重置或 403/444），在服务器上跑必然失败。
所以手动同步的链路固定为：

**本机采集（2.5s/请求限速） → SSH 隧道写生产 PG → 图片打包推送 `img.mixm.top`**

### 11.3 可直接粘贴执行的命令（本机 Git Bash）

```bash
cd /f/合并项目/MixmAPP

# ① 另开一个窗口保持隧道（Ctrl+C 结束）；15433 可换任意空闲端口
ssh -i ~/.ssh/mixmapp_deploy -N -L 15433:127.0.0.1:5432 root@115.159.159.11

# ② 取生产库连接串并把端口改成隧道口（凭据只放环境变量，不要写进文件/提交）
export DATABASE_URL_LOCAL="$(ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 \
  'grep -m1 ^DATABASE_URL_LOCAL= /etc/mixmapp/api.env' | cut -d= -f2- \
  | sed -E 's#@([^/:@]+):[0-9]+/#@127.0.0.1:15433/#')"

# ③ 采集 + 幂等写库（手动入口；默认全部分页 × 全部叶子类目）
#    --pages 0   = 每个叶子抓到源站没有下一页为止
#    per-cat 不传 = 不限制每类件数（全量）
node scripts/catalog/cli.mjs sync --site hznzcn --resume \
  --delay-ms 2500 --list-delay-ms 2500 --max-runtime-min 120 \
  --storage-dir storage
```

> 单轮默认 120 分钟预算，到点优雅收尾；下次继续 `--resume`（14 天内有效）从断点累积。
> 只是想让每个分类都有商品、不追求全量时，可加 `--per-cat 40` 做有界覆盖。
> 想先摸清全量规模（不抓详情、不写库）：
>
> ```bash
> node scripts/catalog/cli.mjs sync --site hznzcn --catalog-only --no-images \
>   --state-dir .catalog-sync/hznzcn-enum --max-runtime-min 60
> ```
>
> `--catalog-only` 会把每个叶子类目的商品清单落盘（逐类 checkpoint），规模过大时可
> `--resume` 分几次枚举完；随后去掉 `--catalog-only` 加 `--resume` 即可从已枚举目录继续抓详情。

参数含义与注意事项：

| 参数 | 作用 | 注意 |
|---|---|---|
| `--site hznzcn` | 走 `sites/hznzcn.mjs` 独立适配器 | **不会执行 egluosi 的采集/入库**，两源彻底解耦 |
| `--resume` | 14 天内未完成的运行从断点继续 | 没有可续跑的 state 时会自动清 state 重跑，可安全常带 |
| `--per-cat 40` | 可选取值：每个叶子最多 40 件（有界覆盖） | 有界运行 ⇒ `delistSafe=false`，**永不下架任何商品** |
| `--delay-ms 2500` | 请求间隔；适配器本身也强制 ≥2500ms | 不要再调小，WAF 会封 |
| `--max-runtime-min 120` | 单轮上限，到点收尾，下次续跑 | 不改也能跑，但长跑容易被系统/网络中断 |
| `--storage-dir storage` | 图片落到仓库 `storage/products/` | 下一步统一推送生产 |
| `--no-images` | 只写字段不下载图片（可选，调试用） | 正式同步不要带 |

幂等：新增走 `on conflict (source_key) do nothing`，已存在按字段 diff 只更新真正变化的列；
hznzcn 的 `source_key` 前缀是 `hzn:`、id 前缀 `hzn-`，与 egluosi 的 `sku:` / `egl-*` 不重叠，
**重跑不会产生重复行，也不会改 egluosi 的任何字段**。

### 11.4 图片推送

```bash
# 只把新图打过去（tar 里带路径，便于增量比对）
tar -czf /tmp/hzn-images.tgz -C storage products
scp -i ~/.ssh/mixmapp_deploy /tmp/hzn-images.tgz root@115.159.159.11:/tmp/
ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 \
  "tar -xzf /tmp/hzn-images.tgz -C /var/lib/mixmapp/storage --skip-old-files && \
   chown -R mixmapp:mixmapp /var/lib/mixmapp/storage/products && \
   find /var/lib/mixmapp/storage/products -type f | wc -l"
# 抽检（应 200 + image/*）
curl -sS -o /dev/null -w 'HTTP %{http_code} %{content_type}\n' \
  "https://cloud.mixm.top/media/products/<sha1>.jpg"
```

### 11.5 试跑与验证（不写库、不碰 egluosi）

```bash
# 小范围 dry-run：只抓 2 个叶子、最多 6 件，不写 products / 流水 / runs
export DATABASE_URL_LOCAL="…同上…"
node scripts/catalog/cli.mjs sync --site hznzcn --dry-run \
  --limit 2 --max-items 6 --no-images \
  --state-dir .tmp/hzn-dry --storage-dir .tmp/hzn-dry-storage

# 前后对比：egluosi 仍是 15037，hzn 仍是 426，无重复 source_key
node .tmp/count-sources.mjs before
```

dry-run 报告里应看到 `"dryRun": true`、`"delistSafe": false`，且 `stats.added` 不会落库。
正式跑完再执行一次 `node .tmp/count-sources.mjs after`，`sku:` 数量与 `last_synced` 必须与跑前一致。

### 11.6 回退

| 场景 | 回退方式 |
|---|---|
| 想把 hznzcn 临时加回定时 | `CATALOG_SITES="egluosi hznzcn" /opt/mixmapp/catalog-sync/run.sh`（一次性），或改回 `run.sh.bak.<时间戳>`（不建议，WAF 下必然失败） |
| 定时脚本改坏 | `cd /opt/mixmapp/catalog-sync && cp -p run.sh.bak.<时间戳> run.sh && bash -n run.sh` |
| 手动同步写错数据 | 采集只 upsert 不删除；按 `source_key like 'hzn:%'` 精确回删本次 run 新增行，或从 §3 的 DB 备份恢复（高危，需授权） |
| 图片推错/多推 | 图片只增不覆盖（`--skip-old-files`），按 sha1 文件名精确删除多余文件即可，不影响 egluosi 的既有图片 |

---

## 12. 每日无人值守续抓 + 图片高清回填（2026-11-26）

### 12.1 定时任务（只加 egluosi）

生产机实际生效的 crontab（`/opt/mixmapp/catalog-sync/run.sh` 是**独立副本**，不随 release 更新）：

```bash
# 安装/更新入口脚本（仓库改了 run.sh 后必须单独 scp；先备份）
scp -i ~/.ssh/mixmapp_deploy scripts/catalog/run.sh root@115.159.159.11:/tmp/catalog-run.sh
ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 '
  set -e
  D=/opt/mixmapp/catalog-sync
  mkdir -p "$D"
  [ -f "$D/run.sh" ] && cp -p "$D/run.sh" "$D/run.sh.bak.$(date +%Y%m%d%H%M%S)"
  install -m 755 /tmp/catalog-run.sh "$D/run.sh"
  bash -n "$D/run.sh"
  ( crontab -l 2>/dev/null | grep -v "catalog-sync/run.sh"; \
    echo "30 2 * * * $D/run.sh" ) | crontab -
  crontab -l | grep catalog-sync
'
```

`run.sh` 每日固定参数：`--resume --max-runtime-min 150 --no-delist`。

- `--resume`：上一轮没跑完就断点续，上一轮已完成就自动开新一轮全量（state.json `phase=done` 时清空重来）。
- `--max-runtime-min 150`：单轮最长 150 分钟，到点优雅收尾（runs 表记 `paused`），次日接着跑，**逐日累积到全量**。
- `--no-delist`：已有商品不下架，只 upsert（`CATALOG_NO_DELIST=0` 可恢复下架判定）。

手动触发一轮（与定时同参数，前台看日志）：

```bash
ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 \
  '/opt/mixmapp/catalog-sync/run.sh; tail -20 /var/lib/mixmapp/catalog-sync/sync.log'
```

查断点状态：

```bash
ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 \
  "cat /var/lib/mixmapp/catalog-sync/state.json; tail -5 /var/lib/mixmapp/catalog-sync/sync.log"
```

### 12.2 图片高清策略与回填

- 采集器默认取源站**无后缀原图** `img1~img4`（1000×1000 原图质量，文件最大）与 `spec`（1121×668），
  `_l/_m/_s` 仅在 404 时降级；同内容图按 SHA1 去重，不再出现重复图。
- egluosi 回填（生产机直接跑，~12 分钟）：

```bash
ssh -i ~/.ssh/mixmapp_deploy root@115.159.159.11 '
  set -a; . /etc/mixmapp/api.env; set +a
  node /opt/mixmapp/current/scripts/catalog/reimage.mjs --storage-dir /var/lib/mixmapp/storage \
      --max-runtime-min 60
'
# 先看影响面：加 --dry-run
```

- hznzcn 回填（生产机被封，必须本地跑 + 隧道；只升级、不降级）：

```bash
# 本机，保持 §11.3 的 SSH 隧道
export DATABASE_URL_LOCAL="…同 §11.3…"
node scripts/catalog/reimage.mjs --site hznzcn --resume \
  --storage-dir storage --max-runtime-min 120 --reimage-min-side 800
# 只统计不写库：--dry-run
```

规则：只对「库里最大边 ≤ 800px」的 hzn 商品重抓详情页原图，**只有新图确实更大才写库**，
不动 egluosi、不编造字段；`--resume` 可跨多次手动运行累积完成。

### 12.3 回退

| 场景 | 回退方式 |
|---|---|
| 定时参数想恢复旧行为 | 用 `run.sh.bak.<时间戳>` 覆盖回去，`bash -n` 后无需动 crontab |
| 想临时停掉定时 | `crontab -l \| grep -v catalog-sync/run.sh \| crontab -`（删行）；恢复用 §12.1 的安装命令 |
| 图片回填写错 | 只改了 `images / cover / spec_image`；按 `source_key` 或 c3 从 §3 的 DB 备份恢复对应列，图片文件只增不覆盖，删多余 sha1 文件即可 |
| 预算收尾导致未完成 | 不是故障；下一次定时/手动加 `--resume` 会接着跑，`state.json` 与 `catalog.json(partial=true)` 可查进度 |
