import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, OAuthProviderConfig } from '../config.js';
import { projectRoot } from '../config.js';
import { AppError } from '../lib/errors.js';
import type { OAuthProvider } from '../adapters/oauth.js';
import {
  createGenericOAuthProvider,
  type GenericOAuthSpec,
} from '../adapters/oauth-generic.js';

const here = dirname(fileURLToPath(import.meta.url));

export type ProviderGroup = 'A' | 'B' | 'C';
export type ProviderStatus = 'ready' | 'unconfigured' | 'disabled' | 'unavailable';

export type ProviderDefinition = {
  key: string;
  name: string;
  category: string;
  group: ProviderGroup;
  /** 适配器：内置渠道名 / generic / sms / onekey / pending / none */
  adapter: string;
  kind?: 'sms' | 'onekey';
  platforms: string[];
  priority: string;
  qualification?: string;
  credentials: string[];
  callbackPath: string;
  note?: string;
  unavailableReason?: string;
  generic?: GenericOAuthSpec;
};

export type ProviderState = {
  key: string;
  name: string;
  category: string;
  group: ProviderGroup;
  platforms: string[];
  priority: string;
  qualification: string;
  adapter: string;
  kind?: 'sms' | 'onekey';
  credentials: string[];
  callbackPath: string;
  /** 由配置推导：ready=凭证齐且开关开；unconfigured=缺配置；disabled=被开关停用；unavailable=平台不具备条件 */
  status: ProviderStatus;
  /** 真正可用于登录（status=ready） */
  enabled: boolean;
  /** 运行时开关（与凭证无关，管理端可切） */
  switchedOn: boolean;
  missing: string[];
  reason: string | null;
  note: string | null;
};

type RegistryOptions = {
  config: Config;
  /** 测试注入定义，跳过读文件 */
  definitions?: ProviderDefinition[];
  /** 开关持久化文件；默认 env OAUTH_SWITCH_FILE 或 <repo>/storage/oauth-switches.json */
  switchFile?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
};

const readJsonFile = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** 默认注册表路径：services/api/config/oauth-providers.json（单一真源，随代码发布）。 */
export function defaultProviderFile(): string {
  return process.env['OAUTH_PROVIDERS_FILE']?.trim() || resolve(here, '../../config/oauth-providers.json');
}

