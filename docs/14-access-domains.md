# 访问域名与网址清单（MixmAPP）

实测时间：2026-11-13（Asia/Shanghai）
实测位置：中国大陆网络（宁波，不跳过证书校验）
实测方法：`Resolve-DnsName` / DNSPod 权威 NS 直查 + `curl` 状态码与内容类型 + `python ssl` 读取证书 CN/SAN + 抓取静态站 HTML 内嵌的 API 基址（逐字符比对）

> **重要命名提醒（本次事故根因）**：本项目域名是 `mixm.top`（m-i-x-m），生产 API 主机是 `cloud.mixm.top`。
> 仓库历史文档、README、以及生产机 nginx 配置里曾大量出现 `cloud.mix.top`（少一个 m）。`mix.top`（m-i-x）是**另一个域名**，
> 解析到 AWS 停放服务（`13.248.169.48` / `76.223.54.146`），与本项目无关——此前“国内 TLS alert 112 / GA 不可达”的结论全部来自这个错误域名。
> 本文已按真名更正。

---

## 一、MixmAPP 本项目入口

| 用途 | 地址 | 实测（2026-11-13） | 备注 |
|---|---|---|---|
| Web / H5（GitHub Pages） | https://afdk1991.github.io/MixmAPP/ | ✅ 200，473 KB 单文件；页面状态显示 `ONLINE` | 产物内嵌 API 基址 `https://cloud.mixm.top/mixmapp/api/v1`（正确，逐字符核对） |
| Web / H5（腾讯云 CloudBase 静态托管） | https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/ | ✅ 200，473 KB | 旧产物内嵌错误基址 `cloud.mix.top`（少 m）→ 页面显示 `OFFLINE`；已于 20:37 重发版本 `mixmapp-005` 修正为 `cloud.mixm.top` |
| 生产 API 根 | https://cloud.mixm.top/mixmapp/api/v1 | ✅ 200 `application/json` | DNS A → 115.159.159.11；证书 CN/SAN 均为 `cloud.mixm.top`，有效期至 2027-02-10 |
| 生产 API 健康检查 | https://cloud.mixm.top/mixmapp/api/v1/healthz、`/readyz`、`/meta` | ✅ 全部 200 | `healthz` 返回 `status=ok`、`db=ok`、`dbTarget=cloudbase`、`dbHost=127.0.0.1:5432` |
| 生产源站（服务器） | 115.159.159.11（80 / 443） | ✅ 可达 | 443 由 nginx `conf.d/cloud-mixmapp.conf` 接管；API 进程 systemd `mixmapp-api` 监听 127.0.0.1:8080 |
| 本地 API | http://127.0.0.1:8080/api/v1 | 本机自用 | `pnpm dev:api` |
| 本地 H5 开发 | http://127.0.0.1:5173 | 本机自用 | `pnpm dev:h5`，`/api` 代理到 8080 |
| 本地 H5 产物预览 | http://127.0.0.1:4173 | 本机自用 | `node scripts/serve-h5.mjs` |

## 二、配套托管与制品地址

| 用途 | 地址 | 实测 | 备注 |
|---|---|---|---|
| 源码仓 | https://github.com/afdk1991/MixmAPP | ✅ | 公开主仓（Pages 由主仓直接托管）；无 gitee remote |
| 容器镜像 | `ghcr.io/afdk1991/mixmapp:latest`（另带 `sha` 标签） | 已发布 | 私有包，匿名拉取 401 |
| CloudBase 网关中继（`/mixmapp` → 云函数 `mixmapp-api-proxy` → 源站） | https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mixmapp | ⚠️ 502 | 函数上游的 `hostHeader` / `sni` 同样写成了错误的 `cloud.mix.top`，导致回源命中的是 Mim 的 SPA → `no json upstream`；代码已更正为 `cloud.mixm.top`，云函数需重新发布后才会生效 |
| CloudBase 云 PG 网关 | https://cs-1-d5g815slocb5a611a.api.tcloudbasegateway.com | 401 | 仅后端调用，需 `CLOUDBASE_PG_API_KEY` |

