import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import { PushService } from '../src/modules/push.js';
import type { PushInput, PushProvider, PushResult } from '../src/adapters/push.js';

class StubPush implements PushProvider {
  constructor(
    readonly name: string,
    private readonly handler: (input: PushInput) => Promise<PushResult>,
  ) {}

  push(input: PushInput): Promise<PushResult> {
    return this.handler(input);
  }
}

function makeConfig(patch: Partial<Config> = {}): Config {
  const base = loadConfig();
  return {
    ...base,
    push: { provider: 'dev', jpush: { appKey: '', masterSecret: '' }, fcm: { serviceAccountJson: '', projectId: '' } },
    ...patch,
  };
}

describe('推送 token 与发送', () => {
  it('同一 token 重复注册只保留一行', async () => {
    const store = new MemoryStore();
    const push = new PushService(
      makeConfig(),
      store,
      new StubPush('dev', async (input) => ({ accepted: input.tokens.length, failed: 0, invalidTokens: [] })),
    );
    await push.register('u1', { token: 'token-aaaaaaaaaa', platform: 'android', provider: 'jpush' });
    await push.register('u1', { token: 'token-aaaaaaaaaa', platform: 'ios', provider: 'jpush' });
    const rows = await store.pushTokens.listByUser('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform).toBe('ios');
  });

  it('单账号 token 超过上限时淘汰最旧的', async () => {
    const store = new MemoryStore();
    const push = new PushService(
      makeConfig(),
      store,
      new StubPush('dev', async (input) => ({ accepted: input.tokens.length, failed: 0, invalidTokens: [] })),
    );
    for (let i = 0; i < 21; i += 1) {
      await push.register('u1', {
        token: `token-${String(i).padStart(12, '0')}`,
        platform: 'android',
        provider: 'jpush',
      });
      // 让 createdAt 有可比较的先后顺序
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const rows = await store.pushTokens.listByUser('u1');
    expect(rows).toHaveLength(20);
    expect(rows.some((row) => row.token === 'token-000000000000')).toBe(false);
  });

  it('发送后清理上游判定失效的 token，并保留其它 token', async () => {
    const store = new MemoryStore();
    const push = new PushService(
      makeConfig(),
      store,
      new StubPush('fcm', async (input) => ({
        accepted: input.tokens.length - 1,
        failed: 0,
        invalidTokens: [input.tokens[0] as string],
      })),
    );
    await push.register('u1', { token: 'token-invalid-1', platform: 'android', provider: 'fcm' });
    await push.register('u1', { token: 'token-valid-01', platform: 'ios', provider: 'fcm' });
    const summary = await push.sendToUser('u1', { title: 't', body: 'b' });
    expect(summary).toMatchObject({ total: 2, accepted: 1, removed: 1 });
    const rows = await store.pushTokens.listByUser('u1');
    expect(rows.map((row) => row.token)).toEqual(['token-valid-01']);
  });

  it('上游抛错时不吞异常，且不清空 token', async () => {
    const store = new MemoryStore();
    const push = new PushService(
      makeConfig(),
      store,
      new StubPush('jpush', async () => {
        throw new Error('upstream down');
      }),
    );
    await push.register('u1', { token: 'token-keep-001', platform: 'android', provider: 'jpush' });
    await expect(push.sendToUser('u1', { title: 't', body: 'b' })).rejects.toThrow('upstream down');
    expect(await store.pushTokens.listByUser('u1')).toHaveLength(1);
  });

  it('生产环境 token 通道与启用通道不一致时拒绝注册', async () => {
    const store = new MemoryStore();
    const config = makeConfig({
      env: 'production',
      push: {
        provider: 'jpush',
        jpush: { appKey: 'k', masterSecret: 's' },
        fcm: { serviceAccountJson: '', projectId: '' },
      },
    });
    const push = new PushService(
      config,
      store,
      new StubPush('jpush', async (input) => ({ accepted: input.tokens.length, failed: 0, invalidTokens: [] })),
    );
    await expect(
      push.register('u1', { token: 'token-mismatch-1', platform: 'android', provider: 'fcm' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('注销 token 幂等', async () => {
    const store = new MemoryStore();
    const push = new PushService(
      makeConfig(),
      store,
      new StubPush('dev', async () => ({ accepted: 0, failed: 0, invalidTokens: [] })),
    );
    await push.register('u1', { token: 'token-remove-01', platform: 'android', provider: 'jpush' });
    expect(await push.unregister('u1', 'token-remove-01')).toMatchObject({ removed: 1 });
    expect(await push.unregister('u1', 'token-remove-01')).toMatchObject({ removed: 0 });
  });
});
