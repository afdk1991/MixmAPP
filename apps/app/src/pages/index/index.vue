<template>
  <view class="halo">
    <view class="page page--wide home" :class="{ 'home--search': searchActive }">
      <!-- 桌面端顶部导航（移动端不渲染，仍走底部 tabBar） -->
      <mx-bar desktop-only hide-back />

      <!-- 壳层下拉刷新：顶部下拉越过阈值松手后，复用下方同一套加载逻辑 -->
      <mx-pull-refresh :refreshing="shellRefreshing" :scroll-top="pageScrollTop" @refresh="onShellRefresh">
      <!-- 48px App 头部行：左侧品牌标（logo 自带字标，不再重复写标题）+ 右侧购物车图标位；
           不放版本徽标，也不暴露 6 ENDS / AUTO / OFFLINE 这类内部运行指标 -->
      <view class="home-head">
        <view class="mx-safe-top" />
        <view class="home-head__inner">
          <view class="home-head__brand" hover-class="is-press" @tap="goHome">
            <mx-logo size="sm" />
          </view>
          <view class="home-head__actions">
            <view class="home-head__action" hover-class="is-press" @tap="go(ROUTES.cart)" aria-label="购物车">
              <image class="home-head__icon" src="/static/tab/cart.png" mode="aspectFit" />
              <!-- 角标：全局购物车件数；0 不渲染，≥100 显 99+ -->
              <view v-if="cartBadgeText" class="home-head__badge">
                <text class="home-head__badge-num mono">{{ cartBadgeText }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="body">
        <!-- ============================================================
             搜索：首屏主控件。行为完全沿用原实现（输入即检 + 320ms 防抖 + 五态），
             只改位置与权重，不重写数据层。
             ============================================================ -->
        <view class="search search--home">
          <view class="search-mark">
            <view class="search-lens" />
            <view class="search-handle" />
          </view>
          <input
            :value="searchKeyword"
            class="search-input"
            placeholder="搜名称、规格或项目号"
            placeholder-class="field-ph"
            confirm-type="search"
            @input="onSearchInput"
            @confirm="submitSearch"
          />
          <view v-if="searchKeyword" class="search-clear" hover-class="is-press" @tap="clearSearch">
            <text class="search-clear-x mono">×</text>
          </view>
          <view class="search-go" hover-class="is-press" @tap="submitSearch">
            <text class="search-go-text">搜索</text>
          </view>
        </view>

        <!-- 搜索提示用日常说法，不写「空格分词 / AND」这类实现口径 -->
        <view v-if="!searchActive" class="search-hint">
          <text class="search-hint-i mono">多个词用空格分开，顺序不限</text>
          <text class="search-hint-i mono">项目号记得不全，输前 6 位也能找</text>
          <text class="search-hint-i mono">规格可省螺纹距：M6x8 也能搜到</text>
          <text class="search-hint-i mono">大小写、全角半角都不影响</text>
        </view>
        <view v-if="searchNotice" class="search-notice">
          <text class="search-notice-text">{{ searchNotice }}</text>
        </view>

        <!-- 4 宫格快捷入口：商城 / 购物车 / 订单 / 通行证 -->
        <view v-if="!searchActive" class="quick">
          <view class="quick-grid">
            <view
              v-for="q in quickEntries"
              :key="q.key"
              class="quick-cell"
              hover-class="is-press"
              @tap="go(q.url)"
            >
              <view class="quick-icon">
                <mx-icon :name="q.icon" :size="40" :tone="q.key === 'mall' ? 'brand' : 'ink2'" />
              </view>
              <text class="quick-label">{{ q.label }}</text>
            </view>
          </view>
        </view>

        <!-- 压缩版通行证卡（≤120px）：登录态 + 编号 + 一句动作 -->
        <view v-if="!searchActive" class="passcard" hover-class="is-press" @tap="go(primaryUrl)">
          <view class="passcard__main">
            <view class="passcard__state">
              <text class="passcard__tag mono">{{ signedIn ? '已登录' : '未登录' }}</text>
              <text v-if="signedIn && passNo" class="passcard__no mono">{{ passNo }}</text>
            </view>
            <text class="passcard__title">{{ passcardTitle }}</text>
            <text class="passcard__sub">{{ signedIn ? '编号、绑定方式与账号资料' : '30 秒完成，手机电脑通用' }}</text>
          </view>
          <text class="passcard__arrow mono">→</text>
        </view>

        <!-- ============================================================
             运营位（home/ggs）
             放在搜索之后：先让用户完成找货，再看运营内容；
             搜索态整块隐藏，避免广告与结果抢同一屏。
             内容与顺序完全由服务端下发，取不到就整块不渲染，不留空壳。
             ============================================================ -->
        <view v-if="ads.length && !searchActive" class="spotlight">
          <view class="spot-head">
            <text class="spot-kicker mono">推荐看看</text>
            <text class="spot-note mono">{{ ads.length }} 条</text>
          </view>
          <view class="spot-grid">
            <view
              v-for="(ad, index) in ads"
              :key="ad.id"
              class="spot-card"
              hover-class="is-press"
              @tap="openAd(ad)"
            >
              <image v-if="ad.image" class="spot-img" :src="ad.image" mode="aspectFill" lazy-load />
              <view class="spot-body">
                <view class="spot-top">
                  <text class="spot-badge mono">{{ ad.badge }}</text>
                  <text class="spot-no mono">{{ String(index + 1).padStart(2, '0') }}</text>
                </view>
                <text class="spot-title">{{ ad.title }}</text>
                <view class="spot-foot">
                  <text class="spot-sub">{{ ad.subtitle }}</text>
                  <text v-if="ad.target !== 'none'" class="spot-arrow mono">→</text>
                </view>
              </view>
            </view>
          </view>
        </view>

        <!-- ============================================================
             推荐分类（home/rcs）
             按真实商品数排序，作为「不知道搜什么」时的热门入口；
             点选即退出搜索、直接预览该类目，所以放在货架正上方。
             ============================================================ -->
        <view v-if="recommended.length && !searchActive" class="hot">
          <view class="hot-head">
            <text class="hot-kicker mono">大家常逛</text>
            <text class="hot-note">件数多的在前，点一下直接看</text>
          </view>
          <view class="hot-list">
            <view
              v-for="item in recommended"
              :key="item.code"
              class="hot-chip"
              :class="{ 'hot-chip--on': activeCategory === catId(item.code) }"
              hover-class="is-press"
              @tap="selectCategory(item.code)"
            >
              <view class="hot-dot" :style="{ background: item.cover }" />
              <text class="hot-name">{{ item.name }}</text>
              <text class="hot-count mono">{{ item.count }} 件</text>
            </view>
          </view>
        </view>

        <!-- ============================================================
             01 货架：一级分类 + 目录结果
             分类从「7 张大卡」收成「货架标签」，视觉上与商品网格同属一层；
             移动端 3 列铺满、桌面 7 列一行，避免横向滚动与页面溢出。
             搜索态隐藏分类，只保留关键词回执与结果，层级不再被分类打断。
             ============================================================ -->
        <view class="section shelf">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">01</text>
                <text class="sec-cap mono">{{ searchActive ? '搜索结果' : '商品列表' }}</text>
              </view>
              <text class="sec-title">{{ searchActive ? '搜索结果' : '按类找货' }}</text>
            </view>
            <text class="sec-count mono">{{ shelfMeta }}</text>
          </view>
          <view class="rule" />

          <!-- 搜索态回执：让用户随时确认「现在看到的是哪个关键词」，并可一键退回浏览态 -->
          <view v-if="searchActive" class="search-scope">
            <text class="search-scope-k mono">关键词</text>
            <text class="search-scope-v">「{{ searchKeyword.trim() }}」</text>
            <view class="search-scope-clear" hover-class="is-press" @tap="clearSearch">
              <text class="search-scope-clear-text mono">清空搜索 ×</text>
            </view>
          </view>

          <!-- 一级 6 类：code 直接取商城「商品分类」抽屉第一层节点 id，不另建一套分类 -->
          <template v-if="!searchActive">
            <view class="cat-head">
              <text class="cat-head-label mono">一级分类</text>
              <text class="cat-head-note">点一下先在首页看这一类，进商城还能继续细分</text>
            </view>
            <view v-if="tabCategories.length" class="cat-grid">
              <view
                class="cat-card"
                :class="{ 'cat-card--active': !activeCategory }"
                hover-class="is-press"
                @tap="selectCategory('')"
              >
                <text class="cat-no mono">00</text>
                <text class="cat-name">全部商品</text>
                <text class="cat-count mono">{{ totalCountText }} 件</text>
              </view>
              <view
                v-for="(cat, index) in tabCategories"
                :key="cat.code"
                class="cat-card"
                :class="{ 'cat-card--active': activeCategory === cat.code }"
                hover-class="is-press"
                @tap="selectCategory(cat.code)"
              >
                <text class="cat-no mono">{{ String(index + 1).padStart(2, '0') }}</text>
                <text class="cat-name">{{ cat.name }}</text>
                <text class="cat-count mono">{{ cat.count }} 件</text>
              </view>
            </view>
            <view v-else class="cat-empty">
              <text class="cat-empty-text">分类没加载出来，可以直接进商城逛。</text>
              <view class="cat-empty-link" hover-class="is-press" @tap="go(ROUTES.mall)">
                <text class="cat-empty-link-text mono">去商城 →</text>
              </view>
            </view>
          </template>

          <!-- 目录区：精选 / 分类预览 / 搜索结果共用同一套商品卡与四态 -->
          <view class="catalog">
            <!-- 搜索态下 sec-head 已给出「搜索结果 / 找到 N 件」且上方有关键词回执，
                 这里不再重复一行抬头，避免同一屏出现两遍标题与计数 -->
            <view v-if="!searchActive" class="catalog-head">
              <text class="catalog-title">{{ catalogTitle }}</text>
              <text class="catalog-meta mono">{{ catalogMeta }}</text>
            </view>

            <view v-if="mallLoading" class="pick-grid">
              <view v-for="i in PAGE_SIZE" :key="i" class="pick-card">
                <view class="sk pick-sk-cover" />
                <view class="pick-info">
                  <view class="sk pick-sk-line" />
                  <view class="sk pick-sk-line pick-sk-line--short" />
                  <view class="sk pick-sk-price" />
                </view>
              </view>
            </view>

            <view v-else-if="mallError" class="pick-state">
              <view class="pick-state-mark mono">!</view>
              <text class="pick-state-title">商品没加载出来</text>
              <text class="pick-state-sub">网络或服务可能不太稳定，点下面重试一次。</text>
              <view class="pick-retry" hover-class="is-press" @tap="loadMall">
                <text class="pick-retry-text mono">重新加载</text>
              </view>
            </view>

            <!-- 无结果：给出三条可执行改法，并把条件带进商城继续筛 -->
            <view v-else-if="products.length === 0 && searchActive" class="pick-state">
              <view class="pick-state-mark">空</view>
              <text class="pick-state-title">没找到「{{ searchKeyword.trim() }}」</text>
              <text class="pick-state-sub">可以试试这样改：</text>
              <view class="search-tips">
                <view class="search-tip">
                  <text class="search-tip-k mono">01</text>
                  <text class="search-tip-v">规格不用写全，M6x8 也能搜到 M6-1.0x8</text>
                </view>
                <view class="search-tip">
                  <text class="search-tip-k mono">02</text>
                  <text class="search-tip-v">项目号记不全，就输前 6 位</text>
                </view>
                <view class="search-tip">
                  <text class="search-tip-k mono">03</text>
                  <text class="search-tip-v">多个条件用空格隔开，比如「内六角 12.9」</text>
                </view>
              </view>
              <view class="search-actions">
                <view class="pick-retry" hover-class="is-press" @tap="openSearchInMall">
                  <text class="pick-retry-text mono">去商城继续筛</text>
                </view>
                <view class="pick-retry pick-retry--ghost" hover-class="is-press" @tap="clearSearch">
                  <text class="pick-retry-text mono">换个词再搜</text>
                </view>
              </view>
            </view>

            <view v-else-if="products.length === 0" class="pick-state">
              <view class="pick-state-mark">空</view>
              <text class="pick-state-title">这一类暂时没有商品</text>
              <text class="pick-state-sub">换个类目看看，或进商城浏览全部商品。</text>
            </view>

            <view v-else class="pick-grid">
              <view
                v-for="(product, index) in products"
                :key="product.id"
                class="pick-card"
                hover-class="is-press"
                @tap="openDetail(product)"
              >
                <!-- 有图走真实封面；无图不留空框，改成「类目 + 首字」的文字封面 -->
                <view class="pick-cover" :class="{ 'pick-cover--text': !coverOf(product) || isBroken(product.id) }">
                  <image
                    v-if="coverOf(product) && !isBroken(product.id)"
                    class="pick-cover-img"
                    :src="coverOf(product)"
                    mode="aspectFill"
                    lazy-load
                    @error="markBroken(product.id)"
                  />
                  <view v-else class="pick-cover-ph" :style="tintOf(product)">
                    <text class="pick-cover-cat" :class="{ 'pick-cover-cat--on-tint': !!coverTint(product) }">
                      {{ cardMeta(product).split(' / ')[0] || '五金件' }}
                    </text>
                    <view class="pick-cover-mark">
                      <mx-icon
                        name="box"
                        :size="44"
                        tone="ink2"
                        :on-tint="coverTint(product)"
                      />
                    </view>
                  </view>
                  <!-- 序号让「精选 6 件」有可数的节奏，也替商品网格建立统一的阅读起点 -->
                  <text class="pick-no mono">{{ String(index + 1).padStart(2, '0') }}</text>
                  <text v-if="product.brand" class="pick-cover-tag mono">{{ product.brand }}</text>
                  <view
                    v-if="isInquiryProduct(product)"
                    class="pick-add pick-add--inquiry"
                    hover-class="is-press"
                    @tap.stop="addToCart(product)"
                  >
                    <text class="pick-add-text mono">询</text>
                  </view>
                  <view
                    v-else-if="!isOutOfStock(product)"
                    class="pick-add"
                    hover-class="is-press"
                    @tap.stop="addToCart(product)"
                  >
                    <text class="pick-add-text mono">+</text>
                  </view>
                </view>
                <view class="pick-info">
                  <text class="pick-name">{{ product.title }}</text>
                  <text v-if="cardMeta(product)" class="pick-sub">{{ cardMeta(product) }}</text>
                  <text v-if="cardSpec(product)" class="pick-spec mono">{{ cardSpec(product) }}</text>
                  <text v-if="packLabel(product)" class="pick-pack mono">{{ packLabel(product) }}</text>
                  <view class="pick-foot">
                    <view v-if="isInquiryProduct(product)" class="pick-price">
                      <text class="pick-inquiry">询价</text>
                      <text class="pick-inquiry-sub">联系报价</text>
                    </view>
                    <view v-else class="pick-price">
                      <text class="pick-cur mono">¥</text>
                      <text class="pick-amount mono">{{ listPriceText(product) }}</text>
                      <text v-if="priceUnitLabel(product)" class="pick-unit mono">{{ priceUnitLabel(product) }}</text>
                    </view>
                  </view>
                </view>
              </view>
            </view>

            <!-- 结果过多：不无限展开，给一条收窄建议 -->
            <view v-if="searchActive && !mallLoading && !mallError && searchTooMany" class="catalog-note">
              <text class="catalog-note-text">结果有点多，先看前 {{ PAGE_SIZE }} 件；加上规格或项目号能更快找到。</text>
            </view>

            <!-- 统一出口：搜索带 keyword、分类带 category 进商城，条件原样落到列表筛选 -->
            <view
              v-if="!(searchActive && products.length === 0)"
              class="pick-more"
              hover-class="is-press"
              @tap="openCatalog"
            >
              <text class="pick-more-text">{{ catalogCtaLabel }}</text>
              <text class="pick-more-arrow mono">→</text>
            </view>
          </view>
        </view>

        <!-- ============================================================
             02 多端覆盖
             静态事实，收成紧凑单元：已接通 / 规划中仍用绿点与虚线底区分，信息不丢。
             ============================================================ -->
        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">02</text>
                <text class="sec-cap mono">终端</text>
              </view>
              <text class="sec-title">在各端使用</text>
            </view>
            <text class="sec-count mono">共 {{ platforms.length }} 端</text>
          </view>
          <view class="rule" />
          <view class="cov-grid">
            <view
              v-for="p in platforms"
              :key="p.code"
              class="cov-cell"
              :class="{ 'cov-cell--idle': p.status !== 'ready' }"
            >
              <view class="cov-cell-head">
                <text class="cov-code mono">{{ p.short }}</text>
                <view class="index-state" :class="{ 'index-state--idle': p.status !== 'ready' }">
                  <view class="index-dot" />
                  <text class="index-state-text mono">{{ p.status === 'ready' ? '可以用' : '开发中' }}</text>
                </view>
              </view>
              <text class="cov-name">{{ p.name }}</text>
              <text class="cov-slug mono">{{ p.status === 'ready' ? '现在就能用' : '即将开放' }}</text>
            </view>
          </view>
          <text class="section-note">手机浏览器和 Android 已可用；iOS、鸿蒙、微信小程序与 App 版还在做，账号和权限在各端通用。</text>
        </view>

        <view class="footer">
          <view class="foot-rule" />
          <text class="foot-line mono">五金商品 · 手机与电脑通用</text>
          <text class="foot-line foot-line--dim mono">{{ releaseLabel }}</text>
        </view>
      </view>
      </mx-pull-refresh>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onPageScroll, onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { metaApi, mallApi, homeApi, productCover, coverTint, ApiError, applyMetaFlags, applyMetaThirdParty } from '../../api/client';
import { session } from '../../stores/session';
import { cartBadgeText, refreshCartBadge, syncCartBadge } from '../../stores/cart-badge';
import { APP_VERSION } from '../../version';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import MxLogo from '../../components/mx-logo/mx-logo.vue';
import MxIcon from '../../components/mx-icon/mx-icon.vue';
import MxBar from '../../components/mx-bar/mx-bar.vue';
import MxPullRefresh from '../../components/mx-pull-refresh/mx-pull-refresh.vue';
import type { MallCategoryDto, MallProductDto } from '../../api/mall';
import { PAGE_SIZE_OPTIONS } from '@mixmapp/contracts';
import type { HomeAdDto, HomeAdTarget, HomeRecommendedCategoryDto } from '@mixmapp/contracts';
import {
  breadcrumbLabel,
  INQUIRY_NOTICE,
  isInquiryProduct,
  isOutOfStock,
  listPriceText,
  OUT_OF_STOCK_NOTICE,
  packLabel,
  priceUnitLabel,
  specEntries,
} from '../../api/mall';

/**
 * 版本文案由构建期 APP_VERSION 驱动，不写死版本号。
 * 初始版本 0.0.0 属于仓库占位值，展开口反而像未完成品，这里只保留「正式发布」。
 */
const isBaselineVersion = (v: string) => v === '0.0.0';
const releaseLabel = computed(() =>
  APP_VERSION && !isBaselineVersion(APP_VERSION) ? `版本 ${APP_VERSION} · 正式发布` : '正式发布',
);

const online = ref(false);
const error = ref('');

/**
 * 端状态是首页静态事实，不是接口数据：只有 H5 与 Android 有可运行产物，
 * 其余四端仍在规划中，必须与已接通端在视觉上区分，不能一律给绿点。
 */
const platforms = [
  { code: 'WEB', short: 'WEB', name: '手机网页', status: 'ready' },
  { code: 'ANDROID', short: 'AND', name: '安卓 App', status: 'ready' },
  { code: 'IOS', short: 'IOS', name: 'iPhone / iPad', status: 'planned' },
  { code: 'HARMONY', short: 'HM', name: '鸿蒙', status: 'planned' },
  { code: 'WECHAT', short: 'WX', name: '微信小程序', status: 'planned' },
  { code: 'APP-PLUS', short: 'APP', name: 'App 版', status: 'planned' },
];

const signedIn = computed(() => Boolean(session.user));
const primaryUrl = computed(() => ROUTES.me);

/** 压缩通行证卡：编号与持证人昵称，未登录时给登录动作。 */
const passNo = computed(() => session.user?.accountNo ?? '');
const passcardTitle = computed(() => (signedIn.value ? session.user?.nickname || '我的通行证' : '登录或注册'));

/** 首屏 4 宫格快捷入口：商城 / 购物车 / 订单 / 通行证，全部走 ROUTES 常量。
 *  图标统一走自有线性图标组件，不再混用 tab 位图与首字兜底。 */
type QuickIconName = 'bag' | 'cart' | 'receipt' | 'user';
const quickEntries: { key: string; label: string; url: string; icon: QuickIconName }[] = [
  { key: 'mall', label: '商城', url: ROUTES.mall, icon: 'bag' },
  { key: 'cart', label: '购物车', url: ROUTES.cart, icon: 'cart' },
  { key: 'orders', label: '订单', url: ROUTES.orders, icon: 'receipt' },
  { key: 'me', label: '通行证', url: ROUTES.me, icon: 'user' },
];

/** 购物车角标文案来自全局计数模块 stores/cart-badge（0 隐藏 / 1–99 数字 / 99+）。 */

/* ---------- 目录与检索：真实商城数据（mallApi 契约，不加 mock） ---------- */
/** 首页精选只展示 6 条（前端截断的展示口径）。 */
const PAGE_SIZE = 6;
/**
 * 请求口径必须落在契约白名单（20/50/100）内：此前传 PAGE_SIZE + 1 = 7 会被 422，
 * 首页精选区直接落到错误态。这里取白名单最小档，取回后再截断到 PAGE_SIZE。
 */
const REQUEST_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

const categories = ref<MallCategoryDto[]>([]);
const activeCategory = ref('');
const products = ref<MallProductDto[]>([]);
const mallLoading = ref(false);
const mallError = ref('');

/* ---------- 首页运营位：广告位（home/ggs）与推荐分类（home/rcs） ----------
 * 两块内容都由服务端下发：广告位是服务端内置运营位（源站没有该接口），推荐分类复用
 * `/mall/categories` 的真实计数口径。任一块取不到就整块不渲染，不影响搜索与目录主流程。
 */
const ads = ref<HomeAdDto[]>([]);
const recommended = ref<HomeRecommendedCategoryDto[]>([]);
/** 一次多取 1 条判断后端是否还有，用于「结果过多」引导而不是无限展开。 */
const hasMore = ref(false);
/** 图片 404 兜底：记录加载失败的 productId，命中后改用文字占位，避免破图。 */
const brokenImages = reactive(new Set<string>());

/**
 * 分类完全由后端分类树驱动：优先取一级节点（6 个真实类目），与商城页同一口径。
 * 本地/部分数据源不提供分类树时，退回扁平类目聚合并补 c1: 前缀，
 * 保证「首页预览」与「进商城继续细分」都能用同一批节点 id。
 */
const tabCategories = computed(() =>
  categories.value
    .filter((item) => item && item.code && item.name)
    .map((item) => ({ code: item.code, name: item.name, count: item.count ?? 0 })),
);

const totalCount = computed(() => tabCategories.value.reduce((sum, item) => sum + (item.count || 0), 0));
const totalCountText = computed(() => (totalCount.value > 0 ? totalCount.value.toLocaleString('en-US') : '—'));

/**
 * 目录出口文案：带上一级分类合计件数，说明首页只展示了精选，完整目录规模多大。
 * 合计为 0（分类还没加载 / 接口失败）时回落到不带数字的文案，避免出现「查看全部 0 件」。
 */
const catalogAllLabel = computed(() =>
  totalCount.value > 0 ? `去商城看全部 ${totalCountText.value} 件商品` : '去商城浏览全部商品',
);

/* ---------- 搜索：输入即检（320ms 防抖），提交/点按立即检索 ----------
 * 检索口径不在前端造：多词空格 AND 且顺序无关、项目号 12 位全码与 6 位段码、
 * 规格等价（M6-1.0x8 ≡ M6x8 ≡ 6x8 ≡ M6×8）、大小写与全半角归一，全部由
 * `/mall/products?keyword=` 在服务端实现；首页只把原始输入原样送出并呈现结果。
 */
const searchKeyword = ref('');
const searchNotice = ref('');
const searchActive = computed(() => searchKeyword.value.trim().length > 0);
const searchTooMany = computed(() => searchActive.value && hasMore.value);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** 请求序号：连续输入时丢弃过期响应，避免旧结果盖掉新结果。 */
let searchSeq = 0;

const activeCategoryName = computed(
  () => tabCategories.value.find((item) => item.code === activeCategory.value)?.name ?? '',
);

/** 目录区标题：搜索 > 分类预览 > 精选，三者共用一个网格，不另起一套版式。 */
const catalogTitle = computed(() => {
  if (searchActive.value) return '搜索结果';
  return activeCategoryName.value ? `${activeCategoryName.value} · 推荐` : '首页精选';
});

const catalogMeta = computed(() => {
  if (mallLoading.value) return searchActive.value ? '正在搜索…' : '正在加载…';
  if (mallError.value) return '没加载出来';
  if (searchActive.value) {
    return hasMore.value ? `先看前 ${PAGE_SIZE} 件` : `找到 ${products.value.length} 件`;
  }
  return `推荐 ${products.value.length} 件`;
});

/** 标题右侧的一行小字：浏览态给类目数，搜索态给结果条数；请求失败时不能显示「找到 0 件」。 */
const shelfMeta = computed(() => {
  if (mallError.value) return '没加载出来';
  if (searchActive.value) return mallLoading.value ? '正在搜索…' : `找到 ${products.value.length} 件`;
  return `共 ${tabCategories.value.length} 类`;
});

/** 统一出口：搜索带 keyword，分类带 category（一级节点 id），其余进全量目录。 */
const catalogCtaLabel = computed(() => {
  if (searchActive.value) return '去商城看全部搜索结果';
  if (activeCategoryName.value) return `去商城看「${activeCategoryName.value}」`;
  return catalogAllLabel.value;
});

/** 商品接口的 ?cat= 只认一级节点 id（c1:xxx）；推荐位下发的短码在这里统一补齐。 */
function catId(code: string): string {
  return code.startsWith('c1:') ? code : `c1:${code}`;
}

async function loadCategories(): Promise<void> {
  try {
    // 优先取分类树的一级节点：node.id 形如 c1:002，正是商品接口 ?cat= 需要的口径。
    const tree = await mallApi.listCategoryChildren();
    const rows = Array.isArray(tree) ? tree.filter((node) => node && node.id && node.name) : [];
    if (rows.length) {
      categories.value = rows.map((node) => ({ code: node.id, name: node.name, count: node.count ?? 0 }));
      return;
    }
    // 兜底：部分数据源没有分类树，退回扁平类目聚合（计数口径一致），
    // 并按一级节点规则补上 c1: 前缀，保证后续预览筛选仍然可用。
    const flat = await mallApi.listCategories();
    categories.value = (Array.isArray(flat) ? flat : [])
      .filter((node) => node && node.code && node.name)
      .map((node) => ({ code: catId(node.code), name: node.name, count: node.count ?? 0 }));
  } catch {
    categories.value = [];
  }
}

async function loadProducts(): Promise<void> {
  const keyword = searchKeyword.value.trim();
  const seq = ++searchSeq;
  mallLoading.value = true;
  mallError.value = '';
  try {
    const list = await mallApi.listProducts({
      keyword: keyword || undefined,
      cat: keyword ? undefined : activeCategory.value || undefined,
      page: 1,
      pageSize: REQUEST_PAGE_SIZE,
    });
    if (seq !== searchSeq) return;
    const items = Array.isArray(list) ? list : [];
    hasMore.value = items.length > PAGE_SIZE;
    products.value = items.slice(0, PAGE_SIZE);
  } catch (e) {
    if (seq !== searchSeq) return;
    mallError.value = e instanceof Error ? e.message : '商品加载失败';
    products.value = [];
    hasMore.value = false;
  } finally {
    if (seq === searchSeq) mallLoading.value = false;
  }
}

/**
 * 目录请求（分类 + 商品）整体收口。
 * 顺带纠正连接徽标：目录请求成功说明服务可达，此时若首屏 meta 正好撞上服务重启失败，
 * 补拉一次 meta，避免出现「搜索有结果但徽标显示连不上」的自相矛盾状态。
 */
async function loadMall(): Promise<void> {
  await Promise.allSettled([loadCategories(), loadProducts()]);
  if (!metaLoading && !online.value && !mallError.value) void loadMeta();
}

/**
 * 首页运营位：两个接口互不依赖，也都不影响主流程，用 allSettled 各自兜底。
 * 失败时置空数组即可 —— 模板里 v-if 会整块隐藏，不显示空壳也不挤占版面。
 */
async function loadHome(): Promise<void> {
  const [adsResult, recResult] = await Promise.allSettled([
    homeApi.getAds(),
    homeApi.getRecommendedCategories(),
  ]);
  ads.value = adsResult.status === 'fulfilled' && Array.isArray(adsResult.value) ? adsResult.value : [];
  recommended.value =
    recResult.status === 'fulfilled' && Array.isArray(recResult.value) ? recResult.value : [];
}

/** 服务端只下发语义目标，页面路径统一由本表映射，避免后端复制一份路由表 */
const AD_TARGET_ROUTES: Record<HomeAdTarget, string> = {
  mall: ROUTES.mall,
  me: ROUTES.me,
  none: '',
};

/** 广告位点击：none 表示纯展示位不跳转；站内路径统一交给 go 处理 tabBar 差异。 */
function openAd(ad: HomeAdDto): void {
  const url = AD_TARGET_ROUTES[ad.target];
  if (!url) return;
  go(url);
}

function clearSearchTimer(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = null;
}

function inputValue(e: unknown): string {
  const event = e as { detail?: { value?: string }; target?: { value?: string } };
  return event?.detail?.value ?? event?.target?.value ?? '';
}

/** 输入中：立刻切骨架态，防抖结束后再发请求，避免旧结果看起来像新结果。 */
function onSearchInput(e: unknown): void {
  searchKeyword.value = inputValue(e);
  searchNotice.value = '';
  clearSearchTimer();
  if (!searchActive.value) {
    void loadProducts();
    return;
  }
  mallLoading.value = true;
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void loadProducts();
  }, 320);
}

