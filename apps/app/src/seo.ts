/**
 * H5 端运行时 SEO：按当前路由维护 title / description / canonical / OG / JSON-LD。
 *
 * 为什么需要：
 * - 本项目是 uni-app 的 history 模式 SPA，所有页面共用同一张 index.html，
 *   title / description 在切页后不会变化，搜索引擎与分享卡片只能拿到默认文案。
 * - 构建期只能给单页壳注入全局 meta（见 scripts/generate-seo.mjs），
 *   商品详情这类跟数据走的标题必须在运行期按接口结果补齐。
 *
 * 约束：
 * - 只在 H5 调用（main.ts 用条件编译包裹），小程序 / App 端不执行任何 DOM 操作；
 * - 零第三方依赖，只用原生 DOM API；
 * - 路由字符串一律引用 routes.ts 的 ROUTES，避免散落的页面路径字面量。
 */
import { ROUTES } from './routes';

/** 对外 canonical 使用的正式站点。预览 / 本地访问时回退到当前 origin，避免把预览页标成正式页。 */
const PRODUCTION_ORIGIN = 'https://www.mixm.top';

/** 站点名：title 后缀与结构化数据的 name 共用同一处，避免多处各写一份。 */
const SITE_NAME = 'MixmAPP 五金商城';

/** 首页默认描述：构建期注入的 description 与运行期保持同一句，避免两处不一致。 */
const HOME_DESCRIPTION =
  'MixmAPP 五金商城提供螺丝、刀刃具、手工具、膨胀件等工业标准件在线采购，按分类、规格、品牌筛选，一个账号贯通 H5、小程序与 App。';

/** 单个静态路由的 SEO 描述；index=false 的路由会被标记 noindex（账户、交易类页面）。 */
type StaticMeta = {
  title: string;
  description: string;
  /** 是否允许搜索引擎索引；账户与交易类页面一律 false。 */
  index: boolean;
};

/** 静态路由 → 文案映射。只有不带业务数据的页面才需要写在这里。 */
const STATIC_META: Record<string, StaticMeta> = {
  [ROUTES.home]: {
    title: SITE_NAME,
    description: HOME_DESCRIPTION,
    index: true,
  },
  [ROUTES.mall]: {
    title: `商城 · 五金标准件在线采购 · ${SITE_NAME}`,
    description:
      '商城覆盖螺丝、刀刃具、手工具、膨胀件等品类，支持按类目、规格、品牌与关键词筛选，实时价与货源状态一目了然。',
    index: true,
  },
  [ROUTES.legalPrivacy]: {
    title: `隐私政策与权限说明 · ${SITE_NAME}`,
    description:
      '说明 MixmAPP 收集哪些信息、用于什么目的、保存多久，以及账号注销、数据导出与权限授权的具体方式。',
    index: true,
  },
  [ROUTES.about]: {
    title: `关于与能力 · ${SITE_NAME}`,
    description: '了解 MixmAPP 的版本信息、已装配的第三方能力与运行环境说明。',
    index: true,
  },
  [ROUTES.research]: {
    title: `研究报告 · ${SITE_NAME}`,
    description: '按主题整理的研究内容与选品参考，支持检索与详情阅读。',
    index: true,
  },
  [ROUTES.researchDetail]: {
    title: `研究详情 · ${SITE_NAME}`,
    description: '研究报告详情。',
    index: true,
  },
  [ROUTES.assistant]: {
    title: `智能助手 · ${SITE_NAME}`,
    description: '在站内直接提问，获取商品与采购相关的辅助信息。',
    index: true,
  },
  [ROUTES.login]: {
    title: `登录 · ${SITE_NAME}`,
    description: '登录 MixmAPP 账号，同步购物车、收藏与订单。',
    index: false,
  },
  [ROUTES.register]: {
    title: `注册 · ${SITE_NAME}`,
    description: '注册 MixmAPP 账号，一个账号贯通所有端。',
    index: false,
  },
  [ROUTES.me]: {
    title: `我的通行证 · ${SITE_NAME}`,
    description: '账号资料、绑定方式与安全设置。',
    index: false,
  },
  [ROUTES.favorites]: {
    title: `收藏夹 · ${SITE_NAME}`,
    description: '查看已收藏的商品与收藏夹。',
    index: false,
  },
  [ROUTES.cart]: {
    title: `购物车 · ${SITE_NAME}`,
    description: '查看购物车并结算。',
    index: false,
  },
  [ROUTES.orders]: {
    title: `我的订单 · ${SITE_NAME}`,
    description: '查看订单状态与历史订单。',
    index: false,
  },
  [ROUTES.accountDelete]: {
    title: `注销账号 · ${SITE_NAME}`,
    description: '账号注销的影响说明与操作入口。',
    index: false,
  },
  [ROUTES.localData]: {
    title: `本地数据 · ${SITE_NAME}`,
    description: '查看并清理保存在本机上的数据。',
    index: false,
  },
  [ROUTES.admin]: {
    title: `管理控制台 · ${SITE_NAME}`,
    description: '站点管理控制台。',
    index: false,
  },
  [ROUTES.notFound]: {
    title: `页面不存在 · ${SITE_NAME}`,
    description: '请求的页面不存在或已下线。',
    index: false,
  },
};

