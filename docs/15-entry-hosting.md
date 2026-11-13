# 入口首页托管与访问域名（MixmAPP）

实测时间：2026-11-13 21:10–21:20（Asia/Shanghai），中国大陆网络（宁波），不跳过证书校验。

## 一句话结论

`https://cloud.mix.top/` 打不开是**域名写错**：项目域名是 `mixm.top`（m-i-x-m），不是 `mix.top`（m-i-x）。
`mix.top` 是另一个域名，解析到停放服务（13.248.169.48 / 76.223.54.146），TLS 直接握手失败（`SEC_E_ILLEGAL_MESSAGE`）。
真实主机是 `cloud.mixm.top` → `115.159.159.11`（生产机）。

## 现在可访问的入口（三处同源同一份单文件 H5）

| 入口 | 地址 | 托管方 | 生效方式 |
|---|---|---|---|
| 生产机自托管（推荐） | <https://cloud.mixm.top/> | 生产机 nginx（`location = /` → `/var/www/mixmapp-site/index.html`） | 改完 H5 后 `scp` 覆盖 + 可选 reload |
| GitHub Pages | <https://afdk1991.github.io/MixmAPP/> | `.github/workflows/pages.yml` | push 到 `main` 且命中 `apps/app/**` 时自动构建发布 |
| CloudBase 静态托管 | <https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/> | 腾讯 CloudBase 应用 `mixmapp`（当前 `mixmapp-007`） | getUploadUrl → PUT zip → deployApp |

API 三处都走同一个生产接口：`https://cloud.mixm.top/mixmapp/api/v1`（同源，无跨域问题）。

## `cloud.mixm.top/` 之前为什么是 404

`/etc/nginx/conf.d/cloud-mixmapp.conf` 原来的 `location /` 把一切非 `/mixmapp/` 路径转发给 `127.0.0.1:8787`（那是 **Mim** 站，另一个项目）。
Mim 没有 `/` 这个页面，于是访客打开域名根拿到 404 —— 不是 API 挂了，是**根路径指错了上游**。

## 本次改动（可回滚）

1. `mkdir -p /var/www/mixmapp-site`，把 `release/mixmapp-h5-single.html`（469.8 KB，内嵌 `https://cloud.mixm.top/mixmapp/api/v1`）上传为 `/var/www/mixmapp-site/index.html`。
2. nginx 增加最小精确匹配，优先于 `location /`：

```nginx
location = / {
    root /var/www/mixmapp-site;
    try_files /index.html =404;
    add_header Cache-Control "public, max-age=300" always;
}
```

3. `nginx -t` 通过 → `systemctl reload nginx`。
4. 备份：`/root/nginx-backup-20261113/cloud-mixmapp.conf.<时间戳>-selfhost.bak`（本次改动前）与更早的 `...conf.<时间戳>.bak`。

## 复核命令（可直接贴）

```bash
# 根路径：应为 200 且是与 Pages/CloudBase 同一份单文件 H5
curl -sS -o /dev/null -w "root=%{http_code} size=%{size_download}\n" https://cloud.mixm.top/
# API 健康：应为 200，body 含 db=ok
curl -sS -o /dev/null -w "healthz=%{http_code}\n" https://cloud.mixm.top/mixmapp/api/v1/healthz
# 证书：CN/SAN 必须是 cloud.mixm.top
openssl s_client -connect cloud.mixm.top:443 -servername cloud.mixm.top </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
```

本地（Windows PowerShell）等价写法：

```powershell
curl.exe -sS -o NUL -w "root=%{http_code} size=%{size_download}`n" https://cloud.mixm.top/
curl.exe -sS -o NUL -w "healthz=%{http_code}`n" https://cloud.mixm.top/mixmapp/api/v1/healthz
```

## 以后改首页要同步三处

```powershell
# 1) 构建单文件产物（Pages 侧交给 CI，这里只服务自托管与 CloudBase）
cd F:\合并项目\MixmAPP
$env:MIXMAPP_H5_BASE='/'; $env:MIXMAPP_API_BASE='https://cloud.mixm.top/mixmapp/api/v1'
node scripts/build-h5-single.mjs

# 2) 生产机自托管
scp -i C:\Users\Admin\.ssh\mixmapp_deploy release\mixmapp-h5-single.html root@115.159.159.11:/var/www/mixmapp-site/index.html

# 3) CloudBase：getUploadUrl(serviceName=mixmapp) → PUT zip → deployApp(cosTimestamp)
#    zip 里根目录只放 index.html（Compress-Archive -LiteralPath index.html）
```

> 注意：CloudBase 的 `serviceName` 必须是 `mixmapp`；误用 `mixmapp-cs-1` 会新建一个应用。

## 已确认的边界

- 只改 `location = /` 这一个精确匹配；`/mixmapp/...`（API）、`/mixmapp` 301、其余路径仍按原逻辑走 8787，Mim 站不受影响。
- 自托管产物是**单文件 H5**（无外链资源），所以不需要额外的 JS/CSS location 配置。
- `cloud.mix.top`（少 m）不需要做任何事，也不可能救活：那是别人的停放域名。