## 三、`mixm.top` 下已解析的记录（同根域，含其他项目）

> **口径（2026-11-14 收紧）**：本节是 2026-11-13 的线上实测记录，**不是 DNSPod 导出表**。DNSPod 导出表
> `dnspod_records_2026-11-05_21-42-26.xls` 只有「主机记录 / 线路 / TTL / 备注」四列，记录类型、记录值、
> 状态三列全空；下表 `A →`、`CNAME →` 等指向来自 `Resolve-DnsName` 实测，仅作运维参考。域名落点与
> 表内归属以 `deploy/domains.json` 为准，表外来源（GitHub Pages、CloudBase、`mix.top`）不计入在用。

| 域名 | 解析 | 实测 | 归属 |
|---|---|---|---|
| `mim.mixm.top` | A → 115.159.159.11 | ✅ 200，`<title>Mim</title>` | Mim 主站（自建服务器，nginx vhost `mim.conf`） |
| `data.mixm.top` | CNAME → `data.mixm.top.pages.dnsoe5.com`（腾讯云 EdgeOne；落地 114.237.67.60） | ✅ 200，`<title>Mim</title>` | Mim 前端（EdgeOne CDN） |
| `cloud.mixm.top` | A → 115.159.159.11 | ✅ 200 JSON，证书 SAN 正确 | MixmAPP 生产 API 入口（本次修复） |
| `gy.mixm.top` | CNAME → `gale-engine-landing-6j02gsvv.edgeone.cool` → `…pages.dnsoe5.com`（落地 61.170.82.52） | 418 | 疾风引擎落地页（EdgeOne Pages），边缘节点拦截页 |
| `mixm.top`（根域） | 无 A / CNAME | ❌ 无法打开 | 规划为「主站统一跳转门户」，尚未落地 |

DNSPod `mixm.top` 区里与 cloud 相关的记录共 3 条：`cloud` A 115.159.159.11（开启）、`cloud.mixm.top` A 115.159.159.11（开启，备注「云服务模块入口」）、`cloud` A 103.0.113.20（暂停，模板遗留）。**无需改 DNS。**

## 四、规划但尚未建解析的子域

来源：仓库根目录 `dnspod_records_2026-11-05_21-42-26.xls`（`mixm.top` 表，103 行原始记录、53 个唯一主机）。该表「记录类型」「记录值」「状态」列为空，属命名模板而非可导入的真实解析；下表为逐条用途。

机器可读版本见 [deploy/domains.json](../deploy/domains.json)：在用 1 个（`cloud`）+ 同根域其他项目 3 个（`mim`/`data`/`gy`）+ EdgeOne 验证 7 条 + 规划未解析 42 个。仓库改动后执行 `pnpm domains:check` 校验一致性。

