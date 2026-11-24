import type { DeleteAccountInput } from '@mixmapp/contracts';
import type { Store, UserRecord } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { randomToken, verifyPassword } from '../lib/crypto.js';

/** 注销身份校验方式：与 deleteAccountSchema 的 method 枚举同口径。 */
export type DeletionMethod = 'password' | 'sms' | 'device';

export type DeletionOptionsResult = {
  methods: DeletionMethod[];
  /** device 方式需要先一次性挑战票据 */
  requiresChallenge: boolean;
  /** 掩码后的绑定手机号，仅用于展示；无绑定返回 null */
  phone: string | null;
};

export type DeletionResult = {
  deleted: true;
  revokedSessions: number;
  ordersAnonymized: number;
  purged: {
    binds: number;
    devices: number;
    addresses: number;
    favorites: number;
    carts: number;
    pushTokens: number;
  };
};

/** 设备挑战票据有效期：5 分钟，单次有效。 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type DeletionDeps = {
  store: Store;
  /** 短信验证码校验（purpose=delete）；失败由实现抛 CODE_INVALID / CODE_EXPIRED */
  verifySms: (phone: string, code: string) => Promise<void>;
};

function maskPhone(phone: string | null): string | null {
  return phone ? `${phone.slice(0, 3)}****${phone.slice(7)}` : null;
}

/**
 * 账号注销：校验分级（密码 → 短信 → 设备强确认）通过后，级联清除个人数据、
 * 订单/支付留行脱敏。校验失败一律不改动任何数据。
 */
export class AccountDeletionService {
  private readonly store: Store;
  private readonly verifySms: (phone: string, code: string) => Promise<void>;

  constructor(deps: DeletionDeps) {
    this.store = deps.store;
    this.verifySms = deps.verifySms;
  }

  private availableMethods(user: UserRecord): DeletionMethod[] {
    const methods: DeletionMethod[] = [];
    if (user.passwordHash) methods.push('password');
    if (user.phone) methods.push('sms');
    methods.push('device');
    return methods;
  }

  /** GET /me/account/deletion-options：当前账号可用的校验方式。 */
  async options(userId: string): Promise<DeletionOptionsResult> {
    const user = await this.requireActive(userId);
    const methods = this.availableMethods(user);
    return {
      methods,
      requiresChallenge: methods.includes('device'),
      phone: maskPhone(user.phone),
    };
  }

  /**
   * POST /me/account/delete-challenge：仅 device 方式。
   * - 存在最近设备快照：deviceId 必须与快照严格一致，不一致返回 DELETE_DEVICE_MISMATCH；
   * - 没有任何快照（游客 / 未带设备上下文的 OAuth 账号）：deviceId 不做匹配，
   *   仅作为一次性票据的绑定要素，票据绑定 (userId, deviceId)，5 分钟过期、单次有效。
   */
  async issueDeviceChallenge(
    userId: string,
    deviceId: string,
  ): Promise<{ challenge: string; expiresInSec: number }> {
    await this.requireActive(userId);
    const snapshot = await this.store.userDevices.latest(userId);
    if (snapshot && snapshot.deviceId !== deviceId) {
      throw new AppError(
        'DELETE_DEVICE_MISMATCH',
        '当前设备与最近登录设备不一致，请改用密码或短信验证码验证',
      );
    }
    const challenge = randomToken(32);
    await this.store.accountChallenges.insert({
      challenge,
      userId,
      deviceId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      consumedAt: null,
    });
    return { challenge, expiresInSec: CHALLENGE_TTL_MS / 1000 };
  }

  /** POST /me/account/delete：分级校验通过后执行级联注销。 */
  async deleteAccount(userId: string, input: DeleteAccountInput): Promise<DeletionResult> {
    const user = await this.requireActive(userId);

    // 逐字确认文案；与 schema 的 literal 互为兜底，错误码按规格固定为 DELETE_CONFIRM_REQUIRED。
    if (input.confirm !== '注销') {
      throw new AppError('DELETE_CONFIRM_REQUIRED', '请逐字输入「注销」确认账号删除');
    }

    const methods = this.availableMethods(user);
    if (!methods.includes(input.method)) {
      throw new AppError('DELETE_METHOD_NOT_ALLOWED', '当前账号不支持该验证方式');
    }

    // 校验阶段：任何一种方式失败都直接抛出，不进入级联删除，不改动数据。
    await this.verify(user, input);

    const counts = await this.store.accountDeletion.erase(userId);
    return {
      deleted: true,
      revokedSessions: counts.revokedSessions,
      ordersAnonymized: counts.ordersAnonymized,
      purged: {
        binds: counts.binds,
        devices: counts.devices,
        addresses: counts.addresses,
        favorites: counts.favorites,
        carts: counts.carts,
        pushTokens: counts.pushTokens,
      },
    };
  }

  private async verify(user: UserRecord, input: DeleteAccountInput): Promise<void> {
    switch (input.method) {
      case 'password': {
        if (!input.password || !(await verifyPassword(input.password, user.passwordHash))) {
          throw new AppError('DELETE_VERIFY_FAILED', '密码不正确');
        }
        return;
      }
      case 'sms': {
        if (!user.phone || !input.code) {
          throw new AppError('DELETE_VERIFY_FAILED', '短信验证码不正确或已过期');
        }
        try {
          await this.verifySms(user.phone, input.code);
        } catch {
          // 登录同口径的 CODE_INVALID / CODE_EXPIRED 统一收敛为注销校验失败。
          throw new AppError('DELETE_VERIFY_FAILED', '短信验证码不正确或已过期');
        }
        return;
      }
      case 'device': {
        if (!input.challenge || !input.deviceId) {
          throw new AppError('DELETE_CHALLENGE_REQUIRED', '设备挑战票据缺失，请先发起设备挑战');
        }
        const snapshot = await this.store.userDevices.latest(user.id);
        // 有快照才做严格设备匹配；无快照时设备一致性由票据绑定 (userId, deviceId) 兜底。
        if (snapshot && snapshot.deviceId !== input.deviceId) {
          throw new AppError('DELETE_DEVICE_MISMATCH', '当前设备与最近登录设备不一致');
        }
        const challenge = await this.store.accountChallenges.consume(input.challenge);
        if (
          !challenge ||
          challenge.userId !== user.id ||
          challenge.deviceId !== input.deviceId
        ) {
          throw new AppError('DELETE_CHALLENGE_INVALID', '挑战票据无效、已使用或已过期，请重新发起');
        }
        return;
      }
    }
  }

  private async requireActive(userId: string): Promise<UserRecord> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new AppError('ACCOUNT_ALREADY_DELETED', '账号不存在或已注销');
    return user;
  }
}
