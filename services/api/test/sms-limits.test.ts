import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import { AuthService } from '../src/modules/auth.js';
import type { SmsProvider, SmsPurpose } from '../src/adapters/sms.js';
import type { OneKeyProvider } from '../src/adapters/onekey.js';

class RecordingSms implements SmsProvider {
  readonly name = 'recording';
  readonly sent: Array<{ phone: string; code: string; purpose: SmsPurpose }> = [];

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    this.sent.push({ phone, code, purpose });
  }
}

const onekey: OneKeyProvider = {
  name: 'dev',
  enabled: false,
  resolvePhone: async () => {
    throw new Error('测试中不应调用一键登录');
  },
};

function makeConfig(): Config {
  const base = loadConfig();
  return { ...base, sms: { ...base.sms, echoCode: true } };
}

function makeAuth() {
  const store = new MemoryStore();
  const sms = new RecordingSms();
  const auth = new AuthService({
    config: makeConfig(),
    store,
    sms,
    oauth: {},
    onekey,
  });
  return { store, sms, auth };
}

function wrongCodeOf(code: string): string {
  return code.startsWith('0') ? `1${code.slice(1)}` : `0${code.slice(1)}`;
}

describe('短信验证码风控', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('60 秒内重复发送被拒绝', async () => {
    const { auth } = makeAuth();
    await auth.requestSmsCode('13800000001', 'login');
    await expect(auth.requestSmsCode('13800000001', 'login')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('同一手机号每日最多 10 条', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T02:00:00Z'));
    const { auth } = makeAuth();
    for (let i = 0; i < 10; i += 1) {
      await auth.requestSmsCode('13800000002', 'login');
      vi.advanceTimersByTime(61_000);
    }
    await expect(auth.requestSmsCode('13800000002', 'login')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('错误次数达到 5 次后必须重新获取验证码', async () => {
    const { auth } = makeAuth();
    const { devCode } = await auth.requestSmsCode('13800000003', 'login');
    expect(devCode).toBeTruthy();
    for (let i = 0; i < 5; i += 1) {
      await expect(
        auth.verifySmsCode('13800000003', 'login', wrongCodeOf(devCode as string)),
      ).rejects.toMatchObject({ code: 'CODE_INVALID' });
    }
    // 第 6 次即使输入正确验证码也会被尝试次数上限拦住
    await expect(
      auth.verifySmsCode('13800000003', 'login', devCode as string),
    ).rejects.toThrow(/尝试次数过多/);
  });

  it('过期验证码不可用', async () => {
    const { store, auth } = makeAuth();
    await store.smsCodes.insert({
      id: 'expired-1',
      phone: '13800000004',
      purpose: 'login',
      codeHash: 'deadbeef',
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 10 * 60_000),
    });
    await expect(auth.verifySmsCode('13800000004', 'login', '123456')).rejects.toMatchObject({
      code: 'CODE_EXPIRED',
    });
  });

  it('验证码只能消费一次', async () => {
    const { auth } = makeAuth();
    const { devCode } = await auth.requestSmsCode('13800000005', 'bind');
    await auth.verifySmsCode('13800000005', 'bind', devCode as string);
    await expect(auth.verifySmsCode('13800000005', 'bind', devCode as string)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
  });
});