function submitSearch(): void {
  clearSearchTimer();
  if (!searchActive.value) {
    searchNotice.value = '先输入要搜的内容：名称、规格或项目号';
    return;
  }
  void loadProducts();
}

function clearSearch(): void {
  clearSearchTimer();
  searchKeyword.value = '';
  searchNotice.value = '';
  void loadProducts();
}

/** 分类预览会退出搜索态，保证「看到的商品 = 当前选中的类目」。 */
function selectCategory(code: string): void {
  clearSearchTimer();
  searchKeyword.value = '';
  searchNotice.value = '';
  activeCategory.value = catId(code);
  void loadProducts();
}

function openCatalog(): void {
  const keyword = searchKeyword.value.trim();
  if (keyword) {
    go(`${ROUTES.mall}?keyword=${encodeURIComponent(keyword)}`);
    return;
  }
  if (activeCategory.value) {
    go(`${ROUTES.mall}?category=${encodeURIComponent(activeCategory.value)}`);
    return;
  }
  go(ROUTES.mall);
}

function openSearchInMall(): void {
  const keyword = searchKeyword.value.trim();
  go(keyword ? `${ROUTES.mall}?keyword=${encodeURIComponent(keyword)}` : ROUTES.mall);
}

function coverOf(product: MallProductDto): string {
  return productCover(product);
}

