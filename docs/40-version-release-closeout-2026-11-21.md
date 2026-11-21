# 预览态转正式版收尾报告（2026-11-21）

- 报告日期：2026-11-21
- 面向对象：项目 Owner
- 处置口径：把「预览版 / preview / 演示态」三类残留全部收敛到正式版，并给出可复核证据
- 边界：只动仓库与发布产物 + 生产 `MALL_DEMO_MODE` 一项开关；未 push、未触发 CI 部署、未改动其它线上配置

---

## 1. 结论

三项收尾全部闭环：

| # | 事项 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | `0.0.2` 正式发布登记与 tag | 完成 | `version.json` `released=["0.0.1","0.0.2"]`；`pnpm version:check` 退出码 0；本地 tag `v0.0.2` |
| 2 | 单文件 H5 与安装包重打 | 完成 | `release/mixmapp-h5-single.html` 673,959 B，内嵌 `0.0.2`；`release/mixmapp-install-0.0.2.tar.gz` 12,322,632 B；产物抽检 exit 0 |
| 3 | 线上演示沙箱关闭 | 完成 | 生产 `MALL_DEMO_MODE=off`；`/api/v1/meta` → `version=0.0.2`、`demoMode=false`；真实下单 `MOMWQCCSM8656768` 已创建并取消，库存 `0 → 0` |

---

## 2. 事项 1：发布登记与版本门禁

### 2.1 改动

- `version.json`：`released` 补入 `0.0.2`，`channel` 保持 `release`，展示号 `0.0.2`。
- `scripts/version.mjs`：`check` 的规则由「`version` 出现在 `released` 即报错」改为「只有停在**更早**的已发布号才报错」。理由：线上跑的就是 `0.0.2`，工作号与最新已发布号相等是正常态，展示号必须与线上一致；重复发布同一号仍由 `release` 命令本身与 tag 存在性拦住。
- `docs/19-versioning.md`：补「`version` 可等于 `released` 末项」的口径，并修正「推 tag 会触发部署」的过时描述（`deploy.yml` 现只监听 `main` 分支，tag 只跑 `ci.yml`）。
- `README.md`：版本块由脚本同步为「已发布版本 `V0.0.1`、`V0.0.2`」。

### 2.2 证据

```
pnpm version:release  → ✓ 已发布 V0.0.2（versionCode 3）；当前展示号 0.0.2
pnpm version:check    → ✓ 版本一致性校验通过：构建 0.0.2（versionCode 3）/ 展示 0.0.2（channel=release）
git tag -l            → v0.0.1 / v0.0.2
```

提交：`b27b345 chore(release): 登记 V0.0.2 正式发布，工作号允许停在最新已发布号`

---

## 3. 事项 2：发布产物重打

### 3.1 问题

旧 `release/mixmapp-h5-single.html`（11-19 构建）内嵌 `appVersion "0.0.0"`，页面只显示「正式发布」而拿不到版本号；API 基址写成 `https://api.mix.top/mixmapp/api/v1`（域名少一个 `m`），实测 SSL 握手失败，可用域名是 `api.mixm.top`（`/meta` 200）。

### 3.2 处置

1. 以正式基址重建：
   `MIXMAPP_API_BASE=https://api.mixm.top/mixmapp/api/v1` + `MIXMAPP_MEDIA_BASE=https://img.mixm.top` → `pnpm build:h5`。
2. 抽检：`node deploy/check-h5-artifacts.mjs apps/app/dist/build/h5` → `✓ 47 个文本文件：无公网 IP / 无内部服务域名 / 无凭据 / 无预览残留 / 基址 api.mixm.top / 媒体 img.mixm.top`。
3. 单文件重压：`node scripts/build-h5-single.mjs`。
4. 安装包重打：`node scripts/package-installer.mjs --skip-build`。

### 3.3 打包脚本修复（原先在 Windows 必挂）

