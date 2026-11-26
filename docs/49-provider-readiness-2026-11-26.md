# 外部服务生产就绪（支付 / 短信 / 地图 / 推送）

日期：2026-11-26
范围：`services/api` 的支付、短信、地图、推送四条外部依赖，及其配置、自检、联调脚本与测试。
不做：鉴权、限流、页面视觉（属另一条开发线）。

## 1. 这次解决了什么

改造前四条链路都「有代码」，但缺凭据时会静默落到 console / dev 实现：

- 短信：生产用 console，验证码只打日志，接口却返回成功；
- 地图：生产用 dev，逆地理/路径规划返回假坐标、假距离；
- 推送：生产用 dev，`accepted` 是假的，token 失效也没人清理；
- 支付：未配置商户参数时仍会落一条待支付单并返回 mock 调起参数。

改造后统一口径：**缺凭据 = 明确不可用（503 PROVIDER_DISABLED），不是假成功**。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `services/api/src/lib/provider-check.ts`（新增） | 四类服务统一自检：通道选择、缺失环境变量、Key 格式、支付凭据完整性；产出 error/warn 与 ready/disabled/unconfigured；读取 `PROVIDER_SELF_CHECK` 决定是否 strict |
| `services/api/src/index.ts` | 启动时执行自检：逐条打印 error/warn；strict 模式下有阻断项直接拒绝启动 |
| `services/api/src/adapters/sms.ts` | 新增 `DisabledSms`（生产禁 console）；阿里云发送前校验 AK/SK/签名/模板，模板参数只传 `${code}`，5s 超时，失败回传阿里云 Code |
| `services/api/src/adapters/map.ts` | 生产禁 dev；Key 格式前置校验；4s 超时；Key 失效与上游不可达分别返回 PROVIDER_DISABLED / PROVIDER_ERROR；上游缺路线返回 `degraded` 而非伪造距离 |
| `services/api/src/adapters/push.ts` | 生产禁 dev；极光错误码 1011 整批 token 判失效，其余错误抛出；FCM 逐设备发送、按 UNREGISTERED/INVALID_ARGUMENT/SENDER_ID_MISMATCH/NOT_FOUND 收集失效 token，单设备失败不影响整批 |
| `services/api/src/adapters/pay/wechat.ts` | 回调解析增加 appid/mchid/币种/事件类型字段，供业务层校验 |
| `services/api/src/adapters/pay/alipay.ts` | 回调解析增加 app_id 字段；新增 `isAlipayNotifyReady` |
| `services/api/src/modules/pay.ts` | 生产无凭据直接 503 且不落单；先调上游成功再落库（避免孤儿单）；校验订单号字符集；回调校验 appid/mchid/app_id、金额、币种、渠道一致性；已支付订单重复回调幂等，换交易号重复支付返回 409；支付宝 WAIT_BUYER_PAY 保持 pending、TRADE_CLOSED 落 failed、未知状态不确认以便重试 |
| `services/api/src/modules/push.ts`（新增） | token 注册去重、单账号上限 20 条并淘汰最旧、主动注销、发送后清理失效 token、发送失败如实统计 |
| `services/api/src/routes/me.ts` | 接入 PushService；新增 `DELETE /me/push-token` 注销；`/me/push-test` 返回真实发送统计 |
| `services/api/src/routes/meta.ts` | 管理端健康检查新增 `providers` 逐项自检结果（匿名探针看不到） |
| `scripts/provider-readiness.mjs`（新增） | 部署前自检脚本：打印四个模块的通道、缺失变量、拿到凭据后的跑通步骤；`--strict` 有阻断项退出 1 |
| `.env.example` | 补 `PROVIDER_SELF_CHECK` 与生产禁用 dev/console 的说明 |
| `services/api/test/*`（新增 6 个文件） | 自检、下单、回调加固、短信风控、推送、适配器门禁的定向单测 |

## 3. 自检与门禁行为

- 默认 `PROVIDER_SELF_CHECK=warn`：启动打印 error 级日志，相关能力在运行时抛 `PROVIDER_DISABLED`。
  之所以不默认退出进程：生产当前就是 console/dev，硬失败会让整站停机，属于用一个配置问题换一次全站故障。
- 设置 `PROVIDER_SELF_CHECK=strict`：任一 error 级阻断项直接拒绝启动，建议在凭据齐备后作为发版门禁。
- 生产环境固定禁用：console 短信、dev 地图、dev 推送。代码层面替换为 Disabled 适配器，不存在开关绕过。
- 支付未配置只产生 warn（未开通），部分配置产生 error（配置了一半最危险）。

## 4. 各模块还缺什么、拿到后怎么跑通

统一先跑：

```bash
node scripts/provider-readiness.mjs          # 看缺口
node scripts/provider-readiness.mjs --strict # 发版门禁，阻断项 > 0 时退出 1
```

### 4.1 短信（阿里云）

缺：`SMS_PROVIDER=aliyun`、`ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE`。

跑通：

1. 阿里云短信控制台申请签名（与站点名一致）与验证码模板，模板变量只保留 `${code}`；
2. RAM 子账号授予 `dysms:SendSms`，把 AK/SK 写入 `/etc/mixmapp/api.env`；
3. 重启 API，`curl -X POST https://<域名>/api/v1/auth/sms/code -H 'content-type: application/json' -d '{"phone":"138xxxx","purpose":"login"}'`，手机应收到短信，且响应中没有 `devCode`；
4. 60 秒内重复请求应返回 RATE_LIMITED；连续输错 5 次后必须重新获取。