/** 无图自有商品（cover 存的是色值）的占位底色。 */
function tintOf(product: MallProductDto): Record<string, string> {
  const tint = coverTint(product);
  return tint ? { background: tint } : {};
}

function isBroken(id: string): boolean {
  return brokenImages.has(id);
}

function markBroken(id: string): void {
  brokenImages.add(id);
}

/** 卡片副行：优先分类面包屑，退回 subtitle。 */
function cardMeta(product: MallProductDto): string {
  return breadcrumbLabel(product.categoryPath) || product.subtitle || '';
}

/** 规格摘要：取前两条有效规格，拼成一行短文案。 */
function cardSpec(product: MallProductDto): string {
  return specEntries(product.specs)
    .slice(0, 2)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ');
}

function openDetail(product: MallProductDto): void {
  goTo(`${ROUTES.mallDetail}?id=${encodeURIComponent(product.id)}`);
}

async function addToCart(product: MallProductDto): Promise<void> {
  if (isInquiryProduct(product)) {
    uni.showToast({ title: INQUIRY_NOTICE, icon: 'none' });
    return;
  }
  if (isOutOfStock(product)) {
    uni.showToast({ title: OUT_OF_STOCK_NOTICE, icon: 'none' });
    return;
  }
  try {
    const cart = await mallApi.addToCart(product.id, 1);
    syncCartBadge(cart);
    uni.showToast({ title: '已加入购物车', icon: 'success' });
  } catch (e) {
    const message = e instanceof Error ? e.message : '加入购物车失败';
    if (message.includes('登录')) {
      goTo(ROUTES.login);
      return;
    }
    uni.showToast({ title: message, icon: 'none' });
  }
}

