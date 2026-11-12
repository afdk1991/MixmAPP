import { IdFactory, type IdFactoryOptions } from '@mixmapp/ids';
import type { AuthResult, UserDto, TokenPair } from '@mixmapp/contracts';
import type { Config } from '../config.js';
import type { Store, UserRecord } from '../db/types.js';
import type { OAuthProvider, OAuthProviderName, OAuthProfile } from '../adapters/oauth.js';
import type { SmsProvider, SmsPurpose } from '../adapters/sms.js';
import type { OneKeyProvider } from '../adapters/onekey.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, randomDigits, randomToken, sha256Hex, verifyPassword } from '../lib/crypto.js';
import { signAccessToken } from '../lib/jwt.js';
import { assertUsernameAllowed } from '../lib/username-policy.js';

const SMS_TTL_MS = 5 * 60 * 1000;
const SMS_RESEND_MS = 60 * 1000;
const SMS_DAILY_LIMIT = 10;
const SMS_MAX_ATTEMPTS = 5;

export type AuthDeps = {
  config: Config;
  store: Store;
  sms: SmsProvider;
  oauth: Record<OAuthProviderName, OAuthProvider>;
  onekey: OneKeyProvider;
  ids?: IdFactory;
};

export class AuthService {
  private readonly config: Config;
  private readonly store: Store;
  private readonly sms: SmsProvider;
  private readonly oauth: Record<OAuthProviderName, OAuthProvider>;
  private readonly onekey: OneKeyProvider;
  private readonly ids: IdFactory;
  private readonly smsCounter = new Map<string, { day: string; count: number }>();

  constructor(deps: AuthDeps) {
    this.config = deps.config;
    this.store = deps.store;
    this.sms = deps.sms;
    this.oauth = deps.oauth;
    this.onekey = deps.onekey;
    const opts: IdFactoryOptions = {
      strategy: deps.config.ids.strategy,
      workerId: deps.config.ids.workerId,
    };
    this.ids = deps.ids ?? new IdFactory(opts);
  }

