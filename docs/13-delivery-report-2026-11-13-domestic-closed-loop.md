# 交付报告 13 — 国内生产闭环攻坚：CloudBase 中继链路的实证与边界

日期：2026-11-13
版本：仍为 `V0.0.0-preview`（本轮无功能变更，按版本规约不占号、不递增）

## 一、本轮目标

用户连续四轮（「真实」「全部走」「全部」「全部」）要求：国内浏览器打开线上站点不应出现 `OFFLINE`，且登录、加购、下单真实打到生产 API。本轮把「所有还能走的路」逐条走完并逐条取证。

## 二、结论先行

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 生产 API 进程本身 | 健康 | 生产机内 `curl http://127.0.0.1:8080/api/v1/meta` → `200` |
| `cloud.mix.top` 国内直连 | 不可用 | TLS alert 112（`tlsv1 unrecognized name`） |
| `cloud.mix.top` 经腾讯云上海（CloudBase 云函数）访问 | 同样不可用 | 中继函数返回 `ssl3_read_bytes:tlsv1 unrecognized name` alert 112 |
| `115.159.159.11` 直连（CloudBase 云函数发出） | 命中 mim 站，不是本 API | `:80` → `404 text/html nginx`；`:443` → `200 text/html` 的 mim SPA |
| 生产机内 `cloud.mix.top` vhost（loopback + SNI） | 不存在该 vhost | 返回 mim SPA HTML，`sites-enabled` 虽含 `mixmapp.conf` 但未接管该 SNI |
| CloudBase 网关路由 `/mixmapp` → 中继云函数 | 已建成且链路可用 | 探测可拿到上游真实响应体，说明网关→函数→上游整条链是通的 |
| 两个静态站内容一致性 | 已修复并上线（上一轮） | Pages run `43249567035`；CloudBase `MixmAPP-004` buildId `2612291692` SUCCESS |

一句话：**链路已经通到最后一跳，最后一跳（`cloud.mix.top` 的接入层）在国内全断，且它不由本仓库控制。**

## 三、这一轮具体做了什么

1. **CloudBase HTTP 云函数中继**（`mixmapp-api-proxy`）
   - 首建失败根因：HTTP 云函数要求包内可执行 `scf_bootstrap`（`ResourceNotFound.BootstrapFile`）。
   - 修正：改为真正的 `http.createServer` 常驻服务，`scf_bootstrap`（`#!/bin/bash` + `node index.js`）以 `0755` 权限写入 zip（Python `zipfile` 的 `external_attr`）。
   - 创建成功（`RequestId 95a4c624-76bc-423f-bdb7-feb5f1f4bf98`）。
2. **网关路由**：`/mixmapp` → `WEB_SCF mixmapp-api-proxy`，`enablePathTransmission=true`、`auth=false`，域名 `cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com`（`RequestId 4909941e-0332-4255-9305-300f7fe79532`）。
3. **中继函数内置双上游回退 + 诊断 trace**，实测输出：
   ```json
   {"ep":"http://115.159.159.11:80","status":404,"type":"text/html","head":"<html>...404 Not Found...nginx/1."}
   {"ep":"https://115.159.159.11:443","status":200,"type":"text/html; charset=utf-8","head":"<!doctype html>...mim SPA..."}
   ```
4. **生产机一次性诊断**（`.github/workflows/ops-diag.yml`，用完即删）：
   ```
   meta=200
   CLOUDBASE_PG_GATEWAY=https://cs-1-d5g815slocb5a611a.api.tcloudbasegateway.com
   CLOUDBASE_PG_SCHEMA=mixmapp
   CLOUDBASE_PG_API_KEY=***（被日志脱敏）
   vhost via loopback SNI → <!doctype html>（mim SPA，不是 API JSON）
   ```

## 四、为什么这最后一跳在本仓库内改不动