function go(url: string): void {
  goTo(url);
}

/** 头部品牌标回首页 Tab：switchTab 保留 Tab 上下文，不 reLaunch 清栈。 */
function goHome(): void {
  uni.switchTab({ url: ROUTES.home });
}

/** meta 请求在途标记：避免首屏与目录补拉同时打同一个接口 */
let metaLoading = false;

async function loadMeta(): Promise<void> {
  if (metaLoading) return;
  metaLoading = true;
  error.value = '';
  try {
    const meta = await metaApi.get();
    applyMetaFlags(meta);
    applyMetaThirdParty(meta);
    online.value = true;
  } catch (e) {
    online.value = false;
    // 错误信息只用于让「重试」块出现，界面上给的是固定用户语言，不暴露接口细节
    error.value = e instanceof ApiError ? `连不上服务（${e.status}）` : '连不上服务';
  } finally {
    metaLoading = false;
  }
}

onLoad(() => {
  void loadMeta();
  void loadMall();
  void loadHome();
  void refreshCartBadge();
});

/** 每次回到首页（含从购物车 / 我的页返回）重新对齐一次全局角标。 */
onShow(() => {
  void refreshCartBadge();
});

/** 原生下拉刷新：同时刷新运行环境与精选目录，两者都落定后收起指示器 */
onPullDownRefresh(() => {
  console.info('[mixmapp] onPullDownRefresh 已触发（uni 原生钩子）');
  void Promise.allSettled([loadMeta(), loadMall(), loadHome()]).then(() => uni.stopPullDownRefresh());
});

