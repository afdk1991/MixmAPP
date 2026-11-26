/**
 * 页面 SEO 元信息（仅 H5 生效）。
 *
 * 为什么运行时还要写一遍：
 * - 静态站的主体内容由构建期预渲染（scripts/prerender-suite.mjs）负责，
 *   搜索引擎抓到的是带 meta 与 JSON-LD 的 HTML；
 * - 但这套内容是单页应用，路由切换不会重新请求 HTML，
 *   所以运行期必须把 title / description / canonical 同步到当前页面，
 *   否则用户从搜索结果点进来后，浏览器标签与分享卡片仍是首页信息。
 *
 * 非 H5 端只设置导航栏标题（uni 的原生标题栏），不做 DOM 操作。
 */

export type SuiteSeoInput = {
  title: string;
  description: string;
  /** 站内路径（以 / 开头），用于拼 canonical */
  path: string;
  /** 结构化数据对象（JSON-LD）。不传则不注入。 */
  jsonLd?: Record<string, unknown>;
};

/** 站点主域：canonical 与 sitemap 都用它，避免出现多个「正式」地址。 */
export const SITE_ORIGIN = 'https://www.mixm.top';

/** 由站内路径拼出完整 URL。 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_ORIGIN}${normalized}`;
}

function setMeta(name: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(url: string): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}

/**
 * 注入 JSON-LD 结构化数据。
 * 同一次会话里重复调用会替换掉上一份（按 data-mx-seo 标记定位），
 * 避免路由切换后页面上堆叠多份互相矛盾的 schema。
 */
function setJsonLd(data: Record<string, unknown>): void {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector<HTMLScriptElement>('script[data-mx-seo="jsonld"]');
  if (existing) existing.remove();
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.setAttribute('data-mx-seo', 'jsonld');
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

/**
 * 应用一套 SEO 元信息。
 * @param input 标题、描述、站内路径与可选结构化数据
 */
export function applySuiteSeo(input: SuiteSeoInput): void {
  // 非 H5 端：只更新原生导航栏标题。
  if (typeof document === 'undefined') {
    try {
      uni.setNavigationBarTitle({ title: input.title });
    } catch {
      // 个别端不支持时静默，不阻断页面
    }
    return;
  }

  document.title = input.title;
  setMeta('description', input.description);
  setMeta('keywords', 'MixmAPP, 业务套件, 办公管理, 金融, 电商, 内容创作, 教育科研');
  setCanonical(absoluteUrl(input.path));
  if (input.jsonLd) setJsonLd(input.jsonLd);
}
