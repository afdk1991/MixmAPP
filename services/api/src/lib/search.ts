/**
 * 商品搜索口径（对齐源站搜索行为，但不复制其缺陷）。
 *
 * 源站规则：
 * - 多词按 AND 分词，与顺序无关：`内六角 12.9` ≡ `12.9 内六角`。
 * - 项目号（源站 code，12 位）：整码精确匹配。
 * - 6 位段码：按前缀段匹配（`110001` 命中 `110001030004`）。
 * - 7~11 位中间片段：源站不匹配，这里保持一致。
 * - 规格等价：`M6-1.0x8` / `M6x8` / `6x8` / `6*8` / `M6×8` 视为同一规格
 *   （去掉 M 前缀、默认粗牙 1.0、分隔符差异）。
 * - 大小写不敏感、全半角归一（`Ｍ３` ≡ `M3`、`１２.9` ≡ `12.9`）。
 *
 * 源站缺陷（明确不抄）：大小写敏感、全半角不归一、规格串零命中。
 *
 * 本模块是纯函数，不依赖 Store/框架：catalog 内存索引、MemoryStore、PgStore 三条读路径
 * 共用同一套分词与归一规则，避免行为漂移。
 */

/** 全角 ASCII（U+FF01~U+FF5E）→ 半角；全角空格 U+3000 → 普通空格。 */
const FULLWIDTH_FROM = `${Array.from({ length: 94 }, (_, i) => String.fromCharCode(0xff01 + i)).join('')}\u3000`;
const FULLWIDTH_TO = `${Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join('')} `;

export const FULLWIDTH_TRANSLATE_FROM = FULLWIDTH_FROM;
export const FULLWIDTH_TRANSLATE_TO = FULLWIDTH_TO;

/**
 * 搜索用归一：全角转半角、统一乘法符号、小写、压缩空白。
 * 不使用 String.prototype.normalize('NFKC')：它会把 `×` 等符号改写成别的字符，
 * 这里需要保留 `×` 以便后续规格分隔符归一，规则显式可控。
 */
export function normalizeForSearch(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else if (code === 0x3000) out += ' ';
    else out += ch;
  }
  // 全角／半角乘法符号统一成 ASCII x，便于规格分词；其余字符保持原样
  return out.replace(/[×✕✖]/g, 'x').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 按空白分词；去重并保持首次出现顺序，避免同一个词做两次 AND。 */
export function tokenizeKeyword(keyword: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of normalizeForSearch(keyword).split(' ')) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    tokens.push(part);
  }
  return tokens;
}

/**
 * 规格串归一（与 SQL 侧 `searchSpecKeyExpression` 必须逐字对应）：
 * 1) 去空白；2) `*`/`×` → `x`；3) 去掉开头 M；4) 去掉非首段的默认粗牙 1/1.0/1.00；
 * 5) `-` → `x`；6) 合并连续 x。
 * 例：`M6-1.0x8`、`M6x8`、`6x8`、`6*8`、`M6×8` 全部得到 `6x8`。
 */
export function canonicalSpec(input: string): string {
  let s = normalizeForSearch(input).replace(/\s+/g, '').replace(/[×*]/g, 'x');
  s = s.replace(/^m/, '');
  // 非首段且值为 1 / 1.0 / 1.00 的段视为默认粗牙，直接丢掉（第二个捕获组是分隔符）
  s = s.replace(/([-x])1(?:\.0+)?([-x]|$)/g, '$1$2');
  s = s.replace(/[-*×]/g, 'x');
  return s.replace(/x{2,}/g, 'x');
}

/** 是否是「能按规格等价规则比较」的词：M6-1.0x8 / M6x8 / 6x8 / M6×8 这类带段的串。 */
export function isSpecLike(token: string): boolean {
  const normalized = normalizeForSearch(token).replace(/\s+/g, '');
  return /^m?\d+(?:\.\d+)?(?:[-x*×]\d+(?:\.\d+)?)+$/.test(normalized);
}