/** 页面滚动距离：交给壳层下拉刷新判断是否在顶部（跨端不取 document） */
const pageScrollTop = ref(0);
onPageScroll(({ scrollTop }) => {
  pageScrollTop.value = scrollTop;
});

/** 壳层下拉刷新状态：组件回调后真实重跑同一套加载，全部落定后复位收起指示环 */
const shellRefreshing = ref(false);

function onShellRefresh(): void {
  if (shellRefreshing.value) return;
  console.info('[mixmapp] onPullDownRefresh 已触发（壳层手势）');
  shellRefreshing.value = true;
  void Promise.allSettled([loadMeta(), loadMall(), loadHome()]).finally(() => {
    shellRefreshing.value = false;
  });
}
</script>

<style scoped lang="scss">
/* ==========================================================================
   首页 · App 目录台
   层级：头部行 → 搜索 → 快捷入口 → 通行证卡 → 运营位 → 热门分类 → 货架 → 覆盖端。
   视觉原则沿用「星际联邦」令牌：暖白纸 + 品牌青 + 墨黑文字，等宽小标签 + 发丝线；
   所有颜色/字阶/间距只取 uni.scss，不新增裸色值，深色模式自动跟随。
   ========================================================================== */

.halo {
  min-height: 100vh;
  background: $paper;
}

