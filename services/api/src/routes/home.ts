import type { FastifyInstance } from 'fastify';

/**
 * 首页运营路由（公开读，不要求登录）。
 *
 * 路径对齐前端约定的 `home/ggs`（广告位）与 `home/rcs`（推荐分类）。
 * 说明：源站 b2b-svr 没有这两个接口（见 tools/egluosi-importer/source/api-notes.md），
 * 这里由本服务提供同形取数：广告位走 MallService 的内置运营位，推荐分类复用
 * `/mall/categories` 的真实商品计数口径。前端只消费 DTO，不关心内容来源，
 * 后续接 CMS 时替换 service 实现即可，路由与契约都不变。
 */
export async function homeRoutes(app: FastifyInstance): Promise<void> {
  // 首页广告位：服务端已按 sortNo 排好序；无图时 image 为空串，由前端用纯色块兜底。
  app.get('/home/ggs', async () => ({ data: await app.mall.listHomeAds() }));

  // 首页推荐分类：?limit 可选，默认 6、上限 12（首页只留一屏入口，不需要无限多）。
  app.get('/home/rcs', async (request) => {
    const query = request.query as { limit?: string } | undefined;
    const raw = Number(query?.limit);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(12, Math.floor(raw)) : 6;
    return { data: await app.mall.listRecommendedCategories(limit) };
  });
}
