#!/usr/bin/env node
/**
 * 跨平台的 Android 构包入口：自动挑一个 JDK 21 再调 gradlew。
 *
 * 为什么需要它：Gradle 依赖 JAVA_HOME，而这台 Windows 机器的系统 JAVA_HOME 指向
 * Android Studio 的 JBR（不是 21），写死在 gradle.properties 又会让 Linux/CI 报
 * "Java home supplied is invalid"。所以把「选 JDK」这件事放到脚本里，仓库配置保持中性。
 *
 * 用法：node scripts/android-build.mjs assembleDebug [额外 gradle 参数]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'apps', 'mobile', 'android');

function versionOf(javaHome) {
  const release = join(javaHome, 'release');
  if (!existsSync(release)) return null;
  const text = readFileSync(release, 'utf8');
  const match = /JAVA_VERSION="([^"]+)"/.exec(text) ?? /JAVA_VERSION=([^\r\n]+)/.exec(text);
  return match ? match[1].replace(/"/g, '').trim() : null;
}

function isJdk21(javaHome) {
  if (!javaHome) return false;
  const version = versionOf(javaHome);
  // 有些发行版没有 release 文件，退回看 bin/java 是否存在
  if (!version) return existsSync(join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  return version.startsWith('21');
}

function candidates() {
  const list = [];
  const fromEnv = process.env['JAVA_HOME'];
  if (fromEnv) list.push(fromEnv);

  if (process.platform === 'win32') {
    list.push('C:/Program Files/Microsoft/jdk-21.0.13.21-hotspot');
    for (const base of [
      'C:/Program Files/Java',
      'C:/Program Files/Eclipse Adoptium',
      'C:/Program Files/Microsoft',
      'C:/Program Files/Android/Android Studio/jbr',
    ]) {
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        if (/jdk-?21|jdk-21/i.test(name) || base.endsWith('jbr')) list.push(join(base, name));
      }
    }
  } else {
    for (const base of ['/usr/lib/jvm', '/opt/java', '/opt/hostedtoolcache/Java_Temurin-Hotspot_jdk']) {
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        if (/21/.test(name)) list.push(join(base, name));
      }
    }
  }
  return [...new Set(list)];
}

const picked = candidates().find(isJdk21);
if (!picked) {
  console.error('[android] 找不到 JDK 21，请安装后设置 JAVA_HOME 再重试');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.info(`[android] JAVA_HOME=${picked}`);
console.info(`[android] ${gradlew} ${args.join(' ')}`);

const result = spawnSync(gradlew, args.length ? args : ['assembleDebug'], {
  cwd: androidDir,
  stdio: 'inherit',
  // .bat 必须经 cmd 才能执行；Windows 下用 shell 让 Node 自己选解释器
  shell: process.platform === 'win32',
  env: { ...process.env, JAVA_HOME: picked },
});
if (result.error) {
  console.error(`[android] 启动 gradle 失败：${result.error.message}`);
}
process.exit(result.status ?? 1);