.home {
  /* 单一内边距变量：窄屏再收一档时只改这里，避免子块各自写死 */
  --home-pad: #{$sp-3};
  padding-bottom: calc(120rpx + var(--mx-safe-bottom, 0px));
}

@media (max-width: 360px) {
  .home {
    --home-pad: 20rpx;
  }
}

/* ---------- 48px App 头部行 ---------- */
.home-head {
  background: $paper;
  border-bottom: 1rpx solid $paper-3;
}

.home-head__inner {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
  padding: 0 $sp-3;
  box-sizing: border-box;
}

.home-head__brand {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.home-head__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

/* 顶部动作位：44×44 图标位，不带描边底，不做次级按钮 */
.home-head__action {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
}

.home-head__icon {
  width: 26px;
  height: 26px;
}

.home-head__badge {
  position: absolute;
  top: 4px;
  right: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 8rpx;
  background: $brand;
  border-radius: $r-pill;
}

.home-head__badge-num {
  font-size: 16rpx;
  line-height: 1;
  color: $on-solid;
}

/* ---------- 搜索：首屏主控件，纸面白壳 + 发丝描边 ---------- */
.body {
  padding: $sp-3 var(--home-pad) 0;
}

.search {
  display: flex;
  align-items: center;
  gap: $sp-2;
  box-sizing: border-box;
  min-height: 96rpx;
  padding: 10rpx 12rpx 10rpx 28rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.search--home {
  border-color: $brand;
}

.search-mark {
  position: relative;
  flex: 0 0 auto;
  width: 34rpx;
  height: 34rpx;
}

.search-lens {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  width: 22rpx;
  height: 22rpx;
  border: 3rpx solid $ink-4;
  border-radius: 50%;
}

.search-handle {
  position: absolute;
  right: 2rpx;
  bottom: 3rpx;
  width: 12rpx;
  height: 3rpx;
  border-radius: 2rpx;
  background: $ink-4;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  font-size: $fs-body;
  color: $ink;
  background: transparent;
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: $paper-2;
}

.search-clear-x {
  font-size: $fs-meta;
  line-height: 1;
  color: $ink-3;
}

.search-go {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 68rpx;
  padding: 0 26rpx;
  background: $solid;
  border-radius: $r-control;
}

.search-go-text {
  font-size: $fs-meta;
  font-weight: 600;
  color: $on-solid;
}

/* 空态说明：只在未搜索时出现，作为「能怎么搜」的静态图例 */
.search-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx $sp-3;
  margin-top: $sp-2;
}

.search-hint-i {
  padding-left: 14rpx;
  border-left: 2rpx solid $paper-3;
  font-size: 22rpx;
  line-height: 1.5;
  color: $ink-4;
}

.search-notice {
  margin-top: $sp-2;
  padding: 18rpx 22rpx;
  background: $paper-2;
  border-left: 6rpx solid $amber;
  border-radius: 0 $r-control $r-control 0;
}

.search-notice-text {
  font-size: $fs-meta;
  line-height: 1.5;
  color: $ink-2;
}

/* ---------- 4 宫格快捷入口 ---------- */
.quick {
  margin-top: $sp-4;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: $sp-2;
}

/* 借鉴内容社区「服务磁贴」：白卡托底、软阴影、图标有独立底色，
 * 不再用发丝描边把四个入口切成表格。 */
.quick-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: $sp-3 8rpx $sp-2;
  background: $shell;
  border: 0;
  border-radius: 28rpx;
  box-shadow: $shadow-card;
}

.quick-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 22rpx;
  background: $paper-2;
}

/* 第一个入口（商城）用品牌浅底把主路径单独点亮 */
.quick-cell:nth-child(1) .quick-icon {
  background: $brand-soft;
}

.quick-label {
  font-size: $fs-meta;
  font-weight: 600;
  line-height: 1.2;
  color: $ink;
  white-space: nowrap;
}

/* ---------- 压缩版通行证卡（≤120px） ---------- */
/* 借鉴 SaaS 官网「深色转化卡」：整站唯一的深场 CTA，把登录/通行证
 * 从普通白卡提升为与首屏同源的强视觉块，其余卡片继续留白。 */
.passcard {
  display: flex;
  align-items: center;
  gap: $sp-3;
  margin-top: $sp-3;
  padding: $sp-4;
  background: linear-gradient(112deg, $deep 0%, $deep-3 100%);
  border: 0;
  border-radius: 32rpx;
  box-shadow: $shadow-lift;
}

.passcard__main {
  flex: 1;
  min-width: 0;
}

.passcard__state {
  display: flex;
  align-items: center;
  gap: $sp-2;
}

.passcard__tag {
  padding: 4rpx 12rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-pill;
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $brand-on-deep;
}

.passcard__no {
  font-size: 20rpx;
  color: $on-deep-3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passcard__title {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-h3;
  font-weight: 700;
  line-height: 1.25;
  color: $on-deep;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passcard__sub {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  line-height: 1.4;
  color: $on-deep-2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passcard__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 56rpx;
  height: 56rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: 50%;
  font-size: $fs-body;
  color: $on-deep;
}

/* ---------- 运营位：3 列编辑卡，移动端单列；无图也不塌 ---------- */
.spotlight {
  margin-top: $sp-4;
}

.spot-head,
.hot-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
}

.spot-kicker,
.hot-kicker {
  font-size: $fs-micro;
  font-weight: 600;
  letter-spacing: $ls-label;
  color: $brand-deep;
}

.spot-note,
.hot-note {
  font-size: 22rpx;
  color: $ink-4;
}

.spot-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: $sp-2;
  margin-top: $sp-2;
}

.spot-card {
  overflow: hidden;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.spot-img {
  display: block;
  width: 100%;
  height: 180rpx;
}

.spot-body {
  padding: $sp-3;
}

.spot-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
}