| 类别 | 主机记录 | 规划用途（取自 xls 备注） | 解析状态 |
|---|---|---|---|
| 主站 / 门户 | `@`、`mixm.top` | 核心根域名，主站统一跳转门户 | ❌ |
| 主站 / 门户 | `www`、`www.mixm.top` | 主站常规访问入口｜官方门户网站 | ❌ |
| 主站 / 门户 | `portal` | 企业内部统一门户 / 工作台 | ❌ |
| 主站 / 门户 | `m` | 移动端 H5 精简版官网 | ❌ |
| 主站 / 门户 | `mobile` | 全功能移动端站点 | ❌ |
| 身份 / 权限 | `auth` | 统一身份认证与权限中心 | ❌ |
| 身份 / 权限 | `login` | 统一单点登录页 | ❌ |
| 身份 / 权限 | `center` | 用户个人中心 / 会员工作台 | ❌ |
| 身份 / 权限 | `user` | 用户会员管理后台 | ❌ |
| 身份 / 权限 | `admin` | 全站统一运营管理后台 | ❌ |
| 接口 | `api` | API 统一网关 | ❌ |
| 接口 | `app` | APP 端专用接口服务 | ❌ |
| 交易 | `mall` | B2C 官方商城系统 | ❌ |
| 交易 | `shop` | 多商户店铺系统 | ❌ |
| 交易 | `market` | 营销活动管理平台 | ❌ |
| 交易 | `pay` | 支付聚合网关 + 对账系统 | ❌ |
| 交易 | `b2b` | B2B 企业批发采购平台 | ❌ |
| 交易 | `supplier` | 供应商后台管理系统 | ❌ |
| 交易 | `c2c` | C2C 个人闲置 / 商品交易平台 | ❌ |
| 交易 | `seller` | 个人卖家店铺管理后台 | ❌ |
| 交易 | `yp` | 货源商品库平台 | ❌ |
| 内容 | `blog` | 官方博客系统 | ❌ |
| 内容 | `news` | 新闻资讯发布系统 | ❌ |
| 内容 | `xw` | 自媒体资讯平台 | ❌ |
| 内容 | `video` | 独立视频播放页 | ❌ |
| 内容 | `dy` | UGC 短视频动态社区 | ❌ |
| 内容 | `sp` | 长视频点播系统 | ❌ |
| 内容 | `wp` | WordPress 独立站点 | ❌ |
| 工具 / 资源 | `gy` | 疾风引擎在线工具平台 | ✅ 已解析（见第三节） |
| 工具 / 资源 | `dnpj` | 低代码生成平台 | ❌ |
| 工具 / 资源 | `img` | 公共图床 + 素材资源站 | ❌ |
| 工具 / 资源 | `store` | 软件源码下载分发站 | ❌ |
| 工具 / 资源 | `dh` | 全站资源导航站 | ❌ |
| 工具 / 资源 | `yy` | 语音工具服务平台 | ❌ |
| 数据 | `data` | 开放数据集平台 | ✅ 已解析（当前被 Mim 前端占用） |
| 数据 | `sj` | 爬虫调度与数据采集平台 | ❌ |
| 数据 | `stats` | 全站数据 BI 看板 | ❌ |
| 运维 / 支撑 | `cloud` | 私有云盘 / 网盘系统 | ✅ 已解析（当前为 MixmAPP API） |
| 运维 / 支撑 | `fwq` | 运维监控面板 | ❌ |
| 运维 / 支撑 | `secure` | 安全防护中心 | ❌ |
| 运维 / 支撑 | `service` | 服务治理监控平台 | ❌ |
| 运维 / 支撑 | `help` | 产品帮助文档中心 | ❌ |
| 运维 / 支撑 | `support` | 工单客服系统 | ❌ |
| 环境 | `dev` | 开发环境门户 + 接口文档 | ❌ |
| 环境 | `test` | 测试环境统一入口 | ❌ |

## 五、历史 / 已下线地址

| 地址 | 状态 | 说明 |
|---|---|---|
| https://afdk1991.github.io/mixmapp-h5/ | ❌ 404 | 旧产物仓已删除 |
| https://mixmapp-h5-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com | ❌ 404 | 旧 CloudBase 应用已删除，现用 `mixmapp-cs-1-…` |
| `mix.top` 及其停放子域（`cloud.mix.top` 等） | 无关 | `mix.top` 是另一个域名，解析到 AWS 停放（13.248.169.48 / 76.223.54.146）。历史文档把它当成本项目 API 的错误结论已作废 |
| `laal.top` 及其 90 条同名记录 | ❌ NXDOMAIN | `dnspod_records…xls` 的第二张表，整域未启用（DNSPod 里显示「暂停」） |

## 六、本次修复记录（2026-11-13）

### 1. 根因

`cloud.mixm.top` 打不开不是 DNS 问题，也不是证书问题，而是两处**拼写少一个 m**：

1. 生产机 nginx 的 vhost 写成 `server_name cloud.mix.top;`（`sites-enabled/mixmapp.conf`）。SNI 永不匹配 → 回落 `mim` 默认站 → 客户端收到 `alert 112 TLSV1_UNRECOGNIZED_NAME`，且 `Host: cloud.mixm.top` 的请求也被 Mim SPA 处理。
2. 历史文档与 CloudBase 静态产物把 API 基址写成 `https://cloud.mix.top/mixmapp/api/v1`，这个域名属于 `mix.top`（停放），必然连不上 → 页面长期显示 `OFFLINE`。