/** 当前环境可用的 canonical origin：正式域名与本地预览分开，避免本地地址被写进 canonical。 */
function canonicalOrigin(): string {
  if (typeof window === 'undefined') return PRODUCTION_ORIGIN;
  const host = window.location.hostname;
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return window.location.origin;
  }
  return PRODUCTION_ORIGIN;
}

/** 读取或创建 `<meta name/property>`，用于幂等更新而不是重复插入。 */
function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined') return;
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

/** 读取或创建 `<link rel>`（canonical），统一由这一处维护。 */
function upsertLink(rel: string, href: string): void {
  if (typeof document === 'undefined') return;
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

/** 写入/替换指定 id 的 JSON-LD 脚本；传 null 表示移除该块。 */
function upsertJsonLd(id: string, data: Record<string, unknown> | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(id);
  if (!data) {
    if (existing) existing.remove();
    return;
  }
  const script = existing instanceof HTMLScriptElement ? existing : document.createElement('script');
  script.id = id;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  if (!existing) document.head.appendChild(script);
}

/** 站点级结构化数据：Organization + WebSite（带站内搜索 Action），只保留一份。 */
function applySiteJsonLd(): void {
  const origin = canonicalOrigin();
  upsertJsonLd('mx-jsonld-org', {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${origin}/`,
    description: HOME_DESCRIPTION,
  });
  upsertJsonLd('mx-jsonld-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${origin}/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${origin}/mall?keyword={query}`,
      'query-input': 'required name=query',
    },
  });
}

/** 统一写入一份页面级 meta：title / description / canonical / OG / robots。 */
function applyMeta(input: {
  title: string;
  description: string;
  canonical: string;
  index: boolean;
  ogType?: 'website' | 'product' | 'article';
  ogImage?: string;
}): void {
  if (typeof document === 'undefined') return;
  document.title = input.title;
  upsertMeta('name', 'description', input.description);
  upsertMeta('name', 'robots', input.index ? 'index,follow,max-image-preview:large' : 'noindex,nofollow');
  upsertLink('canonical', input.canonical);
  upsertMeta('property', 'og:title', input.title);
  upsertMeta('property', 'og:description', input.description);
  upsertMeta('property', 'og:url', input.canonical);
  upsertMeta('property', 'og:type', input.ogType ?? 'website');
  upsertMeta('property', 'og:site_name', SITE_NAME);
  if (input.ogImage) {
    upsertMeta('property', 'og:image', input.ogImage);
    upsertMeta('name', 'twitter:image', input.ogImage);
  }
  upsertMeta('name', 'twitter:card', input.ogImage ? 'summary_large_image' : 'summary');
  upsertMeta('name', 'twitter:title', input.title);
  upsertMeta('name', 'twitter:description', input.description);
}

/** 把 URL 里可能夹带的查询串去掉，只留 pathname。 */
function currentPath(): string {
  if (typeof window === 'undefined') return ROUTES.home;
  return window.location.pathname || ROUTES.home;
}

/**
 * 解析当前地址为「内部路由 + 查询参数」。
 *
 * 地址栏在运行期会被 restorePrettyUrl 改成对外地址（/mall、/mall/category/x、
 * /mall/detail/x），再次触发 SEO 计算时必须能重新识别，否则会被当成未知路由而标成 noindex。
 */
function resolveCurrentRoute(): { path: string; search: URLSearchParams } {
  const raw = currentPath().replace(/\/+$/, '');
  const search = currentSearch();
  if (raw === '/mall') return { path: ROUTES.mall, search };
  const category = /^\/mall\/category\/([^/]+)$/.exec(raw);
  if (category && category[1]) {
    search.set('category', category[1]);
    return { path: ROUTES.mall, search };
  }
  const detail = /^\/mall\/detail\/([^/]+)$/.exec(raw);
  if (detail && detail[1]) {
    search.set('id', detail[1]);
    return { path: ROUTES.mallDetail, search };
  }
  return { path: raw, search };
}

