import { IdFactory, type IdFactoryOptions } from '@mixmapp/ids';
import type { AuthResult, UserDto, TokenPair } from '@mixmapp/contracts';
import type { Config } from '../config.js';
import type { Store, UserRecord } from '../db/types.js';
import type { OAuthProvider, OAuthProviderName, OAuthProfile } from '../adapters/oauth.js';
import { oauthCallbackUrl } from '../adapters/oauth.js';
import type { SmsProvider, SmsPurpose } from '../adapters/sms.js';
import type { OneKeyProvider } from '../adapters/onekey.js';
import { AppError } from '../lib/errors.js';
import { AccountMergeService } from './account-merge.js';
import type { MergeMoved } from '../db/types.js';
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

/** bindPhone 的返回：合并发生时调用方必须换用主账号的新 token。 */
export type BindPhoneResult = {
  user: UserDto;
  tokens: TokenPair;
  merged: {
    mergeId: string;
    replayed: boolean;
    moved: MergeMoved | null;
    conflictStrategy: Record<string, string>;
  } | null;
};

export class AuthService {
  private readonly config: Config;
  private readonly store: Store;
  private readonly sms: SmsProvider;
  private readonly oauth: Record<OAuthProviderName, OAuthProvider>;
  private readonly onekey: OneKeyProvider;
  private readonly ids: IdFactory;
  private readonly merges: AccountMergeService;
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
    this.merges = new AccountMergeService(this.store, this.ids);
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
    return this.store.users.insert(user).catch((error: unknown) => {
      // 并发注册时「先查后插」会漏；这里兜住数据库唯一约束，转成 409 而不是 500。
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505' || /duplicate key|UNIQUE constraint/i.test(String(error))) {
        const detail = String((error as { constraint?: string }).constraint ?? (error as Error).message ?? '');
        if (detail.includes('username')) throw AppError.conflict('该用户名已被占用，请换一个');
        if (detail.includes('email')) throw AppError.conflict('该邮箱已注册，请直接登录');
        if (detail.includes('phone')) throw AppError.conflict('该手机号已注册，请直接登录');
        if (detail.includes('account_no')) throw AppError.conflict('账号号段分配冲突，请重试');
        throw AppError.conflict('该账号已存在，请直接登录');
      }
      throw error;
    });
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

  /** 统一换票入口：回调地址与发起授权时完全一致，底层异常不向路由层泄漏。 */
  private async exchangeProfile(provider: OAuthProviderName, code: string): Promise<OAuthProfile> {
    const adapter = this.oauth[provider];
    if (!adapter?.enabled) throw new AppError('PROVIDER_DISABLED', `${provider} 登录未配置`);
    try {
      return await adapter.exchange(code, oauthCallbackUrl(this.config, provider));
    } catch (error) {
      // 网络不可达 / 证书校验失败等底层错误统一收敛成渠道错误，避免暴露 500。
      if (error instanceof AppError) throw error;
      throw new AppError('PROVIDER_ERROR', `${provider} 授权服务不可达，请稍后重试`);
    }
  }

  private async requireActiveUser(userId: string): Promise<UserRecord> {
    const user = await this.store.users.findById(userId);
    if (!user) throw AppError.notFound('账号不存在');
    if (user.status !== 'active') throw new AppError('FORBIDDEN', '账号已被冻结');
    return user;
  }

  /** 把第三方身份挂到已有账号；并发撞唯一约束时回退为读取已存在的绑定。 */
  private async attachBinding(
    userId: string,
    provider: OAuthProviderName,
    profile: OAuthProfile,
  ): Promise<void> {
    try {
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
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505' || /duplicate key|UNIQUE constraint/i.test(String(error))) return;
      throw error;
    }
  }

  /**
   * 第三方登录归并顺序（每条判定的理由都写在分支上）：
   * 1. (provider, open_id) 已有绑定 → 就是该账号，最精确，直接登录；
   * 2. union_id 命中唯一账号 → 同一开放平台下的同一自然人，挂绑定后登录；
   *    union_id 命中多个账号 → 是历史重复账号，不静默合并，交给用户走手机号合并；
   * 3. 渠道返回已验证手机号且该手机号已注册 → 按手机号归并（手机号是现实身份）；
   * 4. 都不命中 → 才新建账号。
   */
  async loginByOAuth(input: {
    provider: OAuthProviderName;
    code: string;
  }): Promise<AuthResult> {
    const profile = await this.exchangeProfile(input.provider, input.code);

    const binding = await this.store.bindings.findByProvider(input.provider, profile.openId);
    if (binding) {
      const user = await this.requireActiveUser(binding.userId);
      return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: false };
    }

    if (profile.unionId) {
      const matches = await this.store.bindings.findByUnionId(profile.unionId);
      const userIds = [...new Set(matches.map((b) => b.userId))];
      if (userIds.length === 1) {
        const user = await this.requireActiveUser(userIds[0] as string);
        await this.attachBinding(user.id, input.provider, profile);
        return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: false };
      }
      if (userIds.length > 1) {
        throw new AppError('CONFLICT', '同一第三方身份关联了多个账号，请先用手机号登录完成合并', {
          mergeRequired: true,
          reason: 'union_id_conflict',
          userIds,
        });
      }
    }

    if (profile.phone && profile.phoneVerified) {
      const owner = await this.store.users.findByPhone(profile.phone);
      if (owner) {
        const user = await this.requireActiveUser(owner.id);
        await this.attachBinding(user.id, input.provider, profile);
        return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: false };
      }
    }

    const user = await this.createUser({
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      ...(profile.phone && profile.phoneVerified ? { phone: profile.phone } : {}),
    });
    try {
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
    } catch (error) {
      // 并发首登会同时走到这里，(provider, open_id) 唯一约束兜底：后到者改为登录已有账号。
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505' || /duplicate key|UNIQUE constraint/i.test(String(error))) {
        const raced = await this.store.bindings.findByProvider(input.provider, profile.openId);
        if (raced) {
          const owner = await this.store.users.findById(raced.userId);
          if (owner) {
            return {
              user: await this.toDto(owner),
              tokens: await this.issueTokens(owner),
              isNewUser: false,
            };
          }
        }
        throw AppError.conflict('该第三方账号正在被其他登录请求绑定，请重试');
      }
      throw error;
    }
    return { user: await this.toDto(user), tokens: await this.issueTokens(user), isNewUser: true };
  }

  async linkOAuth(userId: string, provider: OAuthProviderName, code: string): Promise<UserDto> {
    const user = await this.store.users.findById(userId);
    if (!user) throw AppError.notFound();
    if (user.status !== 'active') throw new AppError('FORBIDDEN', '账号已被冻结');
    const profile: OAuthProfile = await this.exchangeProfile(provider, code);
    const existing = await this.store.bindings.findByProvider(provider, profile.openId);
    if (existing) {
      if (existing.userId === userId) return this.toDto(user);
      throw new AppError('CONFLICT', '该第三方账号已绑定到其他用户，请登录该账号发起合并', {
        mergeRequired: true,
        reason: 'open_id_owned_by_other',
      });
    }
    if (profile.unionId) {
      const others = (await this.store.bindings.findByUnionId(profile.unionId)).filter(
        (b) => b.userId !== userId,
      );
      if (others.length) {
        const target = await this.store.users.findById(others[0]?.userId as string);
        throw new AppError('CONFLICT', '该第三方身份已关联其他账号，请在该账号中发起合并', {
          mergeRequired: true,
          reason: 'union_id_owned_by_other',
          targetAccountNo: target?.accountNo ?? null,
        });
      }
    }
    try {
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
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505' || /duplicate key|UNIQUE constraint/i.test(String(error))) {
        throw AppError.conflict('该第三方账号已绑定到其他用户');
      }
      throw error;
    }
    const updated = await this.store.users.update(userId, { guest: false });
    if (!updated) throw AppError.notFound();
    return this.toDto(updated);
  }

  /** 解绑第三方账号：至少保留一种可用于找回账号的登录方式。 */
  async unlinkOAuth(userId: string, provider: OAuthProviderName): Promise<UserDto> {
    const user = await this.store.users.findById(userId);
    if (!user) throw AppError.notFound();
    const bindings = await this.store.bindings.listByUser(userId);
    if (!bindings.some((item) => item.provider === provider)) {
      throw AppError.notFound('该渠道尚未绑定');
    }
    const hasOtherOAuth = bindings.some(
      (item) => item.provider !== provider && item.provider !== 'guest',
    );
    const hasPassword = Boolean(user.passwordHash) && Boolean(user.email || user.username);
    const hasPhone = Boolean(user.phone);
    if (!hasOtherOAuth && !hasPassword && !hasPhone) {
      throw AppError.conflict('至少保留一种登录方式，请先绑定手机号/邮箱/用户名或其他第三方账号');
    }
    await this.store.bindings.remove(userId, provider);
    return this.toDto(user);
  }

  /**
   * 绑定手机号。
   * 手机号属于其他账号时不报 409，而是先验证短信（二次确认），再合并到「手机号归属账号」。
   * 主账号 = 手机号拥有者：手机号是已验证的现实身份，比当前游客/渠道账号更强。
   * 合并后返回主账号资料与新的 token，调用方必须换用新 token（次账号已删除）。
   */
  async bindPhone(userId: string, phone: string, code: string): Promise<BindPhoneResult> {
    const current = await this.store.users.findById(userId);
    if (!current) throw AppError.notFound();
    await this.consumeSmsCode(phone, 'bind', code);

    const owner = await this.store.users.findByPhone(phone);
    if (!owner || owner.id === userId) {
      const updated = await this.store.users.update(userId, { phone, guest: false });
      if (!updated) throw AppError.notFound();
      return {
        user: await this.toDto(updated),
        tokens: await this.issueTokens(updated),
        merged: null,
      };
    }

    const result = await this.merges.merge({
      primaryUserId: owner.id,
      secondaryUserId: userId,
      reason: 'bind_phone',
      mergeKey: `bind_phone:${owner.id}:${userId}`,
      requirePrimaryPhone: phone,
    });
    return {
      user: await this.toDto(result.primary),
      tokens: await this.issueTokens(result.primary),
      merged: {
        mergeId: result.merge.id,
        replayed: result.replayed,
        moved: result.merge.moved,
        conflictStrategy: result.merge.conflictStrategy,
      },
    };
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

  /** 合并审计：最近的合并记录（含快照与迁移明细）。 */
  async listMerges(limit = 50) {
    const size = Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 50, 1), 200);
    return this.store.merges.list(size);
  }

  async getMerge(id: string) {
    const record = await this.store.merges.findById(id);
    if (!record) throw AppError.notFound('合并记录不存在');
    return record;
  }

  /** 历史重复账号真实统计：同一 union_id 落在多个账号上。 */
  async mergeCandidates() {
    const candidates = await this.merges.candidates();
    return { count: candidates.length, candidates };
  }

  /** 管理员兜底回滚：按合并前快照还原（刷新令牌无法复活）。 */
  async rollbackMerge(id: string) {
    const result = await this.merges.rollback(id);
    return { merge: result.merge, primary: await this.toDto(result.primary) };
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
}