证书本身一直是对的：`/etc/letsencrypt/live/cloud.mixm.top/fullchain.pem`，SAN `DNS:cloud.mixm.top`，有效期至 2027-02-10。

### 2. 动作

- 新建 `/etc/nginx/conf.d/cloud-mixmapp.conf`：443 + 80 两个 server 块，`server_name cloud.mixm.top`，`/mixmapp/` → `127.0.0.1:8080`，`/` → `127.0.0.1:8787`，保留 certbot include、dhparam、独立日志 `mixmapp.access.log` / `mixmapp.error.log`。
- 把 `sites-enabled/mixmapp.conf` 软链移出到 `/root/nginx-backup-20261113/mixmapp.conf.symlink`；原文件仍留在 `/etc/nginx/sites-available/mixmapp.conf`（**内含错误 server_name，请勿重新启用**）。
- `nginx -t` 通过后 `systemctl reload nginx`。
- 重新构建并重发 CloudBase 静态站（`mixmapp-005`，API 基址改为 `cloud.mixm.top`）。
- 更正 `cloudbase/functions/mixmapp-api-proxy` 的 `hostHeader` / `sni`（原为 `cloud.mix.top`）。

### 3. 验证（宁波家用网络，未跳过证书校验）

```powershell
curl.exe -sS -o NUL -w "%{http_code} %{content_type}`n" https://cloud.mixm.top/mixmapp/api/v1/meta   # 200 application/json
curl.exe -sS https://cloud.mixm.top/mixmapp/api/v1/healthz                                          # status=ok, db=ok, dbTarget=cloudbase
python -c "import ssl,socket;ctx=ssl.create_default_context();s=ctx.wrap_socket(socket.create_connection(('cloud.mixm.top',443),8),server_hostname='cloud.mixm.top');print(s.getpeercert()['subject'], s.getpeercert()['subjectAltName'])"
# (('commonName','cloud.mixm.top'),) (('DNS','cloud.mixm.top'),)
```

浏览器侧：GitHub Pages 首页状态 `ONLINE`；CloudBase 静态站重发后同样应回到 `ONLINE`。

## 七、待办（按优先级）

1. **CloudBase 中继云函数重新发布**：代码已改，未发布前 `/mixmapp` 网关仍是 502。
2. **根域 `mixm.top` 无解析**：规划为主站跳转门户，未落地。
3. **其余 40 个子域未建解析**：需按 DNSPod 模板逐条创建并逐平台绑定（映射建议见 `docs/08-platform-matrix.md`「域名映射」）。
4. **网页深链接**：GitHub Pages 单文件托管对深路径返回 404（客户端路由可渲染），上自定义域名前建议先定 hash 路由或 SPA 回退方案。
5. **清理 `sites-available/mixmapp.conf`**：确认无回滚需求后删除或修正，避免误启用导致复发。

## 附：复核命令

```powershell
# 解析核查
Resolve-DnsName -Name cloud.mixm.top | Select-Object Name,Type,IPAddress
Resolve-DnsName -Name mim.mixm.top   | Select-Object Name,Type,IPAddress

# 站点与 API（严格校验证书）
curl.exe -sS -o NUL -w "%{http_code} %{size_download}`n" https://afdk1991.github.io/MixmAPP/
curl.exe -sS -o NUL -w "%{http_code} %{size_download}`n" https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/
curl.exe -sS https://cloud.mixm.top/mixmapp/api/v1/healthz

# 产物内嵌 API 基址逐字符核对（防再次出现「少一个 m」）
python -c "import re,io,sys;s=io.open(sys.argv[1],encoding='utf-8',errors='replace').read();print(['-'.join(h) for h in sorted(set(re.findall(r'https://(cloud\.mix[a-z]*\.top)',s)))]);" .\release\mixmapp-h5-single.html
# 期望输出：['c-l-o-u-d-.-m-i-x-m-.-t-o-p']
```
