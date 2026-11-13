# 访问域名与网址清单（MixmAPP）

实测时间：2026-11-13（Asia/Shanghai）
实测位置：中国大陆网络（宁波）
实测方法：`Resolve-DnsName` 解析 + `curl` 状态码/字节数/证书握手，静态站另抓取 HTML 内的 API 基址
结论口径：只有本次实测拿到响应的一律标「可用」；解析存在但握手/内容不对的标「受限」；无解析的标「未解析」。

---

## 一、MixmAPP 本项目入口

| 用途 | 地址 | 实测 | 备注 |
|---|---|---|---|
| Web / H5（GitHub Pages） | https://afdk1991.github.io/MixmAPP/ | ✅ 200，473 KB 单文件 | 产物内嵌 API 基址 `https://cloud.mixm.top/mixmapp/api/v1` |
| Web / H5（腾讯云 CloudBase 静态托管） | https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/ | ✅ 200，473 KB | 与 Pages 同一份内容，同一 API 基址 |
| 生产 API 根 | https://cloud.mixm.top/mixmapp/api/v1 | ⚠️ 受限 | HTTP 层正常，443 证书不含该域名，浏览器直开会报证书错误（详见第六节） |
| 生产 API 健康检查 | https://cloud.mix.top/mixmapp/api/v1/healthz、`/readyz`、`/meta` | ⚠️ 受限 | `curl -k` 下 `/meta` 返回 200 JSON；不跳过校验则握手失败 |
| 生产源站（服务器） | 115.159.159.11（80 / 443） | ✅ 可达 | nginx 对外 443 默认站点应答的是 Mim 站；API 进程为 systemd `mixmapp-api`，监听 127.0.0.1:8080 |
| 本地 API | http://127.0.0.1:8080/api/v1 | 本机自用 | `pnpm dev:api` |
| 本地 H5 开发 | http://127.0.0.1:5173 | 本机自用 | `pnpm dev:h5`，`/api` 代理到 8080 |
| 本地 H5 产物预览 | http://127.0.0.1:4173 | 本机自用 | `node scripts/serve-h5.mjs` |

## 二、配套托管与制品地址

| 用途 | 地址 | 实测 | 备注 |
|---|---|---|---|
| 源码仓 | https://github.com/afdk1991/MixmAPP | ✅ | 公开主仓（Pages 由主仓直接托管） |
| 容器镜像 | `ghcr.io/afdk1991/mixmapp:latest`（另带 `sha` 标签） | 已发布 | 私有包，匿名拉取 401 |
| CloudBase 网关中继（`/mixmapp` → 云函数 `mixmapp-api-proxy` → 源站） | https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mixmapp | ⚠️ 502 | 返回 `UPSTREAM_UNREACHABLE / no json upstream`；两条上游（`115.159.159.11:80` 得 404、`:443` 得 Mim SPA HTML）都不是本 API |
| CloudBase 云 PG 网关 | https://cs-1-d5g815slocb5a611a.api.tcloudbasegateway.com | 401 | 仅后端调用，需 `CLOUDBASE_PG_API_KEY` |

## 三、`mixm.top` 下已解析的记录（同根域，含其他项目）

| 域名 | 解析 | 实测 | 归属 |
|---|---|---|---|
| `mim.mixm.top` | A → 115.159.159.11 | ✅ 200，`<title>Mim</title>` | Mim 主站（自建服务器） |
| `data.mixm.top` | CNAME → `data.mixm.top.pages.dnsoe5.com`（腾讯云 EdgeOne；落地 114.237.67.60） | ✅ 200，`<title>Mim</title>` | Mim 前端（EdgeOne CDN） |
| `cloud.mixm.top` | A → 115.159.159.11 | ⚠️ 证书不匹配 | MixmAPP 生产 API 入口 |
| `gy.mixm.top` | CNAME → `gale-engine-landing-6j02gsvv.edgeone.cool` → `…pages.dnsoe5.com`（落地 61.170.82.52） | 418 | 疾风引擎落地页（EdgeOne Pages），边缘节点返回拦截页，浏览器是否放行未验证 |
| `mixm.top`（根域） | 无 A / CNAME 记录 | ❌ 无法打开 | 规划中为「主站统一跳转门户」，尚未落地 |

## 四、规划但尚未建解析的子域

来源：仓库根目录 `dnspod_records_2026-11-05_21-42-26.xls`（`mixm.top` 表，46 条主机记录）。该表「记录类型」「记录值」两列为空，属命名模板而非可导入的真实解析；下表为逐条用途。

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
| `cloud.mix.top` → AWS Global Accelerator（13.248.169.48 / 76.223.54.146） | 已变更 | README「已知基础设施缺陷」一节记录的 GA 解析已不存在，当前 A 记录指向 115.159.159.11；但 443 证书问题仍在（见第六节） |
| `laal.top` 及其 45 个同名子域 | ❌ NXDOMAIN | `dnspod_records…xls` 中的第二张表，整域未启用 |

## 六、结论与待办（按优先级）

1. **`cloud.mix.top` 的 443 未接管**（唯一阻塞项）：DNS 已指向源站 115.159.159.11，`curl -k` 可拿到 200 JSON，但标准握手返回 `TLSV1_UNRECOGNIZED_NAME`，说明对外 443 应答的证书/默认站点不是 `cloud.mix.top`（生产机上 `sites-enabled` 有 `mixmapp.conf`，但未在对外监听上生效）。修法：让 `cloud.mix.top` 的 vhost 真正接管 443 并挂上含该域名的证书（此前签发的证书有效期至 2027-02-10，需确认其 SAN 是否包含该域名）。修好后前端无需改任何地址。
2. **CloudBase 中继 502**：`mixmapp-api-proxy` 仍是「双上游回退 + trace」的诊断态，两条上游都不是 JSON API；接上可达源站后应把上游固定、去掉 trace，并恢复 `rejectUnauthorized`。
3. **根域 `mixm.top` 无解析**：规划为主站跳转门户，未落地。
4. **其余 40 个子域未建解析**：需按 DNSPod 模板逐条创建，并逐平台绑定（映射建议见 `docs/08-platform-matrix.md`「域名映射」）。
5. **网页深链接**：GitHub Pages 单个文件对深路径返回 404（客户端路由可渲染），换自定义域前建议先定 hash 路由或 SPA 回退方案。

## 附：复核命令

```powershell
# 解析核查（示例）
Resolve-DnsName -Name mim.mixm.top | Select-Object Name,Type,IPAddress,NameHost
Resolve-DnsName -Name gy.mixm.top  | Select-Object Name,Type,IPAddress,NameHost

# 站点与 API 状态（-k 跳过证书校验，仅用于判断 HTTP 层）
curl.exe -sk -o NUL -w "%{http_code} %{size_download}`n" https://afdk1991.github.io/MixmAPP/
curl.exe -sk -o NUL -w "%{http_code}`n" https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/
curl.exe -sS -o NUL -w "%{http_code}`n" https://cloud.mix.top/mixmapp/api/v1/healthz   # 不加 -k，观察证书问题
```
