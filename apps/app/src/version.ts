// 由 scripts/version.mjs 生成，禁止手工修改。
// 单一事实源：version.json —— 改版本请跑 pnpm version:sync / version:release。
export const APP_VERSION = '0.0.2';

/** 当前构建渠道，来自 version.json 的 channel；release 即正式版。 */
export const APP_CHANNEL: string = 'release';
