#!/usr/bin/env node
// 最小 DNSPod API 客户端（TC3-HMAC-SHA256），仅用 Node 内置模块。
// 用法:
//   node dnspod.mjs list   <zone> [outJson]
//   node dnspod.mjs create <jsonFile>      // JSON: {Domain,SubDomain,RecordType,RecordLine,Value,TTL}
//   node dnspod.mjs delete <zone> <recordId...>   // 逐条复读后单条删除
// 凭证从 .secrets/tencentcloud.env 读取，绝不打印。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV = path.join(ROOT, '.secrets', 'tencentcloud.env');

function loadEnv() {
  const txt = fs.readFileSync(ENV, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!out.TENCENTCLOUD_SECRET_ID || !out.TENCENTCLOUD_SECRET_KEY) {
    throw new Error('tencentcloud.env 缺少 SECRET_ID / SECRET_KEY');
  }
  return out;
}

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg, 'utf8').digest();

async function call(action, payload) {
  const { TENCENTCLOUD_SECRET_ID: sid, TENCENTCLOUD_SECRET_KEY: skey } = loadEnv();
  const host = 'dnspod.tencentcloudapi.com';
  const service = 'dnspod';
  const version = '2021-03-23';
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(body)].join('\n');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(ts), scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`TC3${skey}`, date);
  const kService = hmac(kDate, service);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${sid}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(ts),
      'X-TC-Region': '',
    },
    body,
  });
  const json = await res.json();
  if (json.Response?.Error) {
    const e = json.Response.Error;
    throw new Error(`${action} 失败: ${e.Code} ${e.Message} (RequestId=${json.Response.RequestId})`);
  }
  return json.Response;
}

// DNSPod 在记录刚被改动后的一小段时间内会返回 ResourceNotFound.NoDataOfRecord（列表瞬时为空），
// 属可重试的瞬时错误；其余错误（鉴权、限额）不重试，直接抛出。
async function listWithRetry(zone, offset, limit) {
  const payload = { Domain: zone, Limit: limit, Offset: offset };
  let lastErr;
  for (let i = 0; i < 30; i += 1) {
    try {
      return await call('DescribeRecordList', payload);
    } catch (e) {
      lastErr = e;
      if (!/NoDataOfRecord/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw lastErr;
}

async function listAll(zone) {
  const all = [];
  let offset = 0;
  const limit = 3000;
  for (;;) {
    const r = await listWithRetry(zone, offset, limit);
    const rows = r.RecordList || [];
    all.push(...rows);
    const total = r.RecordCountInfo?.TotalCount ?? all.length;
    offset += rows.length;
    if (rows.length === 0 || offset >= total) return { total, records: all };
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list') {
  const zone = args[0] || 'mixm.top';
  const outFile = args[1];
  const { total, records } = await listAll(zone);
  const slim = records.map((r) => ({
    RecordId: r.RecordId,
    Name: r.Name,
    Type: r.Type,
    Value: r.Value,
    Line: r.Line,
    TTL: r.TTL,
    Status: r.Status,
    MX: r.MX ?? null,
    UpdatedOn: r.UpdatedOn,
  }));
  slim.sort((a, b) => String(a.Name).localeCompare(String(b.Name)) || a.RecordId - b.RecordId);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ zone, pulledAt: new Date().toISOString(), total, records: slim }, null, 2));
  console.log(JSON.stringify({ zone, total, count: slim.length }, null, 2));
  if (!outFile) console.log(JSON.stringify(slim, null, 2));
} else if (cmd === 'create') {
  const p = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const list = Array.isArray(p) ? p : p.records ? p.records : [p];
  const done = [];
  for (const item of list) {
    console.log('将提交:', JSON.stringify(item));
    const r = await call('CreateRecord', item);
    done.push({ item, RecordId: r.RecordId, RequestId: r.RequestId });
    console.log('结果:', JSON.stringify({ RecordId: r.RecordId, RequestId: r.RequestId }));
  }
  console.log('汇总:', JSON.stringify(done, null, 2));
} else if (cmd === 'delete') {
  // 删除纪律：每删一条前重新拉一遍全量、按 RecordId 复读当前值并打印，
  // 再调 DeleteRecord 单条删除；失败原样保留并写明错误码，绝不批量盲删。
  const zone = args[0];
  const ids = args.slice(1).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
  if (!zone || ids.length === 0) {
    console.error('用法: node dnspod.mjs delete <zone> <recordId...>');
    process.exit(2);
  }
  const before = await listAll(zone);
  console.log(`删除前 ${zone} 记录总数 = ${before.total}`);
  const results = [];
  for (const id of ids) {
    // 逐条精确复读。用 DescribeRecord 而不是 DescribeRecordList：
    // 列表接口在刚发生改动后会有数秒到数十秒的「记录列表为空」空窗，单条读取不受影响。
    let rec;
    try {
      const r = await call('DescribeRecord', { Domain: zone, RecordId: id });
      const x = r.RecordInfo;
      rec = {
        RecordId: x.Id,
        Name: x.SubDomain,
        Type: x.RecordType,
        Line: x.RecordLine,
        Value: x.Value,
        TTL: x.TTL,
        Status: x.Enabled === 1 ? 'ENABLE' : 'DISABLE',
      };
    } catch (e) {
      console.log(`复读失败 ${id}: ${e.message}`);
      results.push({ RecordId: id, ok: false, reason: 'describe-failed', error: e.message });
      continue;
    }
    console.log(
      '复读:',
      JSON.stringify({
        RecordId: rec.RecordId,
        Name: rec.Name,
        Type: rec.Type,
        Line: rec.Line,
        Value: rec.Value,
        TTL: rec.TTL,
        Status: rec.Status,
      }),
    );
    try {
      const r = await call('DeleteRecord', { Domain: zone, RecordId: id });
      console.log('删除成功:', JSON.stringify({ RecordId: id, RequestId: r.RequestId }));
      results.push({
        RecordId: id,
        ok: true,
        Name: rec.Name,
        Type: rec.Type,
        Value: rec.Value,
        TTL: rec.TTL,
        Status: rec.Status,
        RequestId: r.RequestId,
      });
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.log('删除失败:', id, e.message);
      results.push({
        RecordId: id,
        ok: false,
        Name: rec.Name,
        Type: rec.Type,
        Value: rec.Value,
        TTL: rec.TTL,
        Status: rec.Status,
        error: e.message,
      });
    }
  }
  const after = await listAll(zone);
  console.log(`删除后 ${zone} 记录总数 = ${after.total}（净减少 ${before.total - after.total}）`);
  console.log('汇总:', JSON.stringify(results, null, 2));
} else {
  console.error('用法: node dnspod.mjs list <zone> [outJson] | create <jsonFile> | delete <zone> <recordId...>');
  process.exit(2);
}
