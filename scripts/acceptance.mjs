#!/usr/bin/env node
/**
 * 最小闭环验收：对着任意一套已部署的 API 跑 5 条核心能力的边界检查。
 * 不碰内存实现——连不上真库就算失败。
 *
 * 用法：node scripts/acceptance.mjs https://cloud.mixm.top/mixmapp [--no-rate-limit]
 * 退出码：0 = 全通过，1 = 有失败项。
 */
const base = process.argv[2] ? process.argv[2].replace(/\/+$/, '') : '';
const skipRateLimit = process.argv.includes('--no-rate-limit');
if (!base) {
  console.error('用法：node scripts/acceptance.mjs <API 根地址> [--no-rate-limit]');
  process.exit(2);
}
const api = `${base}/api/v1`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}

async function req(method, url, { body, token, headers } = {}) {
  const init = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, init);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

async function main() {
  const stamp = Date.now().toString(36);
  const username = `acc_${stamp}`.slice(0, 20);
  const password = 'Acceptance2026x';
  console.log(`\n▶ 目标：${api}\n  本次用户：${username}\n`);

  // 1. 健康检查 + 真库
  const health = await req('GET', `${api}/healthz`);
  const checks = health.json?.checks ?? {};
  const dbOk = health.status === 200 && (checks.db === 'ok' || checks.db === 'postgres') && Boolean(checks.dbTarget);
  record('健康检查与真库连通', dbOk, `status=${health.status} db=${checks.db} dbTarget=${checks.dbTarget ?? '-'} dbHost=${checks.dbHost ?? '-'}`);

  // 2. 能力矩阵
  const meta = await req('GET', `${api}/meta`);
  record('Meta 能力矩阵', meta.status === 200 && meta.json?.data?.appName === 'MixmAPP', `appName=${meta.json?.data?.appName}`);

  // 3. 并发重名：8 个同名注册，只能有一个 201，其余 409
  const burst = await Promise.all(
    Array.from({ length: 8 }, () => req('POST', `${api}/auth/register/username`, { body: { username, password } })),
  );
  const created = burst.filter((r) => r.status === 201).length;
  const conflicts = burst.filter((r) => r.status === 409).length;
  const others = burst.length - created - conflicts;
  record('并发重名只成功一次', created === 1 && conflicts >= 1 && others === 0, `201=${created} 409=${conflicts} 其他=${others}`);

  // 4. 注册即分配 ID
  const first = burst.find((r) => r.status === 201)?.json?.data;
  const accountNo = first?.user?.accountNo ?? '';
  const idOk = first?.user?.id && /^MixmAPP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{1,4}$/.test(accountNo);
  record('注册自动分配 ID/账号号段', Boolean(idOk), `id=${first?.user?.id} accountNo=${accountNo}`);

  // 5. 登录 → /me
  const login = await req('POST', `${api}/auth/login/password`, { body: { account: username, password } });
  const tokens = login.json?.data?.tokens;
  record('密码登录', login.status === 200 && Boolean(tokens?.accessToken), `status=${login.status} isNewUser=${login.json?.data?.isNewUser}`);

  const me = await req('GET', `${api}/me`, { token: tokens?.accessToken });
  record('/me 取身份与注册一致', me.status === 200 && me.json?.data?.accountNo === accountNo, `status=${me.status} accountNo=${me.json?.data?.accountNo}`);

  // 6. 令牌窗口与伪造令牌
  const claims = tokens?.accessToken ? decodeJwt(tokens.accessToken) : null;
  const ttl = claims ? claims.exp - claims.iat : 0;
  record('access token 有效期符合配置', ttl >= 300 && ttl <= 3600, `exp-iat=${ttl}s sub=${claims?.sub}`);
  const forged = await req('GET', `${api}/me`, { token: 'not-a-real-token' });
  record('伪造令牌被拒', forged.status === 401, `status=${forged.status}`);

  // 7. 刷新轮换 + 旧令牌重放
  const refreshed = await req('POST', `${api}/auth/refresh`, { body: { refreshToken: tokens?.refreshToken } });
  const newAccess = refreshed.json?.data?.tokens?.accessToken;
  record('刷新换发新令牌', refreshed.status === 200 && Boolean(newAccess), `status=${refreshed.status}`);
  const replay = await req('POST', `${api}/auth/refresh`, { body: { refreshToken: tokens?.refreshToken } });
  record('旧 refreshToken 重放被拒', replay.status === 401, `status=${replay.status}`);

  // 8. 游客幂等：同一 deviceId 两次必须同一账号
  const deviceId = `acceptance-device-${stamp}xx`;
  const g1 = await req('POST', `${api}/auth/register/guest`, { body: { deviceId, nickname: '验收游客' } });
  const g2 = await req('POST', `${api}/auth/register/guest`, { body: { deviceId, nickname: '验收游客' } });
  const sameGuest = g1.json?.data?.user?.accountNo && g1.json?.data?.user?.accountNo === g2.json?.data?.user?.accountNo;
  record('游客注册幂等（同设备同账号）', Boolean(sameGuest), `g1=${g1.json?.data?.user?.accountNo} g2=${g2.json?.data?.user?.accountNo}`);

  // 9. 商城：商品 → 购物车 → 下单 → 库存真的减少
  const products = await req('GET', `${api}/mall/products`);
  const firstProduct = products.json?.data?.[0];
  record('商品列表可读', products.status === 200 && Array.isArray(products.json?.data), `count=${products.json?.data?.length}`);
  if (firstProduct) {
    const stockBefore = firstProduct.stock;
    const cartAdd = await req('POST', `${api}/mall/cart`, { token: tokens?.accessToken, body: { productId: firstProduct.id, quantity: 1 } });
    const idemKey = `acc-${Date.now().toString(36)}`;
    const orderPayload = {
      receiverName: '验收收货人',
      receiverPhone: '13800000999',
      address: '浙江省宁波市验收路 1 号',
    };
    const order = await req('POST', `${api}/mall/orders`, {
      token: tokens?.accessToken,
      body: orderPayload,
      headers: { 'idempotency-key': idemKey },
    });
    const orderRetry = await req('POST', `${api}/mall/orders`, {
      token: tokens?.accessToken,
      body: orderPayload,
      headers: { 'idempotency-key': idemKey },
    });
    const orderOk = order.status === 201 && Boolean(order.json?.data?.orderNo);
    const sameOrder = orderRetry.json?.data?.orderNo === order.json?.data?.orderNo;
    const after = await req('GET', `${api}/mall/products/${firstProduct.id}`);
    const decremented = after.json?.data?.stock === stockBefore - 1;
    record('购物车加入 + 下单成功', cartAdd.status === 200 && orderOk, `orderNo=${order.json?.data?.orderNo} status=${order.status}`);
    record('同一幂等键重试返回同一单', sameOrder && orderRetry.status === 201, `retry=${orderRetry.json?.data?.orderNo}`);
    record('下单后库存只减 1（重试未重复扣）', decremented, `before=${stockBefore} after=${after.json?.data?.stock}`);
  }

  // 管理面：只在显式提供 ADMIN_TOKEN 时验证（默认 404 属预期）
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) {
    const admin = await req('GET', `${api}/admin/db`, { headers: { 'x-admin-token': adminToken } });
    record(
      '管理面可读数据库落点',
      admin.status === 200 && Boolean(admin.json?.data?.target),
      `status=${admin.status} target=${admin.json?.data?.target} host=${admin.json?.data?.host} source=${admin.json?.data?.source}`,
    );
    const bad = await req('GET', `${api}/admin/db`, { headers: { 'x-admin-token': 'wrong-token' } });
    record('管理面错误令牌被拒', bad.status === 404, `status=${bad.status}`);
  }

  // 10. 限流（放最后，会把自己的配额打满）
  if (!skipRateLimit) {
    let got429 = false;
    for (let i = 0; i < 80; i += 1) {
      const r = await req('GET', `${api}/mall/products`);
      if (r.status === 429) {
        got429 = true;
        console.log(`✓ PASS  限流触发（第 ${i + 1} 次请求）`);
        results.push({ name: '限流触发', ok: true, detail: `第 ${i + 1} 次` });
        break;
      }
    }
    if (!got429) record('限流触发', false, '连续 80 次请求未出现 429');
  } else {
    console.log('… 跳过限流检查（--no-rate-limit）');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n合计：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log(`失败项：${failed.map((f) => f.name).join('、')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('验收脚本自身出错：', error);
  process.exit(1);
});