1. `cloud.mix.top` 及 `*.mix.top` 全部解析到 AWS Global Accelerator（`13.248.169.48` / `76.223.54.146`），GA 在中国大陆不可达（TLS alert 112）。这不是证书问题，是接入层被网络侧拒绝。
2. 生产机的对外 443 命中的是 **mim 站的 nginx**，`mixmapp.conf` 里的 `cloud.mix.top` vhost 并没有在该机对外监听上生效（loopback + 正确 SNI 仍返回 mim SPA 可证）。
3. 想让国内浏览器拿到 API，必须在「国内可达的域名 → 国内可达的源」之间建立新映射，两种改法都落在同一个前置条件上：
   - **改 DNS**：把 `cloud.mix.top` 从 GA 记录改回腾讯云 EIP 直连（需 `mix.top` 的 DNS 管理权限）；
   - **换托管**：把 API 跑在国内可达的托管（腾讯云 CloudRun / 阿里云 FC 等），并使用该平台的默认域名（需把 `CLOUDBASE_PG_API_KEY` 搬到新环境；该值在 `/etc/mixmapp/api.env` 中，取值只能从生产机读取）。

## 四之二、免凭据方案也试过了：Cloudflare 快速隧道在本机不可行

思路：在生产机上跑 `cloudflared tunnel --url http://127.0.0.1:8080`，拿一个 `*.trycloudflare.com` 的国内可达 HTTPS 域名，前端 `MIXMAPP_API_BASE` 指过去，即可零凭据打通国内访问。

实测阻断点（`.github/workflows/ops-tunnel.yml`，试跑三次后删除）：

| 尝试 | 结果 |
| --- | --- |
| 直接 `setsid` 起隧道 | SSH 会话被后台进程持有，`timeout 150` 被杀（exit 124） |
| 改 `systemd-run` 脱离会话 | 下载步骤先失败：`curl: (28) Failed to connect to github.com port 443 after 130611 ms: Connection timed out` |
| 强制 `--http1.1` 重试 | 同样超时 |

结论：**生产机出网到 GitHub 被阻断**，cloudflared 二进制无法下载，隧道方案在本机资料条件下不成立。

## 五、未做但已记录的风险（不留暗账）

- CloudBase 中继函数当前是「双上游回退 + trace」形态，属于诊断态。若后续接上可达源站，需把上游固定为该源站并去掉 trace 输出。
- 中继函数上游使用 `rejectUnauthorized=false`（为绕过 GA 证书链问题的临时手段）。一旦改为直连自建源站，必须恢复证书校验。
- 逐页验收仍只覆盖首页、登录、商城、我的；购物车、订单、ID 试算器、关于尚未逐页截图（同一单文件，理论上一致，但未取证）。
- GitHub Pages 深链接仍返回 HTTP 404（内容与首页相同的单文件，客户端路由可渲染）；彻底方案是 hash 路由或换 SPA 回退平台，会改动既有链接，未擅自变更。
- Android AAB 仍缺 keystore，签名未闭环。

## 六、本轮门禁与自测

| 检查 | 命令/动作 | 结果 |
| --- | --- | --- |
| 生产 API 存活 | 生产机 `curl -w '%{http_code}' /api/v1/meta` | `200` |
| 中继函数构建 | Python zipfile 打包 + `scf_bootstrap 0755` | zip 1477 B / b64 1972 字符 |
| 云函数创建 | `callCloudApi tcb CreateFunction` | `RequestId 95a4c624-...` 成功 |
| 网关路由 | `manageGateway createRoute` | `success: true`，`accessUrl` 已返回 |
| 网关→函数→上游 | `curl` 网关地址 | 拿到上游真实响应体（HTML / 404），链路通 |
| 上游可达性（国内） | 同上 trace | `alert 112` + mim 站，两条上游均非目标 API |

## 七、要让 `ONLINE` 变绿，只剩两个二选一的动作（都需要一项外部权限）

1. **DNS 改向**：把 `cloud.mix.top` 从 GA 改解析到腾讯云 EIP，并在该机 nginx 上让 `mixmapp.conf` 真正接管 443 的 `cloud.mix.top`。之后 `https://cloud.mix.top/mixmapp/api/v1` 在国内即可直接使用，前端无需改一行代码。
2. **换国内托管**：把 `services/api` 部署到腾讯云 CloudRun（同环境、默认域名 `*.app.tcloudbase.com` 国内可达），环境变量沿用 `CLOUDBASE_PG_GATEWAY` / `CLOUDBASE_PG_SCHEMA` / `CLOUDBASE_PG_API_KEY`；随后把前端 `MIXMAPP_API_BASE` 指向新域名并重发 Pages 与 CloudBase 静态站。

两项的前置字段都只差一处凭据：DNS 记录编辑权，或 `CLOUDBASE_PG_API_KEY` 的读取权。除此之外的代码、构建、部署、取证链路本轮已全部跑通并留证。
