import { AppError } from './errors.js';

/** 平台身份/管理员类词元：用户名不得暗示官方、客服、版主等平台角色。 */
const PLATFORM_TOKENS = [
  'admin',
  'administrator',
  'superadmin',
  'superuser',
  'sysadmin',
  'root',
  'system',
  'official',
  'support',
  'service',
  'moderator',
  'webmaster',
  'hostmaster',
  'guest',
  'anonymous',
  'robot',
  'mixm',
  'mixmapp',
  '管理员',
  '管理員',
  '超级管理员',
  '超级管理員',
  '系统管理员',
  '系統管理員',
  '官方',
  '客服',
  '游客',
  '遊客',
  '匿名',
  '站长',
  '站長',
  '版主',
  '小编',
  '小編',
  '运营',
  '運營',
  '审核',
  '審核',
  '机器人',
  '機器人',
];

/** 国家机关与公职身份类词元：不允许用作个人用户名，避免冒充。 */
const AUTHORITY_TOKENS = [
  '政府',
  '国务院',
  '國務院',
  '公安',
  '警察',
  '警官',
  '法院',
  '检察院',
  '檢察院',
  '检察',
  '军区',
  '軍區',
  '部队',
  '部隊',
  '党委',
  '党委会',
  '人大',
  '政协',
  '政協',
  '主席',
  '总书记',
  '總書記',
  '书记',
  '書記',
  '总理',
  '總理',
  '部长',
  '部長',
  '局长',
  '局長',
  '市长',
  '市長',
  '省长',
  '省長',
  '县长',
  '縣長',
  '镇长',
  '鎮長',
  '村长',
  '村長',
  '院长',
  '院長',
  '校长',
  '校長',
  '所长',
  '所長',
  '队长',
  '隊長',
  '人大代表',
  '政协委员',
  '政協委員',
  '公务员',
  '公務員',
  '军人',
  '軍人',
  '武警',
  '解放军',
  '解放軍',
];

/** 违法/低俗类词元：只做通用拦截，细分类目由 USERNAME_DENYLIST 按监管要求补齐。 */
const PROHIBITED_TOKENS = [
  '色情',
  '裸聊',
  '约炮',
  '博彩',
  '赌博',
  '賭博',
  '毒品',
  '枪支',
  '槍支',
  '炸药',
  '炸藥',
  '暴恐',
  '恐怖袭击',
  '诈骗',
  '詐騙',
  '洗钱',
  '洗錢',
  '代开发票',
  '办证',
];

/** 常见字符伪装：全角、分隔符、零宽字符、数字/符号替字母。 */
export function normalizeUsername(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_.\-·•|/\\]/g, '')
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '');
}

function deLeet(value: string): string {
  return value.replace(/[0134578@$]/g, (ch) => {
    const map: Record<string, string> = {
      '0': 'o',
      '1': 'i',
      '3': 'e',
      '4': 'a',
      '5': 's',
      '7': 't',
      '8': 'b',
      '@': 'a',
      $: 's',
    };
    return map[ch] ?? ch;
  });
}

function hit(variants: string[], tokens: string[]): boolean {
  return variants.some((variant) => tokens.some((token) => variant.includes(token)));
}

export type UsernameCheck = { ok: true } | { ok: false; message: string };

/**
 * 用户名合规校验：格式之外的准入规则。
 * - 不得使用平台管理/官方身份类名称；
 * - 不得使用国家机关、公职身份类名称；
 * - 不得包含违法低俗词；
 * - `denylist` 为运营方按监管要求外挂的词库（USERNAME_DENYLIST），命中同样拒绝。
 */
export function checkUsername(raw: string, denylist: string[] = []): UsernameCheck {
  const normalized = normalizeUsername(raw);
  const variants = [normalized, deLeet(normalized)].filter((value, index, arr) => arr.indexOf(value) === index);

  if (hit(variants, PLATFORM_TOKENS)) {
    return { ok: false, message: '该用户名涉及管理员/官方等平台身份，请更换' };
  }
  if (hit(variants, AUTHORITY_TOKENS)) {
    return { ok: false, message: '该用户名涉及国家机关或公职身份，禁止使用' };
  }
  if (hit(variants, PROHIBITED_TOKENS)) {
    return { ok: false, message: '该用户名包含违规内容，禁止使用' };
  }
  const external = denylist.map((item) => normalizeUsername(item)).filter(Boolean);
  if (external.length && hit(variants, external)) {
    return { ok: false, message: '该用户名包含平台禁止使用的内容' };
  }
  return { ok: true };
}

/** 校验失败抛 422，details 里给出可直接展示的提示。 */
export function assertUsernameAllowed(raw: string, denylist: string[] = []): void {
  const result = checkUsername(raw, denylist);
  if (!result.ok) {
    throw AppError.validation('用户名不可使用', [{ path: 'username', message: result.message }]);
  }
}