export type SearchTokenKind = 'itemNo12' | 'itemNo6' | 'itemNoMiss' | 'spec' | 'text';

export type SearchToken = {
  /** 归一后的原文（text/spec 直接用于子串匹配） */
  raw: string;
  kind: SearchTokenKind;
  /** kind=spec 时的规格归一键 */
  canonical: string;
};

/**
 * 单词分类：
 * - 12 位纯数字 = 项目号全码；
 * - 6 位纯数字 = 段码前缀；
 * - 7~11 位纯数字 = 源站不匹配的中间片段；
 * - 其它纯数字（1~5 位）仍按普通文本搜索（如直径 6、等级 12）。
 */
export function classifyToken(rawToken: string): SearchToken {
  const token = normalizeForSearch(rawToken).replace(/\s+/g, '');
  if (/^\d{12}$/.test(token)) return { raw: token, kind: 'itemNo12', canonical: token };
  if (/^\d{6}$/.test(token)) return { raw: token, kind: 'itemNo6', canonical: token };
  if (/^\d{7,11}$/.test(token)) return { raw: token, kind: 'itemNoMiss', canonical: token };
  if (isSpecLike(token)) return { raw: token, kind: 'spec', canonical: canonicalSpec(token) };
  return { raw: token, kind: 'text', canonical: token };
}

export function buildSearchTokens(keyword: string | undefined): SearchToken[] {
  if (!keyword) return [];
  return tokenizeKeyword(keyword).map(classifyToken);
}

/** 单商品搜索索引：text 为归一后的可搜索文本，itemNos 为可参与项目号规则的编号。 */
export type SearchIndexRow = {
  text: string;
  /** 规格键（`specs.规格` 的 canonicalSpec 结果） */
  specKeys: string[];
  /** sourceId / sourceItemNo / sourceKey 里能参与项目号匹配的编号 */
  itemNos: string[];
};

/** 命中规则：多词 AND，顺序无关；任一词不命中即整条不命中。 */
export function matchesSearchTokens(row: SearchIndexRow, tokens: SearchToken[]): boolean {
  return tokens.every((token) => {
    if (token.kind === 'itemNo12') return row.itemNos.some((no) => no === token.raw);
    if (token.kind === 'itemNo6') return row.itemNos.some((no) => no.startsWith(token.raw));
    if (token.kind === 'itemNoMiss') return false;
    if (token.kind === 'spec') {
      // 有规格键时只做等价比对，避免 `M12x1` 命中 `M12x1.5` 这类前缀误报；
      // 老数据没有「规格」字段时才回落到文本子串。
      return row.specKeys.length
        ? row.specKeys.includes(token.canonical)
        : row.text.includes(token.raw);
    }
    return row.text.includes(token.raw);
  });
}

/** 构造内存索引行：目录源与 MemoryStore 共用，字段口径保持一致。 */
export function buildSearchIndexRow(input: {
  title: string;
  subtitle?: string | null;
  brand?: string | null;
  specs?: Record<string, string> | null;
  sourceId?: string | null;
  sourceItemNo?: string | null;
  sourceKey?: string | null;
}): SearchIndexRow {
  const parts: string[] = [input.title, input.subtitle ?? '', input.brand ?? ''];
  for (const [key, value] of Object.entries(input.specs ?? {})) parts.push(key, value);
  const itemNos = [input.sourceId, input.sourceItemNo, input.sourceKey?.replace(/^sku:/, '')].filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  parts.push(...itemNos);
  const spec = input.specs?.['规格'];
  return {
    text: normalizeForSearch(parts.join(' ')),
    specKeys: spec ? [canonicalSpec(spec)] : [],
    itemNos,
  };
}

/**
 * SQL 侧：把 LIKE 通配符转义，避免用户输入 `%`/`_` 被当通配符。
 * 配合 `like $n escape '\'` 使用。
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
