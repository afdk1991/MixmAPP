/**
 * 首启隐私政策与权限说明：同意状态只保存在本机（uni storage），不上报服务端。
 * 政策实质变更时升级 PRIVACY_POLICY_VERSION，用户下次启动会重新看到同意页。
 */
export const PRIVACY_POLICY_VERSION = '2026-11';
export const PRIVACY_CONSENT_KEY = 'mixmapp:privacy-consent';

type ConsentRecord = { version: string; at: string };

export function hasPrivacyConsent(): boolean {
  try {
    const record = uni.getStorageSync(PRIVACY_CONSENT_KEY) as ConsentRecord | '';
    return !!record && record.version === PRIVACY_POLICY_VERSION;
  } catch {
    return false;
  }
}

export function recordPrivacyConsent(): void {
  try {
    uni.setStorageSync(PRIVACY_CONSENT_KEY, {
      version: PRIVACY_POLICY_VERSION,
      at: new Date().toISOString(),
    });
  } catch {
    // 存储不可用时不阻断本次会话；下次冷启动会再次征询
  }
}