### 4.2 支付（微信 / 支付宝）

缺：

- 微信：`PAY_WECHAT_APP_ID`、`MCH_ID`、`SERIAL_NO`、`PRIVATE_KEY`、`API_V3_KEY`（32 字节）、`PLATFORM_PUBLIC_KEY`、`NOTIFY_URL`；
- 支付宝：`PAY_ALIPAY_APP_ID`、`PRIVATE_KEY`、`PUBLIC_KEY`、`NOTIFY_URL`。

跑通：

1. 微信商户平台开通 APP 支付，下载 API 证书（商户私钥 + 证书序列号），设置 32 字节 APIv3 密钥，配置平台证书公钥；
2. 支付宝开放平台创建应用并签约 APP 支付，配置应用私钥与支付宝公钥；
3. 回调必须是公网 HTTPS：`/api/v1/pay/notify/wechat`、`/api/v1/pay/notify/alipay`；
4. `POST /api/v1/pay/orders` 应返回 `mode=live`；用最小金额真实支付一笔，确认回调后订单 `paid`；重放同一回调不重复入账，改用另一交易号回调返回 409；
5. 生产未配置时该接口返回 503 `PROVIDER_DISABLED`，且数据库不产生支付单。

### 4.3 地图（高德）

缺：`MAP_PROVIDER=amap`、`AMAP_KEY`（Web 服务 Key，32 位十六进制）。

跑通：

1. 高德开放平台创建「Web 服务」Key；
2. 配置后重启，`POST /api/v1/map/regeo` 返回真实地址；返回 `degraded: true` 说明上游未给可用结果，前端应允许手动填写地址；
3. Key 失效返回 503 并在消息中带高德 info（如 `INVALID_USER_KEY`），不是 502。

### 4.4 推送（极光 / FCM）

缺：`PUSH_PROVIDER=jpush|fcm` 及 `JPUSH_APP_KEY`+`JPUSH_MASTER_SECRET`，或 `FCM_SERVICE_ACCOUNT_JSON`+`FCM_PROJECT_ID`。

跑通：

1. 极光控制台建应用取 AppKey / Master Secret；FCM 下载服务账号 JSON（单行写入 env）；
2. 登录后 `POST /api/v1/me/push-token`（provider 必须与启用的通道一致，生产不一致会 400）；
3. `POST /api/v1/me/push-test` 返回 `{total, accepted, failed, removed}`；FCM 判定的失效 token 会自动删除，`removed` 即清理条数；
4. 退出登录时调用 `DELETE /me/push-token` 主动注销。

## 5. 验证记录

已验（本地）：

- 新增 6 个测试文件全部通过：自检规则、下单无凭据不落单、上游失败不落孤儿单、微信/支付宝回调的验签/金额/币种/渠道/幂等/冲突、短信 60s 与每日 10 条与 5 次错误上限、token 去重与上限与失效清理、生产禁用 dev/console 适配器。
- `node scripts/provider-readiness.mjs` 正常运行；生产模拟下 `--strict` 正确退出 1。
- 本次新增/修改的服务端文件通过隔离 `tsc`（工作区 `app.ts`/`lib/validate.ts` 被并行开发线改成引用尚未落地的 suite 模块，全仓 tsc 在当前工作区必然失败，属其他线在改，未触碰）。

未验（缺凭据/环境）：

- 真实短信下发、微信/支付宝真实支付与回调、高德真实逆地理/路径规划、极光/FCM 真机推送；
- 生产环境 `PROVIDER_SELF_CHECK=strict` 下的启动门禁（需先补齐凭据）；
- 多实例部署下短信每日限额：计数仍在单进程内存，多副本会各自计数（与改造前一致）。

## 6. 上线清单（按序）

1. 在 `/etc/mixmapp/api.env` 补齐至少短信凭据（否则生产短信接口 503），按需补地图/推送；
2. 运行 `node scripts/provider-readiness.mjs` 确认缺口清单符合预期；
3. 发版（既有流程推送 main 触发部署，原子发布 + current 软链）；
4. 发版后访问管理端健康检查，确认 `providers.status` 与预期一致；
5. 逐项冒烟：短信、地图（若启用）、推送（若启用）；支付需在拿到商户凭据后单独安排真实小额验证；
6. 全部通过后，可把 `PROVIDER_SELF_CHECK` 改为 `strict` 再发一次，作为后续发版门禁。

## 7. 回退方式

- 代码回退：`git revert <本次提交>` 后按既有流程重新发版；无数据库变更，无迁移需要回滚。
- 行为回退：把 `PROVIDER_SELF_CHECK` 保持 `warn`（默认）即可恢复「只报错不阻断启动」；
  但 dev/console 在生产被禁用是代码级门禁，回退到旧版才会恢复假通道。
- 若上线后短信/推送/地图误报 503：先看管理端健康检查的 `providers.issues`，补对应环境变量并重启，不需要回滚代码。

## 8. 已知边界

- 极光 v3 成功响应不提供逐设备回执，只能整批计 accepted；单设备失效依赖错误码 1011 整批判定，`removed` 可能在下次发送时才体现。
- 微信回调未做时间戳新鲜度校验：渠道重试可能携带较早时间戳，拒绝会导致丢单；签名本身已覆盖 timestamp/nonce/body。
- 支付宝 `TOTAL_AMOUNT` 以元为单位，入库换算为分并做四舍五入，与微信分单位对齐。
- 支付单状态流转只覆盖 `pending/paid/failed`，退款链路不在本次范围。
