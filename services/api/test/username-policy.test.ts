import { describe, expect, it } from 'vitest';
import { checkUsername, normalizeUsername, assertUsernameAllowed } from '../src/lib/username-policy.js';

describe('用户名合规策略', () => {
  it('普通用户名放行', () => {
    for (const name of ['mixfan_01', '小明同学', 'Alex_2026']) {
      expect(checkUsername(name)).toEqual({ ok: true });
    }
  });

  it('归一化能识别全角、分隔符与零宽字符伪装', () => {
    expect(normalizeUsername('Ａｄｍｉｎ')).toBe('admin');
    expect(normalizeUsername('ad_min')).toBe('admin');
    expect(normalizeUsername('a\u200bdmin')).toBe('admin');
  });

  it('平台管理身份与国家机关身份均拒绝', () => {
    const cases = ['管理员', '超级管理员', '系统管理员', 'root', 'MixmApp官方', '公安局', '北京市政府'];
    for (const name of cases) {
      expect(checkUsername(name).ok).toBe(false);
    }
  });

  it('数字替字母的伪装同样拦截', () => {
    expect(checkUsername('4dm1n').ok).toBe(false);
  });

  it('外挂词库命中即拒绝，且提示不回显词库内容', () => {
    const result = checkUsername('某指定词用户', ['指定词']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('指定词');
  });

  it('assertUsernameAllowed 对违规名抛错', () => {
    expect(() => assertUsernameAllowed('超级管理员', [])).toThrow();
    expect(() => assertUsernameAllowed('正常用户_01', [])).not.toThrow();
  });
});