/** 当前查询参数（H5 history 模式下由 uni 写在 location.search 上）。 */
function currentSearch(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** 商品详情对外 canonical：漂亮路径 /mall/detail/<id>，与 sitemap、静态快照保持同一口径。 */
export function productCanonical(productId: string): string {
  return `${canonicalOrigin()}/mall/detail/${encodeURIComponent(productId)}`;
}

/** 分类页对外 canonical：/mall/category/<code>，与 sitemap、静态快照保持同一口径。 */
export function categoryCanonical(code: string): string {
  return `${canonicalOrigin()}/mall/category/${encodeURIComponent(code)}`;
}

/**
 * 站内跳转后把地址栏恢复成对外漂亮地址（不新增历史记录）。
 *
 * 为什么需要：uni 的路由只认内部路径，若一直停留在内部地址，
 * canonical 声明的是 /mall/detail/x、地址栏却是内部路由，分享出去也很长。
 * replaceState 只改写当前这条历史记录，不触发 popstate，也不会让 uni 重新导航。
 */
function restorePrettyUrl(path: string, search: URLSearchParams): void {
  if (typeof window === 'undefined') return;
  let pretty = '';
  if (path === ROUTES.home) {
    pretty = '/';
  } else if (path === ROUTES.mall) {
    const category = search.get('category') ?? '';
    if (category) {
      // 分类页保留其余筛选参数（关键词、排序等），刷新后状态不丢。
      const rest = new URLSearchParams(search);
      rest.delete('category');
      const query = rest.toString();
      pretty = `/mall/category/${encodeURIComponent(category)}${query ? `?${query}` : ''}`;
    } else {
      const query = search.toString();
      pretty = `/mall${query ? `?${query}` : ''}`;
    }
  } else if (path === ROUTES.mallDetail) {
    const id = search.get('id') ?? '';
    // 详情页只保留商品 id，其余参数不进入对外地址。
    if (id) pretty = `/mall/detail/${encodeURIComponent(id)}`;
  }
  if (!pretty) return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== pretty) window.history.replaceState(window.history.state, '', pretty);
}

/**
 * 商品详情 SEO：由详情页拿到商品后调用，补齐 Product 结构化数据与商品级标题。
 * 传 null 表示离开详情页，清掉商品级 JSON-LD。
 */
export function setProductSeo(
  product:
    | {
        id: string;
        title: string;
        subtitle?: string | null;
        description?: string | null;
        brand?: string | null;
        images?: string[] | null;
        cover?: string | null;
        categoryPath?: string[] | null;
      }
    | null,
): void {
  if (typeof document === 'undefined') return;
  if (!product) {
    upsertJsonLd('mx-jsonld-product', null);
    return;
  }
  const canonical = productCanonical(product.id);
  const description = (product.description || product.subtitle || product.title || '').slice(0, 160);
  const image = Array.isArray(product.images) ? product.images.find((item) => typeof item === 'string' && item) : '';
  const imageUrl = image && /^(https?:|\/)/.test(image) ? new URL(image, canonicalOrigin()).href : '';
  applyMeta({
    title: `${product.title} · ${SITE_NAME}`,
    description,
    canonical,
    index: true,
    ogType: 'product',
    ...(imageUrl ? { ogImage: imageUrl } : {}),
  });
  upsertJsonLd('mx-jsonld-product', {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description,
    sku: product.id,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(product.categoryPath && product.categoryPath.length
      ? { category: product.categoryPath.join(' > ') }
      : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CNY',
      availability: 'https://schema.org/InStock',
      url: canonical,
    },
  });
}

/**
 * 按当前地址重算页面 SEO。uni 切页后调用；未知路由回退到首页文案，避免残留上一页的标题。
 */
