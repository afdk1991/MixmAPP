import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import type { OAuthProvider, OAuthProfile, OAuthProviderName } from '../src/adapters/oauth.js';

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['DEV_ECHO_SMS_CODE'] = '1';
process.env['RATE_LIMIT_PER_MINUTE'] = '1000';
process.env['DATABASE_URL'] = '';

export const testConfig = loadConfig();

export class FakeOAuth implements OAuthProvider {
  readonly enabled = true;

  constructor(
    readonly name: OAuthProviderName,
    private readonly profile: OAuthProfile,
  ) {}

  async exchange(): Promise<OAuthProfile> {
    return this.profile;
  }
}

export async function makeApp(options: { oauth?: Partial<Record<OAuthProviderName, OAuthProvider>> } = {}) {
  const store = new MemoryStore();
  const oauth = {
    wechat: options.oauth?.wechat ?? new FakeOAuth('wechat', { openId: 'wx-open-1', unionId: 'un-1', nickname: '微信测试', avatarUrl: null }),
    qq: options.oauth?.qq ?? new FakeOAuth('qq', { openId: 'qq-open-1', unionId: null, nickname: 'QQ测试', avatarUrl: null }),
    github: options.oauth?.github ?? new FakeOAuth('github', { openId: 'gh-1', unionId: 'octocat', nickname: 'Octocat', avatarUrl: 'https://avatars.example.com/u/1' }),
    apple: options.oauth?.apple ?? new FakeOAuth('apple', { openId: 'apple-open-1', unionId: null, nickname: 'Apple 测试', avatarUrl: null }),
  };
  const app = await buildApp({ config: testConfig, store, oauth, logger: false });
  return { app, store };
}