- `cpDir` 原来调 `cp -r`，`cmd` 环境没有 `cp`，必然 exit 1 → Windows 改走 `xcopy /E /I /Y /Q`。
- `tar` 原来固定带 `--force-local`，Windows 自带 bsdtar 不认该选项、直接 exit 1 → 改为只在非 Windows 带。
- 补透传 `MIXMAPP_MEDIA_BASE`，否则单文件 H5 漏媒体源、发布抽检必红。

提交：`a0310c4 fix(pkg): 安装包打包在 Windows 可用`

### 3.4 产物与校验值

| 产物 | 大小 | SHA256 |
|---|---|---|
| `release/mixmapp-h5-single.html` | 673,959 B | `97207737216E558063384DCFF1FA2C3C4788B234CADE42C81A28D82569B3F9C6` |
| `release/mixmapp-install-0.0.2.tar.gz` | 12,322,632 B | `0C1D0247846238A3EE4563F5DA1087BD16150391D0FCC4D51674E23D69196795` |

包内自检：`install/server.mjs` 中 `'APP_VERSION=0.0.2'`；`index.html` 命中 `0.0.2` 2 处、`api.mixm.top` 基址 2 处、`img.mixm.top` 1 处、`单码多端预览版` 0 处、`-preview` 0 处。

旧包 `release/mixmapp-install-0.0.0.tar.gz` 保留未删（含旧预览期产物），已被 0.0.2 包取代，不再作为交付件。

---

## 4. 事项 3：线上演示沙箱关闭

### 4.1 动作

- 备份：`/root/backup-api-env-20261121194324`（权限 600）。
- 配置：`/etc/mixmapp/api.env` 追加 `MALL_DEMO_MODE=off`（原文件无该键，默认 on）。
- 重启：`systemctl restart mixmapp-api` → `active`。

### 4.2 真实下单闭环（生产库）

| 步骤 | 结果 |
|---|---|
| 注册 `e2eprobe20261121` | 201，`accountNo=MixmAPP-038E-4H6N-8000-0` |
| 登录 | 拿到 access token（长度 255） |
| 取商品 `egl-110001030004` | 库存 0，`货源待确认` 行（命中级联策略，不扣库存） |
| 下单 | `orderNo=MOMWQCCSM8656768`，`status=pending`，`totalFen=9`，**无 `DEMO-` 前缀、无 `demo` 字段** |
| 取消 | `status=cancelled` |
| 库存核对 | `0 → 0`（该行本就不扣库存，取消口径一致） |
| 清理 | 测试账号与订单行全部删除（orders 1 → 0，孤儿订单 0，密码登录回 `UNAUTHORIZED`） |

### 4.3 外网复核

```
GET https://cloud.mixm.top/api/v1/meta
→ version=0.0.2  env=production  demoMode=false
GET https://cloud.mixm.top/api/v1/healthz
→ {"status":"ok"}
```

---

## 5. 遗留与未执行

1. **未 push**：`main` 分支推送会触发 `deploy.yml` 生产部署，本轮按边界未推送；tag `v0.0.2` 仅存在于本地，推送后只会跑 `ci.yml` 门禁。需要的话单独执行 `git push origin main v0.0.2`。
2. **线上仍是 11-21 之前的 H5 产物**：`/var/www/mixmapp-site` 未覆盖为本轮重建的单文件（本轮只重建本地交付产物）。若要线上换成同一份单文件，需 `scp` 覆盖 + 可选 `nginx -t && reload`。
3. **库存口径**：源站库存需登录才可见，目录商品一律按 0 快照、走「货源待确认」放行，所以真实链路目前不会扣库存；要验证扣库存，得挑一个 `source_inv_status` 明确有货的商品。
4. **外部集成仍为 dev/off**：`sms=console`、`pay/storage/push/ai/onekey/map` 多为 dev/off，属上线前渠道配置缺口，不在本轮版本口径范围内。