  /** 发送短信验证码；开发态回传 devCode 便于联调。 */
  async requestSmsCode(
    phone: string,
    purpose: SmsPurpose,
  ): Promise<{ ttlSec: number; devCode?: string }> {
    const latest = await this.store.smsCodes.latest(phone, purpose);
    if (latest && Date.now() - latest.createdAt.getTime() < SMS_RESEND_MS) {
      throw new AppError('RATE_LIMITED', '发送过于频繁，请 60 秒后再试');
    }
    const today = new Date().toISOString().slice(0, 10);
    const counter = this.smsCounter.get(phone);
    if (counter && counter.day === today && counter.count >= SMS_DAILY_LIMIT) {
      throw new AppError('RATE_LIMITED', '今日验证码次数已达上限');
    }
    this.smsCounter.set(phone, {
      day: today,
      count: counter && counter.day === today ? counter.count + 1 : 1,
    });

    const code = randomDigits(6);
    await this.store.smsCodes.insert({
      id: this.ids.next().id,
      phone,
      purpose,
      codeHash: sha256Hex(`${phone}:${code}`),
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + SMS_TTL_MS),
      createdAt: new Date(),
    });
    await this.sms.send(phone, code, purpose);
    return this.config.sms.echoCode
      ? { ttlSec: SMS_TTL_MS / 1000, devCode: code }
      : { ttlSec: SMS_TTL_MS / 1000 };
  }

  private async consumeSmsCode(
    phone: string,
    purpose: SmsPurpose,
    code: string,
  ): Promise<void> {
    const record = await this.store.smsCodes.latest(phone, purpose);
    if (!record) throw new AppError('CODE_INVALID', '请先获取验证码');
    if (record.consumedAt) throw new AppError('CODE_INVALID', '验证码已使用，请重新获取');
    if (record.expiresAt.getTime() < Date.now()) throw new AppError('CODE_EXPIRED', '验证码已过期');
    if (record.attempts >= SMS_MAX_ATTEMPTS) {
      throw new AppError('CODE_INVALID', '尝试次数过多，请重新获取验证码');
    }
    const expected = sha256Hex(`${phone}:${code}`);
    if (expected !== record.codeHash) {
      await this.store.smsCodes.update(record.id, { attempts: record.attempts + 1 });
      throw new AppError('CODE_INVALID', '验证码不正确');
    }
    await this.store.smsCodes.update(record.id, { consumedAt: new Date() });
  }

  private async createUser(input: {
    phone?: string | null;
    email?: string | null;
    username?: string | null;
    guest?: boolean;
    passwordHash?: string | null;
    nickname?: string;
    avatarUrl?: string | null;
  }): Promise<UserRecord> {
    const generated = this.ids.next();
    const now = new Date();
    const nickname =
      input.nickname?.trim() ||
      `MixmAPP用户${generated.accountNo.replace(/[^0-9A-Z]/g, '').slice(-4)}`;
    const user: UserRecord = {
      id: generated.id,
      accountNo: generated.accountNo,
      snowflake: generated.snowflake,
      ulid: generated.ulid,
      uuidV7: generated.uuidV7,
      nickname,
      avatarUrl: input.avatarUrl ?? null,
      bio: null,
      username: input.username ?? null,
      guest: input.guest ?? false,
      phone: input.phone ?? null,
      email: input.email ?? null,
      passwordHash: input.passwordHash ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    return this.store.users.insert(user);
  }

  async registerByPhone(input: {
    phone: string;
    code: string;
    nickname?: string;
  }): Promise<AuthResult> {
    const existing = await this.store.users.findByPhone(input.phone);
    if (existing) throw AppError.conflict('该手机号已注册，请直接登录');
    await this.consumeSmsCode(input.phone, 'register', input.code);
    const user = await this.createUser({
      phone: input.phone,
      ...(input.nickname ? { nickname: input.nickname } : {}),
    });
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  async registerByEmail(input: {
    email: string;
    password: string;
    nickname?: string;
  }): Promise<AuthResult> {
    const existing = await this.store.users.findByEmail(input.email);
    if (existing) throw AppError.conflict('该邮箱已注册，请直接登录');
    const user = await this.createUser({
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      ...(input.nickname ? { nickname: input.nickname } : {}),
    });
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  /** 用户名注册：不依赖手机号/邮箱，注册完即可用「用户名 + 密码」登录。 */
  async registerByUsername(input: {
    username: string;
    password: string;
    nickname?: string;
  }): Promise<AuthResult> {
    assertUsernameAllowed(input.username, this.config.usernameDenylist);
    const existing = await this.store.users.findByUsername(input.username);
    if (existing) throw AppError.conflict('该用户名已被占用，请换一个');
    const user = await this.createUser({
      username: input.username,
      passwordHash: await hashPassword(input.password),
      ...(input.nickname ? { nickname: input.nickname } : {}),
    });
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  /** 游客注册：同一设备复用同一账号，避免每次进 App 都新建一个号。 */
  async registerGuest(input: { deviceId: string; nickname?: string }): Promise<AuthResult> {
    const deviceKey = sha256Hex(input.deviceId.trim());
    const binding = await this.store.bindings.findByProvider('guest', deviceKey);
    if (binding) {
      const bound = await this.store.users.findById(binding.userId);
      if (bound) {
        return {
          user: await this.toDto(bound),
          tokens: await this.issueTokens(bound),
          isNewUser: false,
        };
      }
    }
    const user = await this.createUser({
      guest: true,
      ...(input.nickname ? { nickname: input.nickname } : {}),
    });
    await this.store.bindings.insert({
      id: this.ids.next().id,
      userId: user.id,
      provider: 'guest',
      openId: deviceKey,
      unionId: null,
      nickname: null,
      avatarUrl: null,
      createdAt: new Date(),
    });
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  /** 一键登录：手机号已注册则登录，未注册则直接建号（等同免注册）。 */
  async oneKeyLogin(input: { token: string; nickname?: string }): Promise<AuthResult> {
    const phone = await this.onekey.resolvePhone(input.token);
    const existing = await this.store.users.findByPhone(phone);
    if (existing) {
      if (existing.status !== 'active') throw new AppError('FORBIDDEN', '账号已被冻结');
      return {
        user: await this.toDto(existing),
        tokens: await this.issueTokens(existing),
        isNewUser: false,
      };
    }
    const user = await this.createUser({
      phone,
      ...(input.nickname ? { nickname: input.nickname } : {}),
    });
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  async loginByPassword(input: { account: string; password: string }): Promise<AuthResult> {
    const account = input.account.trim();
    const compact = account.replace(/\s/g, '');
    const user = account.includes('@')
      ? await this.store.users.findByEmail(account)
      : ((await this.store.users.findByUsername(compact)) ??
        (await this.store.users.findByAccountNo(compact)));
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError('UNAUTHORIZED', '账号或密码不正确');
    }
    if (user.status !== 'active') throw new AppError('FORBIDDEN', '账号已被冻结');
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: false };
  }

  async loginBySms(input: { phone: string; code: string }): Promise<AuthResult> {
    const existing = await this.store.users.findByPhone(input.phone);
    if (!existing) {
      // 免注册登录：先校验验证码，再自动创建账号
      await this.consumeSmsCode(input.phone, 'login', input.code);
      const user = await this.createUser({ phone: input.phone });
      return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
    }
    await this.consumeSmsCode(input.phone, 'login', input.code);
    if (existing.status !== 'active') throw new AppError('FORBIDDEN', '账号已被冻结');
    return {
      user: await this.toDto(existing),
      tokens: await this.issueTokens(existing),
      isNewUser: false,
    };
  }

  async loginByOAuth(input: {
    provider: OAuthProviderName;
    code: string;
  }): Promise<AuthResult> {
    const adapter = this.oauth[input.provider];
    if (!adapter?.enabled) throw new AppError('PROVIDER_DISABLED', `${input.provider} 登录未配置`);
    const profile = await adapter.exchange(input.code);
    const binding = await this.store.bindings.findByProvider(input.provider, profile.openId);
    if (binding) {
      const user = await this.store.users.findById(binding.userId);
      if (!user) throw AppError.notFound('绑定的账号不存在');
      return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: false };
    }
    const user = await this.createUser({
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
    });
    await this.store.bindings.insert({
      id: this.ids.next().id,
      userId: user.id,
      provider: input.provider,
      openId: profile.openId,
      unionId: profile.unionId,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      createdAt: new Date(),
    });
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  async linkOAuth(userId: string, provider: OAuthProviderName, code: string): Promise<UserDto> {
    const adapter = this.oauth[provider];
    if (!adapter?.enabled) throw new AppError('PROVIDER_DISABLED', `${provider} 登录未配置`);
    const profile: OAuthProfile = await adapter.exchange(code);
    const existing = await this.store.bindings.findByProvider(provider, profile.openId);
    if (existing) {
      if (existing.userId === userId) {
        const user = await this.store.users.findById(userId);
        if (!user) throw AppError.notFound();
        return this.toDto(user);
      }
      throw AppError.conflict('该第三方账号已绑定到其他用户');
    }
    await this.store.bindings.insert({
      id: this.ids.next().id,
      userId,
      provider,
      openId: profile.openId,
      unionId: profile.unionId,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      createdAt: new Date(),
    });
    const user = await this.store.users.update(userId, { guest: false });
    if (!user) throw AppError.notFound();
    return this.toDto(user);
  }

  async bindPhone(userId: string, phone: string, code: string): Promise<UserDto> {
    const owner = await this.store.users.findByPhone(phone);
    if (owner && owner.id !== userId) throw AppError.conflict('该手机号已被其他账号绑定');
    await this.consumeSmsCode(phone, 'bind', code);
    const updated = await this.store.users.update(userId, { phone, guest: false });
    if (!updated) throw AppError.notFound();
    return this.toDto(updated);
  }

  async bindEmail(userId: string, email: string, password: string): Promise<UserDto> {
    const normalized = email.toLowerCase();
    const owner = await this.store.users.findByEmail(normalized);
    if (owner && owner.id !== userId) throw AppError.conflict('该邮箱已被其他账号绑定');
    const updated = await this.store.users.update(userId, {
      email: normalized,
      passwordHash: await hashPassword(password),
      guest: false,
    });
    if (!updated) throw AppError.notFound();
    return this.toDto(updated);
  }

  /** 给游客账号补设用户名与密码，游客因此获得独立登录凭据。 */
  async bindUsername(userId: string, username: string, password: string): Promise<UserDto> {
    assertUsernameAllowed(username, this.config.usernameDenylist);
    const owner = await this.store.users.findByUsername(username);
    if (owner && owner.id !== userId) throw AppError.conflict('该用户名已被占用，请换一个');
    const updated = await this.store.users.update(userId, {
      username,
      passwordHash: await hashPassword(password),
      guest: false,
    });
    if (!updated) throw AppError.notFound();
    return this.toDto(updated);
  }

  async updateProfile(
    userId: string,
    patch: { nickname?: string; avatarUrl?: string; bio?: string },
  ): Promise<UserDto> {
    const updated = await this.store.users.update(userId, patch);
    if (!updated) throw AppError.notFound();
    return this.toDto(updated);
  }

  async getUser(userId: string): Promise<UserDto> {
    const user = await this.store.users.findById(userId);
    if (!user) throw AppError.notFound('用户不存在');
    return this.toDto(user);
  }

  async toDto(user: UserRecord): Promise<UserDto> {
    const bindings = await this.store.bindings.listByUser(user.id);
    return {
      id: user.id,
      accountNo: user.accountNo,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      username: user.username,
      isGuest: user.guest,
      phone: user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(7)}` : null,
      email: user.email,
      bindings: bindings.map((b) => b.provider),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async issueTokens(user: UserRecord): Promise<TokenPair> {
    const access = await signAccessToken(this.config, {
      userId: user.id,
      accountNo: user.accountNo,
    });
    const raw = randomToken();
    const expiresAt = new Date(Date.now() + this.config.jwt.refreshTtlDays * 24 * 3600 * 1000);
    await this.store.refreshTokens.insert({
      tokenHash: sha256Hex(raw),
      userId: user.id,
      expiresAt,
      revokedAt: null,
      replacedBy: null,
      createdAt: new Date(),
    });
    return {
      accessToken: access.token,
      refreshToken: raw,
      expiresIn: access.expiresIn,
      tokenType: 'Bearer',
    };
  }

  async refresh(rawToken: string): Promise<AuthResult> {
    const hash = sha256Hex(rawToken);
    const record = await this.store.refreshTokens.findByHash(hash);
    if (!record) throw AppError.unauthorized('刷新令牌无效');
    if (record.revokedAt) throw AppError.unauthorized('刷新令牌已失效，请重新登录');
    if (record.expiresAt.getTime() < Date.now()) throw AppError.unauthorized('刷新令牌已过期');
    const user = await this.store.users.findById(record.userId);
    if (!user) throw AppError.unauthorized('账号不存在');

    const nextTokens = await this.issueTokens(user);
    await this.store.refreshTokens.revoke(hash, sha256Hex(nextTokens.refreshToken));
    return { user: await this.toDto(user), tokens: nextTokens, isNewUser: false };
  }

  async logout(rawToken: string): Promise<void> {
    const record = await this.store.refreshTokens.findByHash(sha256Hex(rawToken));
    if (record) await this.store.refreshTokens.revoke(record.tokenHash, null);
  }

  /** 供前端“ID 试算器”使用：演示三套策略的产出形态。 */
  previewIds(strategy?: Config['ids']['strategy']) {
    const factory = new IdFactory({
      strategy: strategy ?? this.config.ids.strategy,
      workerId: this.config.ids.workerId,
    });
    return factory.next();
  }
}