export function applyCurrentRouteSeo(): void {
  if (typeof document === 'undefined') return;
  const { path, search } = resolveCurrentRoute();
  // 先把地址栏恢复成对外地址，再写 meta，保证 canonical 与 location 一致。
  restorePrettyUrl(path, search);

  // 商品详情：标题在数据回来后由 setProductSeo 覆盖，这里先给出稳定的兜底文案与 canonical。
  if (path === ROUTES.mallDetail) {
    const id = search.get('id') ?? '';
    applyMeta({
      title: `商品详情 · ${SITE_NAME}`,
      description: '查看商品规格、货源状态与采购方式。',
      canonical: id ? productCanonical(id) : `${canonicalOrigin()}${ROUTES.mall}`,
      index: Boolean(id),
      ogType: 'product',
    });
    if (!id) upsertJsonLd('mx-jsonld-product', null);
    applySiteJsonLd();
    return;
  }

  // 商城列表：带 category 时按分类页给 canonical，避免筛选视图被当成重复内容。
  if (path === ROUTES.mall) {
    const category = search.get('category') ?? '';
    applyMeta({
      title: STATIC_META[ROUTES.mall]?.title ?? SITE_NAME,
      description: STATIC_META[ROUTES.mall]?.description ?? HOME_DESCRIPTION,
      canonical: category ? categoryCanonical(category) : `${canonicalOrigin()}/mall`,
      index: true,
    });
    upsertJsonLd('mx-jsonld-product', null);
    applySiteJsonLd();
    return;
  }

  const staticMeta = STATIC_META[path];
  if (staticMeta) {
    applyMeta({
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: path === ROUTES.home ? `${canonicalOrigin()}/` : `${canonicalOrigin()}${path}`,
      index: staticMeta.index,
    });
    upsertJsonLd('mx-jsonld-product', null);
    applySiteJsonLd();
    return;
  }

  // 静态文案表没覆盖到的路由（公共路由单独维护，不为它编造 SEO 文案）。
  applyMeta({
    title: SITE_NAME,
    description: HOME_DESCRIPTION,
    canonical: `${canonicalOrigin()}/`,
    index: false,
  });
  upsertJsonLd('mx-jsonld-product', null);
  applySiteJsonLd();
}

/**
 * 把对外的漂亮 URL 改写成 uni 内部路由（在应用挂载前执行，避免首帧 404）。
 *
 * 对外地址                          → 内部地址
 * /mall                            → ROUTES.mall
 * /mall/category/<code>            → ROUTES.mall?category=<code>
 * /mall/detail/<id>                → ROUTES.mallDetail?id=<id>
 *
 * 用 replaceState 而不是 pushState：用户从搜索引擎进来时不应多出一条历史记录。
 */
export function normalizeSeoEntry(): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname.replace(/\/+$/, '');
  const search = window.location.search;
  if (path === '/mall') {
    window.history.replaceState(null, '', `${ROUTES.mall}${search}`);
    return;
  }
  const category = /^\/mall\/category\/([^/]+)$/.exec(path);
  if (category && category[1]) {
    // 保留关键词 / 排序等附加参数，只把 category 换成内部查询参数。
    const params = new URLSearchParams(search);
    params.set('category', category[1]);
    window.history.replaceState(null, '', `${ROUTES.mall}?${params.toString()}`);
    return;
  }
  const detail = /^\/mall\/detail\/([^/]+)$/.exec(path);
  if (detail && detail[1]) {
    const params = new URLSearchParams(search);
    params.set('id', detail[1]);
    window.history.replaceState(null, '', `${ROUTES.mallDetail}?${params.toString()}`);
  }
}

/**
 * 挂载运行期 SEO：首次渲染后执行一次，之后在每次站内跳转 / 浏览器前进后退时重算。
 *
 * 为什么同时拦截 uni API 与 popstate：
 * - uni 的 navigateTo / switchTab 最终改的是 history，但改完的时间点不确定，
 *   用 addInterceptor 的 complete 回调节点最稳；
 * - 浏览器前进 / 后退不经过 uni API，只能靠 popstate / hashchange 兜住。
 */
export function installSeo(): void {
  if (typeof window === 'undefined') return;

  /** 延后一拍执行：让 uni 先把页面栈与 location 更新完，再读当前路由。 */
  const schedule = (): void => {
    window.setTimeout(applyCurrentRouteSeo, 32);
  };

  // 站内跳转：覆盖 uni 的全部导航 API；拦截器不可用时静默忽略，不影响页面功能。
  const navApis = ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab', 'navigateBack'] as const;
  for (const api of navApis) {
    try {
      uni.addInterceptor(api, { complete: schedule });
    } catch {
      // 个别端不支持拦截器：交给 popstate 与首次执行兜底
    }
  }

  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);

  // 首次进入：等 uni 完成首屏挂载后再写，避免被页面自己的 onLoad 覆盖。
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}
