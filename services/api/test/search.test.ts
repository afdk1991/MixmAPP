import { describe, expect, it } from 'vitest';
import {
  buildSearchIndexRow,
  buildSearchTokens,
  canonicalSpec,
  classifyToken,
  matchesSearchTokens,
  normalizeForSearch,
  tokenizeKeyword,
} from '../src/lib/search.js';

describe('搜索归一（对齐源站口径）', () => {
  it('全半角与大小写归一', () => {
    expect(normalizeForSearch('Ｍ３')).toBe('m3');
    expect(normalizeForSearch('１２.9')).toBe('12.9');
    expect(normalizeForSearch('  DIN   912  ')).toBe('din 912');
    expect(normalizeForSearch('M6×20')).toBe('m6x20');
  });

  it('多词 AND 分词且与顺序无关', () => {
    expect(tokenizeKeyword('内六角 12.9')).toEqual(['内六角', '12.9']);
    expect(tokenizeKeyword('12.9 内六角')).toEqual(['12.9', '内六角']);
    expect(tokenizeKeyword('  内六角   内六角  ')).toEqual(['内六角']);
  });

  it('规格等价：M6-1.0x8 / M6x8 / 6x8 / 6*8 / M6×8', () => {
    const forms = ['M6-1.0x8', 'M6x8', '6x8', '6*8', 'M6×8', 'Ｍ６－１.０×８'];
    for (const form of forms) expect(canonicalSpec(form)).toBe('6x8');
    // 细牙 0.5 / 1.5 不是默认粗牙，必须保留，不能和 M6x8 混为一谈
    expect(canonicalSpec('M3-0.5x4')).toBe('3x0.5x4');
    expect(canonicalSpec('M12×1.5')).toBe('12x1.5');
  });

  it('项目号分类：12 位全码、6 位前缀段、7~11 位不匹配', () => {
    expect(classifyToken('110001030004').kind).toBe('itemNo12');
    expect(classifyToken('110001').kind).toBe('itemNo6');
    expect(classifyToken('1100010').kind).toBe('itemNoMiss');
    expect(classifyToken('11000103').kind).toBe('itemNoMiss');
    expect(classifyToken('11000103000').kind).toBe('itemNoMiss');
    expect(classifyToken('6').kind).toBe('text');
    expect(classifyToken('12.9').kind).toBe('text');
    expect(classifyToken('M6-1.0x8').kind).toBe('spec');
  });

  it('命中规则：AND、项目号、规格等价、全半角', () => {
    const row = buildSearchIndexRow({
      title: 'EG 12.9级内六角圆柱头螺丝 M6-1.0x8',
      subtitle: 'M6-1.0x8 · 12.9级',
      brand: 'EG',
      specs: { 规格: 'M6-1.0x8', 等级: '12.9' },
      sourceId: '110001060008',
    });
    const hit = (kw: string) => matchesSearchTokens(row, buildSearchTokens(kw));

    expect(hit('内六角 12.9')).toBe(true);
    expect(hit('12.9 内六角')).toBe(true);
    expect(hit('内六角 14.9')).toBe(false);
    expect(hit('M6x8')).toBe(true);
    expect(hit('6x8')).toBe(true);
    expect(hit('6*8')).toBe(true);
    expect(hit('M6×8')).toBe(true);
    expect(hit('Ｍ６－１.０×８')).toBe(true);
    expect(hit('110001060008')).toBe(true);
    expect(hit('110001')).toBe(true);
    expect(hit('1100010')).toBe(false);
    expect(hit('nope')).toBe(false);
  });
});
