#!/usr/bin/env node
/**
 * Android 真机冒烟：装 → 启动 → 抓 logcat → 壳内探 /healthz → 截图。
 *
 * 用法：
 *   node scripts/android-smoke.mjs                       # 用第一台设备 + debug APK
 *   node scripts/android-smoke.mjs --serial 10AE3Y0LGQ0018Z
 *   node scripts/android-smoke.mjs --require-api         # API 不可达也判失败（CI 用）
 *
 * 判定：
 *   - 装不上 / 启不来 / logcat 有本应用 FATAL  → exit 1
 *   - 壳内没注入 API 源                       → exit 1
 *   - 抓不到 WebView（调试通道未开）           → 只告警
 *   - /healthz 不可达                          → 默认只告警（生产会短时抖动），加 --require-api 才判死
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'top.mixm.app';
const ACTIVITY = `${APP_ID}/.MainActivity`;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const APK = resolve(value('--apk', join(root, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')));
const OUT = resolve(value('--out', join(root, 'apps', 'mobile', 'android', 'app', 'build', 'smoke')));
const REQUIRE_API = flag('--require-api');

function findAdb() {
  const candidates = [
    process.env['ANDROID_HOME'] && join(process.env['ANDROID_HOME'], 'platform-tools', 'adb.exe'),
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    process.env['HOME'] && join(process.env['HOME'], 'Android', 'Sdk', 'platform-tools', 'adb'),
    process.env['HOME'] && join(process.env['HOME'], 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return 'adb';
}

const ADB = findAdb();
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.info(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`);
};

function adb(args, { allowFail = false } = {}) {
  try {
    return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const devices = adb(['devices']).split('\n').slice(1).filter((l) => l.includes('device') && !l.includes('offline'));
  const serial = value('--serial', devices[0]?.split('\t')[0] ?? '');
  const adbFor = (args, opts) => adb(serial ? ['-s', serial, ...args] : args, opts);

  record('设备在线', Boolean(serial), serial || '没有可用设备');
  if (!serial) return finish();

  record('APK 存在', existsSync(APK), APK.replace(root + '\\', ''));
  if (!existsSync(APK)) return finish();

  const install = adbFor(['install', '-r', APK], { allowFail: true });
  record('安装', /Success/i.test(install), install.split('\n').pop());

  adbFor(['logcat', '-c'], { allowFail: true });
  adbFor(['shell', 'am', 'force-stop', APP_ID], { allowFail: true });
  const start = adbFor(['shell', 'am', 'start', '-W', '-n', ACTIVITY], { allowFail: true });
  record('启动', /Status: ok|Complete/.test(start), start.match(/TotalTime: \d+/)?.[0] ?? '');

  await sleep(6000);

  const pid = adbFor(['shell', 'pidof', APP_ID], { allowFail: true });
  record('进程存活', Boolean(pid), pid);

  const fatal = adbFor(['logcat', '-d'], { allowFail: true })
    .split('\n')
    .filter((l) => /FATAL EXCEPTION|AndroidRuntime/.test(l) && l.includes(APP_ID));
  record('logcat 无本应用崩溃', fatal.length === 0, fatal[0]?.slice(0, 120) ?? '');

  let shellInfo = null;
  if (pid) {
    adbFor(['forward', '--remove-all'], { allowFail: true });
    const port = 9334;
    adbFor(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`], { allowFail: true });
    await sleep(1500);
    shellInfo = await inspectShell(port);
    record('壳内 WebView 可调试', Boolean(shellInfo), shellInfo ? shellInfo.href : '拿不到调试目标');
    if (shellInfo) {
      record('API 源已注入', shellInfo.injectedBase.startsWith('http'), shellInfo.injectedBase);
      record('壳内探活 /healthz', !shellInfo.probeError, shellInfo.probe || shellInfo.probeError);
      mkdirSync(OUT, { recursive: true });
      if (shellInfo.screenshot) {
        const shotPath = join(OUT, 'smoke.png');
        writeFileSync(shotPath, Buffer.from(shellInfo.screenshot, 'base64'));
        record('截图', true, shotPath.replace(root + '\\', ''));
      }
    }
  }

  return finish();
}

async function inspectShell(port) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = list.find((t) => t.type === 'page');
    if (!target) return null;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Page.enable');
    const r = await send('Runtime.evaluate', {
      expression: `(async () => {
        const base = globalThis.__MIXMAPP_API_BASE__ ?? '(未注入)';
        const out = { href: location.href, injectedBase: base, probe: '', probeError: '', status: '' };
        out.status = (document.querySelector('.stat-status') || {}).innerText || '';
        if (base !== '(未注入)') {
          try {
            const root = base.endsWith('/api/v1') ? base.slice(0, -'/api/v1'.length) : base;
            const res = await fetch(root + '/api/v1/healthz', { headers: { accept: 'application/json' } });
            out.probe = res.status + ' ' + (res.headers.get('content-type') || '');
            if (res.status !== 200) out.probeError = 'healthz 非 200';
          } catch (e) { out.probeError = 'fetch 失败: ' + e.message; }
        } else {
          out.probeError = '未注入 API 源';
        }
        return out;
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    ws.close();
    const info = r.result?.result?.value;
    if (!info) {
      console.info(`[smoke] 壳内求值失败：${JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r).slice(0, 200)}`);
      return { href: '(unknown)', injectedBase: '(unknown)', probe: '', probeError: '求值失败', screenshot: shot.result?.data };
    }
    return { ...info, screenshot: shot.result?.data };
  } catch {
    return null;
  }
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  const hardFail = failed.filter((r) => r.name !== '壳内探活 /healthz' || REQUIRE_API);
  console.info('');
  console.info(`冒烟结果：${results.length - failed.length}/${results.length} 通过`);
  if (hardFail.length) {
    console.error(`失败项：${hardFail.map((r) => r.name).join('、')}`);
    process.exit(1);
  }
  if (failed.length) {
    console.info(`告警项（未判失败）：${failed.map((r) => r.name).join('、')}`);
  }
  process.exit(0);
}

await main();