.spot-badge {
  display: inline-block;
  padding: 6rpx 14rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-pill;
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $acc-1;
}

.spot-no {
  font-size: 22rpx;
  color: $ink-4;
}

.spot-title {
  display: block;
  margin-top: $sp-2;
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.35;
  color: $acc-1;
}

.spot-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: $sp-2;
  margin-top: $sp-2;
}

.spot-sub {
  flex: 1;
  min-width: 0;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
}

.spot-arrow {
  flex: 0 0 auto;
  font-size: $fs-body;
  color: $acc-2;
}

/* ---------- 热门分类：可换行的 chip 条，不用横向滚动，窄屏也不会溢出 ---------- */
.hot {
  margin-top: $sp-4;
}

.hot-list {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
  margin-top: $sp-2;
}

.hot-chip {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  min-height: 64rpx;
  padding: 0 22rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-pill;
}

.hot-chip--on {
  background: $solid;
  border-color: $solid;
}

.hot-dot {
  flex: 0 0 auto;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
}

.hot-name {
  font-size: $fs-meta;
  font-weight: 600;
  color: $acc-1;
  white-space: nowrap;
}

.hot-count {
  font-size: 20rpx;
  color: $acc-2;
}

.hot-chip--on .hot-name,
.hot-chip--on .hot-count {
  color: $on-solid;
}

/* ---------- 区块标题：统一的「编号 + 英文 + 中文 + 右侧口径」 ---------- */
.section {
  margin-top: $sp-6;
}

.sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: $sp-3;
}

.sec-head-l {
  min-width: 0;
}

.sec-kicker {
  display: flex;
  align-items: center;
  gap: $sp-2;
}

.sec-no {
  padding: 4rpx 10rpx;
  border: 1rpx solid $paper-3;
  border-radius: 6rpx;
  font-size: 20rpx;
  letter-spacing: $ls-label;
  color: $brand-deep;
}

.sec-cap {
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $ink-4;
}

/* 区块标题与「首页精选」同级：纯色墨黑、不带渐变彩字，避免落地页营销感。
 * 全局 theme.scss 的 .sec-title 带渐变文字，这里在首页作用域内显式中和，不影响其他页面。 */
.sec-title {
  display: block;
  margin-top: $sp-1;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: $ls-tight;
  color: $ink;
  background-image: none;
  -webkit-background-clip: initial;
  background-clip: initial;
  -webkit-text-fill-color: $ink;
}

.sec-count {
  flex: 0 0 auto;
  padding-bottom: 6rpx;
  font-size: 22rpx;
  color: $acc-2;
}

.rule {
  height: 1rpx;
  margin-top: $sp-2;
  background: $paper-3;
}

/* ---------- 搜索回执：随时确认当前关键词，避免结果与输入脱节 ---------- */
.search-scope {
  display: flex;
  align-items: center;
  gap: $sp-2;
  margin-top: $sp-3;
  padding: $sp-2 $sp-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.search-scope-k {
  flex: 0 0 auto;
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $ink-4;
}

.search-scope-v {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-scope-clear {
  flex: 0 0 auto;
  padding: 6rpx 14rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-pill;
}

.search-scope-clear-text {
  font-size: 18rpx;
  color: $ink-3;
}

/* ---------- 一级分类：货架标签，3 列铺满移动端、7 列一行桌面端 ---------- */
.cat-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  margin-top: $sp-4;
}

.cat-head-label {
  font-size: $fs-micro;
  font-weight: 600;
  letter-spacing: $ls-label;
  color: $brand-deep;
}

.cat-head-note {
  max-width: 60%;
  font-size: 20rpx;
  line-height: 1.4;
  text-align: right;
  color: $ink-4;
}

.cat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-3;
}

/* 借鉴电商「类目卡」：白底、无描边、靠留白分块；选中态整块品牌色，
 * 一眼能看出当前在看哪一类，而不是只换一行字色。 */
.cat-card {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  box-sizing: border-box;
  min-height: 136rpx;
  padding: 20rpx;
  background: $shell;
  border: 0;
  border-radius: 22rpx;
  box-shadow: $shadow-card;
}

.cat-card--active {
  background: $brand-deep;
  box-shadow: none;
}

.cat-no {
  font-size: 18rpx;
  color: $ink-4;
}

.cat-name {
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.3;
  color: $ink;
  overflow-wrap: break-word;
}

.cat-count {
  margin-top: auto;
  font-size: 18rpx;
  color: $ink-4;
}

.cat-card--active .cat-no,
.cat-card--active .cat-count {
  color: $on-solid;
  opacity: 0.7;
}

.cat-card--active .cat-name {
  color: $on-solid;
}

.cat-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
  margin-top: $sp-2;
  padding: $sp-3;
  border: 1rpx dashed $paper-3;
  border-radius: $r-control;
}

.cat-empty-text {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  line-height: 1.5;
  color: $ink-3;
}

.cat-empty-link {
  flex: 0 0 auto;
  padding: 6rpx 14rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-pill;
}

.cat-empty-link-text {
  font-size: 20rpx;
  color: $brand-deep;
}

/* ---------- 目录 ---------- */
.catalog {
  margin-top: $sp-5;
}

.catalog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
}

.catalog-title {
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.catalog-meta {
  flex: 0 0 auto;
  font-size: 22rpx;
  color: $ink-4;
}

/* 商品网格：移动 2 列、桌面 3 列；卡片等高，价格始终贴底对齐 */
.pick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-2;
}

.pick-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: $shell;
  border: 0;
  border-radius: 28rpx;
  box-shadow: $shadow-card;
}

/* 借鉴得物/小红书：方图封面，商品图占满上半张卡，信息区留白收口。
 * 仍用 padding-top 撑比例，兼容旧 WebView；图片绝对定位铺满。 */
.pick-cover {
  position: relative;
  width: 100%;
  padding-top: 100%;
  background: $paper-2;
}