function parseDefinitions(raw: unknown): ProviderDefinition[] {
  const list = Array.isArray(raw) ? raw : (raw as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  const out: ProviderDefinition[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const def = item as ProviderDefinition;
    if (!def.key || !def.name || !def.group) continue;
    out.push({
      ...def,
      platforms: Array.isArray(def.platforms) ? def.platforms : [],
      credentials: Array.isArray(def.credentials) ? def.credentials : [],
      callbackPath: typeof def.callbackPath === 'string' ? def.callbackPath : '',
    });
  }
  return out;
}

/**
 * 配置驱动的渠道注册表：
 * - 92 条提供方来自 config/oauth-providers.json（单一真源）
 * - 状态由「凭证是否齐全 + 运行时开关 + 平台是否具备条件」推导，不手写死
 * - 开关落 JSON 文件，修改后下一次请求即生效，不需要重启服务
 */
export class ProviderRegistry {
  private readonly config: Config;
  private readonly env: NodeJS.ProcessEnv;
  private readonly definitions: ProviderDefinition[];
  private readonly byKey = new Map<string, ProviderDefinition>();
  private readonly switchFile: string;
  private switches: Record<string, boolean>;

  constructor(options: RegistryOptions) {
    this.config = options.config;
    this.env = options.env ?? process.env;
    this.definitions =
      options.definitions ??
      parseDefinitions(readJsonFile(defaultProviderFile()));
    for (const def of this.definitions) this.byKey.set(def.key, def);
    this.switchFile =
      options.switchFile ??
      this.env['OAUTH_SWITCH_FILE']?.trim() ??
      resolve(projectRoot(), 'storage', 'oauth-switches.json');
    this.switches = this.readSwitches();
  }

  private readSwitches(): Record<string, boolean> {
    const raw = readJsonFile(this.switchFile);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  }

  private persistSwitches(): void {
    try {
      mkdirSync(dirname(this.switchFile), { recursive: true });
      writeFileSync(this.switchFile, `${JSON.stringify(this.switches, null, 2)}\n`, 'utf8');
    } catch {
      // 落盘失败只影响跨进程共享；当前进程内开关仍然生效。
    }
  }

  definitions_(): ProviderDefinition[] {
    return [...this.definitions];
  }

  get(key: string): ProviderState | null {
    const def = this.byKey.get(key);
    return def ? this.stateOf(def) : null;
  }

  states(): ProviderState[] {
    return this.definitions.map((def) => this.stateOf(def));
  }

  /** 运行时开关：C 类与 pending 适配器强制关闭，避免被误开。 */
  isSwitchedOn(key: string): boolean {
    const def = this.byKey.get(key);
    if (!def) return true;
    if (def.group === 'C' || def.adapter === 'none' || def.adapter === 'pending') return false;
    return this.switches[key] !== false;
  }

  /**
   * 管理端启停：
   * - C 类 / pending 不允许开启（409，给出真实原因，不伪装成可选）
   * - 缺配置时不允许开启（409，列出缺失项）
   * - 写入开关文件后立即生效（热生效，无需重启）
   */
  setEnabled(key: string, enabled: boolean): ProviderState {
    const def = this.byKey.get(key);
    if (!def) throw AppError.notFound(`未知渠道 ${key}`);
    if (enabled) {
      if (def.group === 'C' || def.adapter === 'none' || def.adapter === 'pending') {
        throw AppError.conflict(
          `${def.name} 暂不具备接入条件：${def.unavailableReason ?? '平台未开放第三方登录能力'}`,
        );
      }
      const missing = this.missingOf(def);
      if (missing.length) throw AppError.conflict(`${def.name} 缺少配置：${missing.join('、')}`);
    }
    this.switches[key] = enabled;
    this.persistSwitches();
    return this.stateOf(def);
  }

  /** 启动自检与汇报用：只列出不能直接用的渠道及原因。 */
  summary(): {
    total: number;
    byGroup: Record<ProviderGroup, number>;
    byStatus: Record<ProviderStatus, number>;
    ready: string[];
    unavailable: string[];
  } {
    const states = this.states();
    const byGroup: Record<ProviderGroup, number> = { A: 0, B: 0, C: 0 };
    const byStatus: Record<ProviderStatus, number> = {
      ready: 0,
      unconfigured: 0,
      disabled: 0,
      unavailable: 0,
    };
    for (const state of states) {
      byGroup[state.group] += 1;
      byStatus[state.status] += 1;
    }
    return {
      total: states.length,
      byGroup,
      byStatus,
      ready: states.filter((s) => s.status === 'ready').map((s) => s.key),
      unavailable: states.filter((s) => s.status === 'unavailable').map((s) => s.key),
    };
  }

  /** 通用适配器渠道：只看 A 组且 adapter=generic 且凭证齐全的条目。 */
  genericProviders(fetchImpl?: typeof globalThis.fetch): Record<string, OAuthProvider> {
    const out: Record<string, OAuthProvider> = {};
    for (const def of this.definitions) {
      if (def.group !== 'A' || def.adapter !== 'generic' || !def.generic) continue;
      const [idKey, secretKey] = def.credentials;
      if (!idKey || !secretKey) continue;
      out[def.key] = createGenericOAuthProvider({
        key: def.key,
        clientId: this.env[idKey]?.trim() ?? '',
        clientSecret: this.env[secretKey]?.trim() ?? '',
        spec: def.generic,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
    }
    return out;
  }

  private builtinEnabled(key: string): boolean {
    const providers = this.config.oauth.providers as unknown as Record<string, OAuthProviderConfig | undefined>;
    return Boolean(providers[key]?.enabled);
  }

  /** 缺失配置项：sms/onekey 按各自 provider 口径判，其余按 credentials 逐个查环境变量。 */
  private missingOf(def: ProviderDefinition): string[] {
    const present = (name: string): boolean => Boolean(this.env[name]?.trim());

    if (def.kind === 'sms') {
      if ((this.env['SMS_PROVIDER'] ?? '').trim() === 'aliyun') {
        return def.credentials.filter((name) => !present(name));
      }
      // 开发/测试态允许 console 通道；生产必须实名短信通道。
      return this.config.env === 'production' ? ['SMS_PROVIDER=aliyun', ...def.credentials] : [];
    }
    if (def.kind === 'onekey') {
      const provider = (this.env['ONEKEY_PROVIDER'] ?? '').trim();
      if (provider === 'http') return def.credentials.filter((name) => !present(name));
      return this.config.env === 'production' ? ['ONEKEY_PROVIDER=http'] : [];
    }
    if (def.adapter === 'generic') {
      return def.credentials.filter((name) => !present(name));
    }
    const missing = def.credentials.filter((name) => !present(name));
    if (def.adapter === 'apple') {
      // Apple 允许用 TeamID/KeyID/私钥运行时生成 client_secret，不必单独配 secret。
      const hasGenerated = ['OAUTH_APPLE_TEAM_ID', 'OAUTH_APPLE_KEY_ID', 'OAUTH_APPLE_PRIVATE_KEY'].every(present);
      if (hasGenerated) return missing.filter((name) => name !== 'OAUTH_APPLE_CLIENT_SECRET');
    }
    return missing;
  }

  private stateOf(def: ProviderDefinition): ProviderState {
    const missing = this.missingOf(def);
    const switchedOn = this.isSwitchedOn(def.key);
    let status: ProviderStatus;
    let reason: string | null = null;

    if (def.group === 'C' || def.adapter === 'none') {
      status = 'unavailable';
      reason = def.unavailableReason ?? '平台未开放第三方登录能力';
    } else if (def.adapter === 'pending') {
      status = 'unavailable';
      reason = def.unavailableReason ?? '专用适配器未实现';
    } else if (!switchedOn) {
      status = 'disabled';
      reason = '已在管理端停用';
    } else if (missing.length) {
      status = 'unconfigured';
      reason = `缺少配置：${missing.join('、')}`;
    } else if (def.adapter !== 'generic' && def.kind === undefined && !this.builtinEnabled(def.key)) {
      // 内置渠道的最终启用由 config.ts 决定（如支付宝还要求公钥、Apple 可用私钥生成 secret）。
      status = 'unconfigured';
      reason = '渠道凭证不完整，未启用';
    } else {
      status = 'ready';
    }

    return {
      key: def.key,
      name: def.name,
      category: def.category,
      group: def.group,
      platforms: def.platforms,
      priority: def.priority,
      qualification: def.qualification ?? '',
      adapter: def.adapter,
      ...(def.kind ? { kind: def.kind } : {}),
      credentials: def.credentials,
      callbackPath: def.callbackPath,
      status,
      enabled: status === 'ready',
      switchedOn,
      missing,
      reason,
      note: def.note ?? null,
    };
  }
}

/**
 * 给任意适配器套上运行时开关：
 * 关掉渠道后 adapter.enabled=false，登录页入口消失，start 直接 503；
 * 已绑定该渠道的用户仍可用手机号/其他渠道登录（绑定关系不动）。
 */
export function gatedProvider(
  registry: ProviderRegistry,
  key: string,
  inner: OAuthProvider,
): OAuthProvider {
  const usable = (): boolean => registry.isSwitchedOn(key) && inner.enabled;
  const out: OAuthProvider = {
    name: key,
    get enabled(): boolean {
      return usable();
    },
    exchange: async (code: string, redirectUri?: string) => {
      if (!usable()) throw new AppError('PROVIDER_DISABLED', `${key} 已停用或未配置`);
      return inner.exchange(code, redirectUri);
    },
  };
  if (inner.authorizeUrl) {
    out.authorizeUrl = (redirectUri: string, state: string) =>
      usable() ? inner.authorizeUrl!(redirectUri, state) : null;
  }
  return out;
}

export function loadProviderDefinitions(file?: string): ProviderDefinition[] {
  return parseDefinitions(readJsonFile(file ?? defaultProviderFile()));
}
