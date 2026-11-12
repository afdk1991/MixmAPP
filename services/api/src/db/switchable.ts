import type { Config, DbTarget } from '../config.js';
import { createGatewayPool } from './gateway.js';
import { MemoryStore } from './memory.js';
import { createStore, PgStore } from './postgres.js';
import type { Store } from './types.js';

/**
 * 可热切换的存储：对外始终是同一个 Store 对象（Proxy 每次访问都落到当前实现），
 * 因此 AuthService / MallService 等已经持有它的服务不需要重建。
 *
 * 切换流程：建新连接 → ping 验证 → 原子换指针 → 异步关掉旧连接。
 * 新连接验证不通过就不换指针，旧库继续服务。
 */
export type SwitchResult = { from: DbTarget; to: DbTarget; host: string };

export type StoreSwitcher = {
  /** 交给 buildApp 的稳定代理对象 */
  store: Store;
  /** 当前落点 */
  current: () => { target: DbTarget; url: string; driver: string };
  /** 切到指定落点；连接串缺失或连不通会抛错，且不改变现状 */
  switchTo: (target: DbTarget) => Promise<SwitchResult>;
  close: () => Promise<void>;
};

const urlOf = (config: Config, target: DbTarget): string =>
  target === 'cloudbase' ? config.dbUrls.cloudbase : config.dbUrls.server;

export function createStoreSwitcher(config: Config, makeStore: (url: string) => Store = createStore): StoreSwitcher {
  let currentUrl = config.databaseUrl;
  // 线上默认走 CloudBase PG HTTP 网关（没有可直连的 TCP 连接串）
  const gatewayPool =
    config.pgGateway.url && config.pgGateway.apiKey
      ? createGatewayPool(config.pgGateway.url, config.pgGateway.apiKey, config.pgGateway.schema)
      : null;
  let current: Store = gatewayPool
    ? new PgStore(gatewayPool)
    : currentUrl
      ? makeStore(currentUrl)
      : new MemoryStore();

  // 顶层代理：每次取属性都读 current，方法调用仍然是原对象上的方法
  const proxy = new Proxy({} as Store, {
    get(_target, prop) {
      return (current as unknown as Record<string | symbol, unknown>)[prop];
    },
  });

  return {
    store: proxy,
    current: () => ({
      target: config.dbTarget,
      url: currentUrl,
      driver: current.driver,
    }),
    async switchTo(target: DbTarget): Promise<SwitchResult> {
      const url = urlOf(config, target);
      if (!url) {
        throw new Error(`${target} 未配置连接串（${target === 'cloudbase' ? 'DATABASE_URL_CLOUDBASE' : 'DATABASE_URL_LOCAL / DATABASE_URL_SERVER'}）`);
      }
      if (target === config.dbTarget && url === currentUrl) {
        return { from: config.dbTarget, to: target, host: hostOf(url) };
      }
      const next = makeStore(url);
      if (next.driver === 'postgres') {
        const ok = await next.ping();
        if (!ok) {
          await next.close().catch(() => undefined);
          throw new Error(`目标库连不通：${hostOf(url)}`);
        }
      }
      const previous = current;
      const previousTarget = config.dbTarget;
      current = next;
      currentUrl = url;
      config.dbTarget = target;
      config.databaseUrl = url;
      config.databaseUrlSource = target === 'cloudbase' ? 'DATABASE_URL_CLOUDBASE' : 'DATABASE_URL_SERVER';
      await previous.close().catch(() => undefined);
      return { from: previousTarget, to: target, host: hostOf(url) };
    },
    async close() {
      await current.close().catch(() => undefined);
    },
  };
}

export function hostOf(url: string): string {
  if (!url) return 'none';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
  } catch {
    return 'unparsable';
  }
}