.pick-cover-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.pick-cover-ph {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.pick-cover-mark {
  margin-top: 6rpx;
  display: flex;
}

/* 无图封面：不再留一块空框，改成「类目 + 自有线性图标」的文字封面；
 * 高度与有图封面一致，保证同一行卡片对齐，不因缺图塌下去。 */
.pick-cover--text .pick-cover-ph {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  box-sizing: border-box;
  padding: 0 $sp-2;
}

.pick-cover-cat {
  max-width: 64%;
  margin-top: 8rpx;
  overflow: hidden;
  font-size: 18rpx;
  line-height: 1.3;
  letter-spacing: $ls-label;
  color: $ink-4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-cover-cat--on-tint {
  color: $on-deep-2;
}

.pick-no {
  position: absolute;
  left: 12rpx;
  top: 12rpx;
  padding: 4rpx 10rpx;
  background: $deep;
  border-radius: $r-xs;
  font-size: 16rpx;
  color: $on-deep;
}

.pick-cover-tag {
  position: absolute;
  right: 12rpx;
  top: 12rpx;
  max-width: 58%;
  padding: 4rpx 12rpx;
  overflow: hidden;
  background: $shell;
  border-radius: $r-pill;
  font-size: 16rpx;
  color: $acc-1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-add {
  position: absolute;
  right: 12rpx;
  bottom: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  background: $brand-deep;
  border-radius: 50%;
  box-shadow: $shadow-card;
}

.pick-add-text {
  font-size: $fs-body;
  line-height: 1;
  color: $on-solid;
}

.pick-add--inquiry {
  background: $amber;
}

.pick-add--inquiry .pick-add-text {
  font-size: $fs-micro;
  color: $deep;
}

.pick-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: $sp-2 $sp-2 $sp-3;
}

.pick-name {
  display: -webkit-box;
  overflow: hidden;
  font-size: $fs-meta;
  font-weight: 600;
  line-height: 1.4;
  color: $ink;
  overflow-wrap: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.pick-sub {
  display: -webkit-box;
  margin-top: 6rpx;
  overflow: hidden;
  font-size: 20rpx;
  line-height: 1.4;
  color: $ink-3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.pick-spec {
  margin-top: 6rpx;
  font-size: 20rpx;
  line-height: 1.4;
  color: $ink-4;
  overflow-wrap: break-word;
}

.pick-pack {
  margin-top: 4rpx;
  font-size: 18rpx;
  color: $ink-4;
}

.pick-foot {
  margin-top: auto;
  padding-top: $sp-2;
}

.pick-price {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4rpx;
}

.pick-cur {
  font-size: 20rpx;
  color: $acc-4;
}

.pick-amount {
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $acc-4;
}

.pick-unit {
  font-size: 18rpx;
  color: $ink-4;
}

.pick-inquiry {
  font-size: $fs-meta;
  font-weight: 600;
  color: $brand-deep;
}

.pick-inquiry-sub {
  margin-left: 8rpx;
  font-size: 18rpx;
  color: $ink-4;
}

/* 骨架：与真实卡同结构，加载完不跳版 */
.pick-sk-cover {
  width: 100%;
  padding-top: 100%;
}

.pick-sk-line {
  height: 24rpx;
  margin-top: 12rpx;
  border-radius: 6rpx;
}

.pick-sk-line--short {
  width: 60%;
}

.pick-sk-price {
  width: 42%;
  height: 32rpx;
  margin-top: 20rpx;
  border-radius: 6rpx;
}

/* ---------- 空 / 错 / 无结果：同一张状态卡，不另起浮层 ---------- */
.pick-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: $sp-2;
  margin-top: $sp-2;
  padding: $sp-4;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.pick-state-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border: 1rpx solid $paper-3;
  border-radius: 50%;
  font-size: $fs-meta;
  color: $ink-3;
}

.pick-state-title {
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.35;
  color: $ink;
}

.pick-state-sub {
  font-size: $fs-meta;
  line-height: 1.5;
  color: $ink-3;
}

.search-tips {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin-top: $sp-1;
}

.search-tip {
  display: flex;
  align-items: baseline;
  gap: $sp-2;
  padding: 14rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.search-tip-k {
  flex: 0 0 auto;
  font-size: 18rpx;
  color: $brand-deep;
}

.search-tip-v {
  flex: 1;
  min-width: 0;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-2;
}

.search-actions {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
  margin-top: $sp-1;
}

.pick-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16rpx 28rpx;
  background: $solid;
  border-radius: $r-control;
}

.pick-retry-text {
  font-size: $fs-meta;
  color: $on-solid;
}

.pick-retry--ghost {
  background: transparent;
  border: 1rpx solid $paper-3;
}

.pick-retry--ghost .pick-retry-text {
  color: $acc-2;
}

.catalog-note {
  margin-top: $sp-2;
  padding: $sp-2 $sp-3;
  background: $paper-2;
  border-left: 6rpx solid $brand;
  border-radius: 0 $r-control $r-control 0;
}

.catalog-note-text {
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
}

/* 统一出口：货架末尾的一条明确动作，比裸文字更像「下一步」 */
.pick-more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
  margin-top: $sp-3;
  padding: 22rpx 28rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.pick-more-text {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  font-weight: 600;
  color: $brand-deep;
}

.pick-more-arrow {
  flex: 0 0 auto;
  font-size: $fs-body;
  color: $brand-deep;
}

/* ---------- 02 多端覆盖：紧凑单元，已接通 / 规划中仍可区分 ---------- */
.cov-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-1;
  margin-top: $sp-3;
}

.cov-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 150rpx;
  padding: $sp-2;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.cov-cell--idle {
  background: transparent;
  border-style: dashed;
}

.cov-cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-1;
}

.cov-code {
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $ink-4;
}

.index-state {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.index-dot {
  flex: 0 0 auto;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: $brand;
}

.index-state--idle .index-dot {
  background: $ink-4;
}

.index-state-text {
  font-size: 16rpx;
  color: $ink-3;
}

.cov-name {
  margin-top: auto;
  font-size: $fs-meta;
  font-weight: 600;
  line-height: 1.3;
  color: $ink;
}

.cov-cell--idle .cov-name {
  color: $ink-3;
}

.cov-slug {
  margin-top: 2rpx;
  font-size: 16rpx;
  color: $ink-4;
}

.section-note {
  display: block;
  margin-top: $sp-2;
  font-size: 20rpx;
  line-height: 1.6;
  color: $ink-4;
}

/* ---------- 页脚 ---------- */
.footer {
  margin-top: $sp-6;
  padding: $sp-4 0 $sp-6;
}

.foot-rule {
  height: 1rpx;
  background: $paper-3;
}

.foot-line {
  display: block;
  margin-top: $sp-2;
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $ink-3;
}

.foot-line--dim {
  color: $ink-4;
}

/* ==========================================================================
   平板 / 桌面
   768 起：网格加密（分类 4 列、商品 3 列）；
   1000 起：版心放宽，桌面顶部一级导航由 mx-bar 提供。
   ========================================================================== */
@media (min-width: 768px) {
  .body {
    padding: 24px 32px 0;
  }

  .search--home {
    min-height: 64px;
    padding: 8px 10px 8px 18px;
  }

  .search-input {
    height: 44px;
    font-size: 15px;
  }

  .search-go {
    height: 48px;
    padding: 0 22px;
  }

  .search-go-text {
    font-size: 15px;
  }

  .spot-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }

  .spot-body {
    padding: 20px;
  }

  .spot-title {
    margin-top: 12px;
    font-size: 17px;
  }

  .cat-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .pick-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .pick-info {
    padding: 12px 14px 16px;
  }

  .pick-name {
    font-size: 15px;
  }

  .pick-amount {
    font-size: 24px;
  }

  .cov-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .sec-title,
  .catalog-title {
    font-size: 22px;
  }
}

@media (min-width: 1000px) {
  .home {
    --shell-w: 1000px;
    max-width: 1000px;
  }

  .body {
    padding: 28px 48px 0;
  }

  /* 一级分类：7 列一行，回到「一排货架」的桌面形态 */
  .cat-grid {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .cov-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .pick-name {
    font-size: 16px;
  }
}

@media (min-width: 1200px) {
  .pick-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1400px) {
  .home {
    --shell-w: 1320px;
    max-width: 1320px;
  }
}
</style>
