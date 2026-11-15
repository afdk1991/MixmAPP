<template>
  <view class="halo">
    <view class="page page--wide home">
      <!-- 桌面端顶部导航（移动端不渲染，仍走底部 tabBar） -->
      <mx-bar desktop-only hide-back />

      <!-- ---------- 封面：左侧主标，右侧通行证卡（品牌 / 版本 / 链路 / 登录入口同一处） ---------- -->
      <view class="hero">
        <view class="hero-grid">
          <view class="hero-copy">
            <text class="hero-eyebrow mono">SINGLE SIGN-ON · 多端通行同一账号</text>
            <view class="hero-title-wrap">
              <text class="hero-title">一张通行证</text>
              <text class="hero-title hero-title--accent">通行所有星域</text>
            </view>
            <text class="hero-lede">Web・Android・iOS・鸿蒙 —— 注册即签发星际联邦通行证，并分配唯一的 MixmAPP 公民编号</text>
          </view>

          <view class="hero-card">
            <mx-logo class="hero-logo" size="lg" tone="light" sub="MIXMAPP ACCOUNT" />

            <view class="hero-facts">
              <view class="fact">
                <text class="fact-k mono">版本</text>
                <view class="fact-line" />
                <text class="fact-v mono">{{ version }}</text>
              </view>
              <view class="fact">
                <text class="fact-k mono">环境</text>
                <view class="fact-line" />
                <text class="fact-v mono">{{ env }}</text>
              </view>
              <view class="fact">
                <text class="fact-k mono">链路</text>
                <view class="fact-line" />
                <view class="fact-status">
                  <view class="status-dot" :class="{ 'status-dot--off': !online }" />
                  <text class="fact-v mono">{{ online ? 'ONLINE' : 'OFFLINE' }}</text>
                </view>
              </view>
            </view>

            <view v-if="error" class="hero-error">
              <view class="hero-error-mark mono">!</view>
              <view class="hero-error-main">
                <text class="hero-error-title">API 暂不可用</text>
                <text class="hero-error-text mono">{{ error }}</text>
              </view>
              <view class="hero-retry" hover-class="is-press" @tap="loadMeta">
                <text class="hero-retry-text mono">重试</text>
              </view>
            </view>

            <!-- 通行证主入口：与「通行入口 02」同一去向，全页只在这里给强调样式 -->
            <view class="hero-cta" hover-class="is-press" @tap="go(primaryUrl)">
              <view class="hero-cta-top">
                <text class="hero-cta-kicker mono">{{ signedIn ? 'SIGNED IN' : 'GET STARTED' }}</text>
                <text class="hero-cta-arrow mono">→</text>
              </view>
              <text class="hero-cta-title">{{ signedIn ? '查看联邦通行证' : '登录 / 领取星际联邦通行证' }}</text>
              <text class="hero-cta-sub">{{ signedIn ? '编号 · 绑定方式 · 账号资料' : '登录 · 注册 · 30 秒签发' }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ---------- 纸面：运营位 / 01 检索 / 02 入口 / 03 多端 ---------- -->
      <view class="body">

        <!-- 广告位（home/ggs）：内容与顺序完全由服务端下发，取不到就整块不渲染，不留空壳 -->
        <view v-if="ads.length" class="ggs">
          <view class="ggs-head">
            <text class="ggs-kicker mono">SPOTLIGHT · 运营位</text>
            <text class="ggs-note mono">{{ ads.length }} 条 · 服务端下发</text>
          </view>
          <scroll-view class="ggs-strip" scroll-x :show-scrollbar="false">
            <view class="ggs-track">
              <view
                v-for="ad in ads"
                :key="ad.id"
                class="gg-card"
                hover-class="is-press"
                @tap="openAd(ad)"
              >
                <image v-if="ad.image" class="gg-img" :src="ad.image" mode="aspectFill" lazy-load />
                <view class="gg-top">
                  <text class="gg-badge mono">{{ ad.badge }}</text>
                  <text v-if="ad.target !== 'none'" class="gg-arrow mono">→</text>
                </view>
                <text class="gg-title">{{ ad.title }}</text>
                <text class="gg-sub">{{ ad.subtitle }}</text>
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 推荐分类（home/rcs）：按真实商品数排序，点选直接在下方 01 区预览该分类 -->
        <view v-if="recommended.length" class="rec">
          <view class="rec-head">
            <text class="rec-kicker mono">RECOMMENDED · 推荐分类</text>
            <text class="rec-note">按商品数排序 · 点选预览</text>
          </view>
          <view class="rec-grid">
            <view
              v-for="(item, index) in recommended"
              :key="item.code"
              class="rec-card"
              :class="{ 'rec-card--active': activeCategory === item.code }"
              hover-class="is-press"
              @tap="selectCategory(item.code)"
            >
              <view class="rec-swatch" :style="{ background: item.cover }">
                <text class="rec-no mono">{{ String(index + 1).padStart(2, '0') }}</text>
              </view>
              <view class="rec-body">
                <text class="rec-name">{{ item.name }}</text>
                <text class="rec-count mono">{{ item.count }} 件</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 01 检索与目录：搜索在上、一级分类居中、商品网格在下；分类节点与商城抽屉同源 -->
        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">01</text>
                <text class="sec-cap mono">SEARCH &amp; CATALOG</text>
              </view>
              <text class="sec-title">检索与目录</text>
            </view>
            <text class="sec-count mono">实时数据 · {{ tabCategories.length }} 类</text>
          </view>
          <view class="rule" />

          <!-- 搜索：输入即检，口径与后端 lib/search 同一套（AND 分词 / 项目号 12·6 位 / 规格等价 / 全半角归一） -->
          <view class="search">
            <view class="search-mark">
              <view class="search-lens" />
              <view class="search-handle" />
            </view>
            <input
              :value="searchKeyword"
              class="search-input"
              placeholder="搜商品 / 规格 / 项目号"
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

          <!-- 空态：不弹浮层，直接把「能怎么搜」写在输入框下方 -->
          <view class="search-hint">
            <text class="search-hint-i mono">空格分词 · AND 与顺序无关</text>
            <text class="search-hint-i mono">项目号 12 位全码 / 6 位段码</text>
            <text class="search-hint-i mono">M6-1.0x8 ≡ M6x8 ≡ 6x8</text>
            <text class="search-hint-i mono">不分大小写 · 全半角等同</text>
          </view>
          <view v-if="searchNotice" class="search-notice">
            <text class="search-notice-text">{{ searchNotice }}</text>
          </view>

          <!-- 一级 6 类：code 直接取商城「商品分类」抽屉第一层节点 id，不另建一套分类 -->
          <view class="cat-head">
            <text class="cat-head-label mono">LEVEL 1 · 一级分类</text>
            <text class="cat-head-note">点选在首页预览 · 进商城可继续二三级下钻</text>
          </view>
          <view v-if="tabCategories.length" class="cat-grid">
            <view
              class="cat-card"
              :class="{ 'cat-card--active': !activeCategory && !searchActive }"
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
              :class="{ 'cat-card--active': activeCategory === cat.code && !searchActive }"
              hover-class="is-press"
              @tap="selectCategory(cat.code)"
            >
              <text class="cat-no mono">{{ String(index + 1).padStart(2, '0') }}</text>
              <text class="cat-name">{{ cat.name }}</text>
              <text class="cat-count mono">{{ cat.count }} 件</text>
            </view>
          </view>
          <view v-else class="cat-empty">
            <text class="cat-empty-text">分类暂未取到，可直接进商城浏览。</text>
            <view class="cat-empty-link" hover-class="is-press" @tap="go(ROUTES.mall)">
              <text class="cat-empty-link-text mono">商城 →</text>
            </view>
          </view>

          <!-- 目录区：精选 / 分类预览 / 搜索结果共用同一套商品卡与四态 -->
          <view class="catalog">
            <view class="catalog-head">
              <text class="catalog-title">{{ catalogTitle }}</text>
              <text class="catalog-meta mono">{{ catalogMeta }}</text>
            </view>

            <view v-if="mallLoading" class="pick-grid">
              <view v-for="i in 2" :key="i" class="pick-card">
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
              <text class="pick-state-title">目录暂未加载</text>
              <text class="pick-state-sub">{{ mallError }}</text>
              <view class="pick-retry" hover-class="is-press" @tap="loadMall">
                <text class="pick-retry-text mono">重试</text>
              </view>
            </view>

            <!-- 无结果：给出三条可执行改法，并把条件带进商城继续筛 -->
            <view v-else-if="products.length === 0 && searchActive" class="pick-state">
              <view class="pick-state-mark">空</view>
              <text class="pick-state-title">没有匹配「{{ searchKeyword.trim() }}」的商品</text>
              <text class="pick-state-sub">改一处再试：</text>
              <view class="search-tips">
                <view class="search-tip">
                  <text class="search-tip-k mono">01</text>
                  <text class="search-tip-v">规格可省螺纹距：M6-1.0x8 → M6x8 → 6x8</text>
                </view>
                <view class="search-tip">
                  <text class="search-tip-k mono">02</text>
                  <text class="search-tip-v">项目号用 12 位全码，或前 6 位段码</text>
                </view>
                <view class="search-tip">
                  <text class="search-tip-k mono">03</text>
                  <text class="search-tip-v">多个条件用空格分开，如「内六角 12.9」</text>
                </view>
              </view>
              <view class="search-actions">
                <view class="pick-retry" hover-class="is-press" @tap="openSearchInMall">
                  <text class="pick-retry-text mono">在商城中筛选</text>
                </view>
                <view class="pick-retry pick-retry--ghost" hover-class="is-press" @tap="clearSearch">
                  <text class="pick-retry-text mono">清空搜索</text>
                </view>
              </view>
            </view>

            <view v-else-if="products.length === 0" class="pick-state">
              <view class="pick-state-mark">空</view>
              <text class="pick-state-title">暂时没有可展示的商品</text>
              <text class="pick-state-sub">目录数据同步中，可前往商城浏览完整五金目录。</text>
            </view>

            <view v-else class="pick-grid">
              <view
                v-for="product in products"
                :key="product.id"
                class="pick-card"
                hover-class="is-press"
                @tap="openDetail(product)"
              >
                <view class="pick-cover">
                  <image
                    v-if="coverOf(product) && !isBroken(product.id)"
                    class="pick-cover-img"
                    :src="coverOf(product)"
                    mode="aspectFill"
                    lazy-load
                    @error="markBroken(product.id)"
                  />
                  <view v-else class="pick-cover-ph" :style="tintOf(product)">
                    <text class="pick-cover-char" :class="{ 'pick-cover-char--on-tint': !!coverTint(product) }">{{ product.title.slice(0, 1) }}</text>
                  </view>
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
              <text class="catalog-note-text">结果较多，先展示前 {{ PAGE_SIZE }} 条；加规格或项目号可缩小范围。</text>
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
        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">02</text>
                <text class="sec-cap mono">ENTRIES</text>
              </view>
              <text class="sec-title">通行入口</text>
            </view>
            <text class="sec-count mono">目录 · {{ entries.length }} 类</text>
          </view>
          <view class="rule" />
          <view class="entry-grid">
            <view
              v-for="entry in entries"
              :key="entry.key"
              class="entry-card"
              hover-class="is-press"
              @tap="go(entry.url)"
            >
              <view class="entry-top">
                <text class="entry-no mono">{{ entry.key }}</text>
                <text class="entry-tag mono">{{ entry.tag }}</text>
              </view>
              <text class="entry-title">{{ entry.title }}</text>
              <text class="entry-desc">{{ entry.desc }}</text>
              <text class="entry-arrow mono">→</text>
            </view>
          </view>
        </view>

        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">03</text>
                <text class="sec-cap mono">COVERAGE</text>
              </view>
              <text class="sec-title">多端覆盖</text>
            </view>
            <text class="sec-count mono">终端 · {{ platforms.length }} 端</text>
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
                  <text class="index-state-text mono">{{ p.status === 'ready' ? '已接通' : '规划中' }}</text>
                </view>
              </view>
              <text class="cov-name">{{ p.name }}</text>
              <text class="cov-slug mono">{{ p.code }}</text>
            </view>
          </view>
          <text class="section-note">H5 与 Android 已上线；iOS、鸿蒙、微信小程序、App-Plus 规划中，账号、发号器与权限按共用设计。</text>
        </view>

        <view class="footer">
          <view class="foot-rule" />
          <text class="foot-line mono">BUILD · TEST · SHIP · OPS</text>
          <text class="foot-line foot-line--dim mono">{{ releaseLabel }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { metaApi, mallApi, homeApi, productCover, coverTint, ApiError } from '../../api/client';
import { session } from '../../stores/session';
import { APP_VERSION } from '../../version';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import MxLogo from '../../components/mx-logo/mx-logo.vue';
import MxBar from '../../components/mx-bar/mx-bar.vue';
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

/** 版本文案由构建期生成的 APP_VERSION 驱动，标注正式发布，不写死版本号。 */
const releaseLabel = computed(() => `MIXMAPP · ${APP_VERSION} · 正式发布`);

const version = ref(APP_VERSION);
const env = ref('unknown');
const online = ref(false);
const error = ref('');

/**
 * 端状态是首页静态事实，不是接口数据：只有 H5 与 Android 有可运行产物，
 * 其余四端仍在规划中，必须与已接通端在视觉上区分，不能一律给绿点。
 */
const platforms = [
  { code: 'WEB', short: 'WEB', name: 'H5 / PWA', status: 'ready' },
  { code: 'ANDROID', short: 'AND', name: 'Android', status: 'ready' },
  { code: 'IOS', short: 'IOS', name: 'iOS', status: 'planned' },
  { code: 'HARMONY', short: 'HAR', name: '鸿蒙', status: 'planned' },
  { code: 'WECHAT', short: 'WX', name: '微信小程序', status: 'planned' },
  { code: 'APP-PLUS', short: 'APP', name: 'App-Plus', status: 'planned' },
];

/**
 * 通行入口：序号由数组顺序派生（01/02/03/04），不在数据里另写 key。
 * 之前数据里手写 04 排在 03 前面，序号与展示顺序不一致。
 */
const entryItems = [
  { tag: 'MALL', title: '商城', desc: '商品 · 购物车 · 订单', url: ROUTES.mall },
  { tag: 'PASS', title: '星际联邦通行证', desc: '登录 · 注册 · 公民编号', url: ROUTES.me },
  { tag: 'RESEARCH', title: '深度研究', desc: 'AI 多轮检索 · 结构化报告', url: ROUTES.research },
  { tag: 'INFO', title: '关于', desc: '能力矩阵与版本', url: ROUTES.about },
];

const entries = computed(() =>
  entryItems.map((item, index) => ({ ...item, key: String(index + 1).padStart(2, '0') })),
);

const signedIn = computed(() => Boolean(session.user));
const primaryUrl = computed(() => ROUTES.me);

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
 * 分类完全由后端分类树驱动：取一级节点（6 个真实类目），与商城页同一口径。
 * 不用 `/mall/categories` 的扁平聚合，避免混入演示类目、计数口径也不一致。
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
  totalCount.value > 0 ? `查看全部 ${totalCountText.value} 件商品` : '进入商城浏览完整目录',
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
  return activeCategoryName.value ? `${activeCategoryName.value} · 精选` : '精选商品';
});

const catalogMeta = computed(() => {
  if (mallLoading.value) return searchActive.value ? '检索中…' : '加载中…';
  if (mallError.value) return '加载失败';
  if (searchActive.value) {
    return hasMore.value ? `前 ${PAGE_SIZE} 条 · 还有更多` : `${products.value.length} 件`;
  }
  return `精选 ${products.value.length} 件`;
});

/** 统一出口：搜索带 keyword，分类带 category（一级节点 id），其余进全量目录。 */
const catalogCtaLabel = computed(() => {
  if (searchActive.value) return '在商城中查看全部结果';
  if (activeCategoryName.value) return `在商城中查看「${activeCategoryName.value}」`;
  return catalogAllLabel.value;
});

async function loadCategories(): Promise<void> {
  try {
    const list = await mallApi.listCategoryChildren();
    categories.value = (Array.isArray(list) ? list : [])
      .filter((node) => node && node.id && node.name)
      .map((node) => ({ code: node.id, name: node.name, count: node.count ?? 0 }));
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

function loadMall(): Promise<unknown> {
  return Promise.allSettled([loadCategories(), loadProducts()]);
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
    searchNotice.value = '请输入关键词：商品名、规格或项目号';
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
  activeCategory.value = code;
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
    await mallApi.addToCart(product.id, 1);
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

async function loadMeta(): Promise<void> {
  error.value = '';
  try {
    const meta = await metaApi.get();
    // 版本以构建期 APP_VERSION（正式发布）为准，不被服务端 meta.version 覆盖成旧版串。
    env.value = meta.env;
    online.value = true;
  } catch (e) {
    online.value = false;
    error.value = e instanceof ApiError ? `${e.message}（${e.status}）` : '无法连接 API';
  }
}

onLoad(() => {
  void loadMeta();
  void loadMall();
  void loadHome();
});

/** 原生下拉刷新：同时刷新运行环境与精选目录，两者都落定后收起指示器 */
onPullDownRefresh(() => {
  void Promise.allSettled([loadMeta(), loadMall(), loadHome()]).then(() => uni.stopPullDownRefresh());
});
</script>

<style scoped lang="scss">
.halo {
  min-height: 100vh;
  background: $paper;
}

.home {
  /* tabBar 页面：为原生底部标签栏留安全距离，避免页脚被遮挡 */
  padding-bottom: calc(140rpx + env(safe-area-inset-bottom));
}

/* ---------- 封面：深场 ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: calc(48rpx + var(--status-bar-height, 0px)) $sp-4 $sp-5;
  /* 首层是品牌青的柔光，只能写成 rgba（需要透明度）；底色与渐变全部走令牌 */
  background:
    radial-gradient(88% 120% at 4% 0%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 58%),
    linear-gradient(164deg, $deep 0%, $deep-2 56%, $deep-3 100%);
  border-bottom: 1rpx solid $on-deep-line;
}

.hero-eyebrow {
  display: block;
  font-size: $fs-micro;
  line-height: 1.5;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $on-deep-2;
}

.hero-title-wrap {
  margin-top: $sp-2;
}

.hero-title {
  display: block;
  font-family: $font-display;
  font-size: $fs-display;
  font-weight: 800;
  line-height: $lh-tight;
  letter-spacing: $ls-tight;
  color: $on-deep;
}

.hero-title--accent {
  color: $brand-on-deep;
}

.hero-lede {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $on-deep-2;
}

/* ---------- 通行证卡：品牌标 + 事实行 + 主入口 ---------- */
.hero-card {
  display: flex;
  flex-direction: column;
  margin-top: $sp-5;
  padding: $sp-4;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-shell;
  background: $deep-2;
}

.hero-facts {
  margin-top: $sp-4;
  padding-top: $sp-3;
  border-top: 1rpx solid $on-deep-line;
}

.fact {
  display: flex;
  align-items: baseline;
  padding: 8rpx 0;
}

.fact-k {
  width: 92rpx;
  flex-shrink: 0;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-3;
}

/* 点线引导：把标签和值拉开，避免 1.3x 字体下两者挤在一起 */
.fact-line {
  flex: 1;
  min-width: 24rpx;
  margin: 0 $sp-2;
  border-bottom: 1rpx dashed $on-deep-line;
}

.fact-v {
  flex-shrink: 0;
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $on-deep-2;
  text-align: right;
}

.fact-status {
  display: flex;
  align-items: center;
}

.status-dot {
  width: 12rpx;
  height: 12rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background: $brand-on-deep;
}

.status-dot--off {
  background: $amber-on-deep;
}

.hero-error {
  display: flex;
  align-items: flex-start;
  margin-top: $sp-3;
  padding: $sp-3;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-control;
  background: $deep-3;
}

.hero-error-mark {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
  border: 1rpx solid $on-deep-line;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $fs-micro;
  color: $amber-on-deep;
}

.hero-error-main {
  flex: 1;
  min-width: 0;
  margin-left: $sp-3;
}

.hero-error-title {
  display: block;
  font-size: $fs-meta;
  font-weight: 800;
  color: $on-deep;
}

.hero-error-text {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-micro;
  line-height: $lh-body;
  color: $on-deep-2;
  word-break: break-all;
}

.hero-retry {
  flex-shrink: 0;
  min-height: 64rpx;
  margin-left: $sp-3;
  padding: 0 $sp-3;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-control;
  display: flex;
  align-items: center;
}

.hero-retry-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep-2;
}

/* 浅底反白块：on-deep/deep 两套主题里恒定，深色主题不会翻成浅字压浅底 */
.hero-cta {
  display: block;
  margin-top: $sp-4;
  padding: $sp-3;
  background: $on-deep;
  border-left: 8rpx solid $brand;
  border-radius: $r-card;
}

/* 箭头放在 kicker 同一行：标题占满整行，1.3x 或长文案也不会被箭头挤成孤字换行 */
.hero-cta-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-cta-kicker {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $deep-3;
}

.hero-cta-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  line-height: $lh-snug;
  letter-spacing: $ls-tight;
  color: $deep;
}

.hero-cta-sub {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-micro;
  color: $deep-3;
}

.hero-cta-arrow {
  flex-shrink: 0;
  margin-left: $sp-2;
  font-size: 30rpx;
  color: $deep-2;
}

/* ---------- 纸面 ---------- */
.body {
  padding: $sp-5 $sp-3 0;
}

/* ---------- 运营位：广告位（home/ggs） ---------- */
.ggs {
  margin-top: $sp-4;
}

.ggs-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  margin-bottom: $sp-2;
}

.ggs-kicker {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $ink-4;
}

.ggs-note {
  font-size: $fs-micro;
  color: $ink-4;
}

/* 横向滑动：不显示原生滚动条，靠卡片被裁切的边缘暗示还能继续滑 */
.ggs-strip {
  width: 100%;
  white-space: nowrap;
}

.ggs-track {
  display: flex;
  gap: $sp-2;
  padding-bottom: 4rpx;
}

.gg-card {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  width: 420rpx;
  min-height: 168rpx;
  padding: $sp-3;
  box-sizing: border-box;
  /* 父级为横向滚动设了 nowrap，卡片内部要复位，否则长文案不换行会撑破卡片 */
  white-space: normal;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.gg-img {
  width: 100%;
  height: 150rpx;
  margin-bottom: $sp-2;
  border-radius: $r-card;
}

.gg-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-1;
  margin-bottom: 8rpx;
}

.gg-badge {
  padding: 4rpx 12rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $brand-deep;
  background: $brand-soft;
  border-radius: $r-pill;
}

.gg-arrow {
  font-size: $fs-meta;
  color: $brand;
}

.gg-title {
  display: block;
  font-size: $fs-meta;
  font-weight: 600;
  line-height: $lh-snug;
  color: $ink;
}

.gg-sub {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-4;
}

/* ---------- 推荐分类（home/rcs） ---------- */
.rec {
  margin-top: $sp-5;
}

.rec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  margin-bottom: $sp-2;
}

.rec-kicker {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $brand;
}

.rec-note {
  font-size: $fs-micro;
  color: $ink-4;
}

.rec-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
}

.rec-card {
  display: flex;
  align-items: center;
  gap: $sp-2;
  min-width: 0;
  padding: $sp-2;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.rec-card--active {
  border-color: $brand;
  background: $brand-soft;
}

.rec-swatch {
  display: flex;
  align-items: flex-end;
  flex: 0 0 auto;
  width: 72rpx;
  height: 72rpx;
  padding: 8rpx;
  box-sizing: border-box;
  border-radius: $r-pill;
}

.rec-no {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-solid;
}

.rec-body {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.rec-name {
  font-size: $fs-meta;
  font-weight: 600;
  line-height: $lh-snug;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rec-count {
  font-size: $fs-micro;
  color: $ink-4;
}

.section {
  margin-top: $sp-6;
}

.sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: $sp-2;
  margin-bottom: $sp-2;
}

.sec-head-l {
  min-width: 0;
}

.sec-kicker {
  display: flex;
  align-items: center;
}

.sec-no {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $brand;
}

.sec-cap {
  margin-left: 12rpx;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $ink-4;
}

.sec-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: $ls-tight;
  color: $ink;
}

.sec-count {
  flex-shrink: 0;
  padding-bottom: 6rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

/* ---------- 01 通行入口 ---------- */
.entry-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-3;
}

.entry-card {
  display: flex;
  flex-direction: column;
  min-height: 220rpx;
  padding: $sp-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-1;
}

.entry-no {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $brand;
}

.entry-tag {
  font-size: $fs-micro;
  letter-spacing: 1.5rpx;
  color: $ink-4;
}

.entry-title {
  display: block;
  margin-top: $sp-3;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  line-height: $lh-snug;
  letter-spacing: $ls-tight;
  color: $ink;
}

.entry-desc {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
}

.entry-arrow {
  display: block;
  margin-top: auto;
  padding-top: $sp-2;
  font-size: $fs-meta;
  color: $ink-4;
}

/* ---------- 01 检索与目录 ---------- */
.search {
  display: flex;
  align-items: center;
  gap: $sp-2;
  min-height: 96rpx;
  margin-top: $sp-3;
  padding: 0 $sp-2 0 $sp-3;
  box-sizing: border-box;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

/* 聚焦时边框变品牌色：H5 / Android WebView 都生效 */
.search:focus-within {
  border-color: $brand;
}

.search-mark {
  position: relative;
  flex-shrink: 0;
  width: 36rpx;
  height: 36rpx;
}

.search-lens {
  position: absolute;
  left: 2rpx;
  top: 2rpx;
  width: 24rpx;
  height: 24rpx;
  box-sizing: border-box;
  border: 3rpx solid $ink-3;
  border-radius: 50%;
}

.search-handle {
  position: absolute;
  right: 2rpx;
  bottom: 5rpx;
  width: 14rpx;
  height: 3rpx;
  background: $ink-3;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 60rpx;
  font-size: $fs-body;
  color: $ink;
  background: transparent;
}

.field-ph {
  color: $ink-4;
}

.search-clear {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: $paper-2;
}

.search-clear-x {
  font-size: 32rpx;
  line-height: 1;
  color: $ink-3;
}

.search-go {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 68rpx;
  padding: 0 $sp-4;
  border-radius: $r-control;
  background: $solid;
}

.search-go-text {
  font-size: $fs-meta;
  font-weight: 600;
  color: $on-solid;
}

/* 空态说明：不弹浮层，四条检索口径直接列在输入框下方 */
.search-hint {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2 $sp-3;
  margin-top: $sp-2;
}

.search-hint-i {
  font-size: $fs-micro;
  letter-spacing: 0;
  color: $ink-4;
}

.search-notice {
  margin-top: $sp-2;
  padding: $sp-2 $sp-3;
  border-left: 6rpx solid $signal;
  border-radius: 0 $r-control $r-control 0;
  background: $paper-2;
}

.search-notice-text {
  font-size: $fs-micro;
  color: $ink-2;
}

/* 一级分类：与商城「商品分类」抽屉同一批节点，首页只平铺第一层 */
.cat-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  margin-top: $sp-5;
}

.cat-head-label {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-4;
}

.cat-head-note {
  font-size: $fs-micro;
  color: $ink-4;
}

.cat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-3;
}

.cat-card {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-height: 132rpx;
  padding: $sp-3;
  box-sizing: border-box;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.cat-card--active {
  border-color: $brand;
  background: $brand-soft;
}

.cat-no {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-4;
}

.cat-card--active .cat-no {
  color: $brand-deep;
}

.cat-name {
  font-size: $fs-meta;
  font-weight: 600;
  line-height: $lh-snug;
  color: $ink;
}

.cat-count {
  font-size: $fs-micro;
  color: $ink-4;
}

.cat-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
  margin-top: $sp-3;
  padding: $sp-3;
  border: 1rpx dashed $paper-3;
  border-radius: $r-control;
}

.cat-empty-text {
  font-size: $fs-micro;
  color: $ink-3;
}

.cat-empty-link {
  flex-shrink: 0;
}

.cat-empty-link-text {
  font-size: $fs-micro;
  color: $brand-deep;
}

/* 目录区：精选 / 分类预览 / 搜索结果共用同一个头 + 网格 + 出口 */
.catalog {
  margin-top: $sp-5;
}

.catalog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  padding-bottom: $sp-2;
  border-bottom: 1rpx solid $paper-3;
}

.catalog-title {
  font-size: $fs-body;
  font-weight: 600;
  color: $ink;
}

.catalog-meta {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-4;
}

.catalog-note {
  margin-top: $sp-3;
  padding: $sp-2 $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.catalog-note-text {
  font-size: $fs-micro;
  color: $ink-3;
}

/* 无结果时给的三条改法 */
.search-tips {
  display: flex;
  flex-direction: column;
  gap: $sp-2;
  width: 100%;
  max-width: 520px;
  margin-top: $sp-1;
  text-align: left;
}

.search-tip {
  display: flex;
  align-items: baseline;
  gap: $sp-2;
}

.search-tip-k {
  flex-shrink: 0;
  font-size: $fs-micro;
  color: $brand-deep;
}

.search-tip-v {
  font-size: $fs-micro;
  line-height: $lh-snug;
  color: $ink-2;
}

.search-actions {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
  margin-top: $sp-3;
}

.search-actions .pick-retry {
  margin-top: 0;
}

.pick-retry--ghost {
  border-color: transparent;
  background: transparent;
}

.pick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-3;
}

.pick-card {
  display: flex;
  flex-direction: column;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
  overflow: hidden;
}

.pick-cover {
  position: relative;
  width: 100%;
  height: 240rpx;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $paper-2;
  border-bottom: 1rpx solid $paper-3;
}

.pick-cover-img {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.pick-cover-ph {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pick-cover-char {
  font-family: $font-display;
  font-size: 84rpx;
  font-weight: 800;
  color: $ink-4;
}

/* 自有商品没有实物图，后端 cover 存的是品牌色：占位块铺该底色，首字改白，避免灰字压彩色。 */
.pick-cover-char--on-tint {
  color: $on-deep;
  opacity: 0.92;
}

.pick-cover-tag {
  position: absolute;
  left: 16rpx;
  top: 16rpx;
  z-index: 2;
  padding: 4rpx 10rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: 6rpx;
}

.pick-add {
  position: absolute;
  right: 14rpx;
  bottom: 14rpx;
  z-index: 3;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: $shell;
  border: 1rpx solid $paper-3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pick-add--inquiry {
  background: $brand-soft;
}

.pick-add-text {
  font-size: 32rpx;
  line-height: 1;
  color: $ink;
}

.pick-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 196rpx;
  padding: $sp-3;
}

.pick-name {
  font-family: $font-display;
  font-size: 28rpx;
  font-weight: 800;
  line-height: 1.4;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.pick-sub,
.pick-spec,
.pick-pack {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-spec,
.pick-pack {
  margin-top: 4rpx;
  color: $ink-4;
}

.pick-foot {
  margin-top: auto;
  padding-top: $sp-2;
}

.pick-price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

.pick-cur {
  margin-right: 2rpx;
  font-size: 24rpx;
  color: $ink-2;
}

.pick-amount {
  font-family: $font-mono;
  font-size: 38rpx;
  font-weight: 800;
  color: $ink;
}

.pick-unit {
  margin-left: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.pick-inquiry {
  font-size: 34rpx;
  font-weight: 800;
  color: $brand-deep;
}

.pick-inquiry-sub {
  margin-left: 10rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.pick-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $sp-6 0 $sp-4;
}

.pick-state-mark {
  width: 72rpx;
  height: 72rpx;
  border: 1rpx solid $paper-3;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: $ink-4;
}

.pick-state-title {
  margin-top: $sp-3;
  font-size: $fs-body;
  font-weight: 700;
  color: $ink;
}

.pick-state-sub {
  margin-top: 8rpx;
  font-size: $fs-meta;
  color: $ink-3;
  text-align: center;
  line-height: $lh-body;
}

.pick-retry {
  margin-top: $sp-3;
  min-height: 64rpx;
  padding: 0 $sp-4;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  display: flex;
  align-items: center;
}

.pick-retry-text {
  font-size: $fs-micro;
  color: $ink-2;
}

.pick-sk-cover {
  height: 240rpx;
  border-radius: 0;
}

.pick-sk-line {
  height: 26rpx;
  margin-top: 14rpx;
  width: 82%;
}

.pick-sk-line--short {
  width: 54%;
}

.pick-sk-price {
  height: 30rpx;
  margin-top: 18rpx;
  width: 40%;
}

.pick-more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $sp-2;
  padding: $sp-3 4rpx;
  border-top: 1rpx solid $paper-2;
}

.pick-more-text {
  font-size: $fs-meta;
  font-weight: 600;
  color: $brand-deep;
}

.pick-more-arrow {
  font-size: $fs-meta;
  color: $ink-4;
}

/* ---------- 03 多端覆盖 ---------- */
.cov-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-3;
}

.cov-cell {
  display: flex;
  flex-direction: column;
  padding: $sp-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.cov-cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-1;
}

.cov-code {
  flex-shrink: 0;
  padding: 2rpx 10rpx;
  border: 1rpx solid $paper-3;
  border-radius: 6rpx;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-2;
}

.cov-name {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.4;
  color: $ink;
}

.cov-slug {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.cov-cell--idle .cov-name {
  color: $ink-3;
}

.cov-cell--idle .cov-code {
  color: $ink-4;
}

/* 端状态：已接通=实心绿点；规划中=空心灰点，两者都带文字，不靠颜色单独传达 */
.index-state {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.index-dot {
  flex-shrink: 0;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: $brand;
}

.index-state--idle .index-dot {
  background: transparent;
  border: 1rpx solid $ink-4;
}

.index-state-text {
  margin-left: 8rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $brand-deep;
}

.index-state--idle .index-state-text {
  color: $ink-4;
}

.section-note {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

/* ---------- 页脚 ---------- */
.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: $sp-8;
}

.foot-rule {
  width: 64rpx;
  height: 1rpx;
  margin-bottom: 26rpx;
  background: $paper-3;
}

.foot-line {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.foot-line--dim {
  margin-top: 10rpx;
  opacity: 0.72;
}

/* ---------- 窄屏：收紧展示大标，保证 375px 不挤 ---------- */
@media (max-width: 390px) {
  .hero-title {
    font-size: 84rpx;
  }

  .body {
    padding-left: 22rpx;
    padding-right: 22rpx;
  }
}

/* ---------- 桌面：版心内三栏节奏（入口 4 列 / 目录 左轨+3 列 / 端 3 列） ---------- */
@media (min-width: 1000px) {
  .home {
    /* 宽屏已隐藏底部 tabBar，取消为标签栏预留的安全距离 */
    padding-bottom: 0;
  }

  .hero {
    padding: 64px 48px 56px;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(340px, 0.6fr);
    column-gap: 56px;
    align-items: stretch;
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .hero-title {
    font-size: 64px;
    letter-spacing: -2px;
  }

  .hero-lede {
    max-width: 640px;
  }

  .hero-card {
    margin-top: 0;
    padding: 28px;
  }

  .hero-facts {
    margin-top: 24px;
    padding-top: 20px;
  }

  .fact {
    padding: 7px 0;
  }

  .fact-k {
    width: 52px;
    font-size: 12px;
  }

  .fact-v {
    font-size: 13px;
  }

  .hero-cta {
    margin-top: auto;
    padding: 18px;
  }

  .hero-cta-title {
    font-size: 18px;
  }

  .hero-cta-sub {
    font-size: 12px;
  }

  .hero-error {
    margin-top: 18px;
  }

  .body {
    padding: 56px 48px 0;
  }

  .section {
    margin-top: 64px;
  }

  .sec-title {
    font-size: 34px;
  }

  .entry-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-top: 20px;
  }

  .entry-card {
    min-height: 190px;
    padding: 20px;
  }

  .entry-title {
    font-size: 20px;
  }

  .entry-desc {
    font-size: 12.5px;
  }

  /* 检索：桌面加高输入框，口径说明并成一行 */
  .search {
    min-height: 64px;
    margin-top: 24px;
    padding: 0 8px 0 18px;
    gap: 12px;
  }

  .search-input {
    height: 40px;
    font-size: 15px;
  }

  .search-go {
    min-height: 46px;
    padding: 0 24px;
  }

  .search-go-text {
    font-size: 14px;
  }

  .search-hint {
    gap: 8px 24px;
    margin-top: 10px;
  }

  /* 一级 6 类 + 全部：桌面一行 7 格，与抽屉第一层一一对应 */
  .cat-head {
    margin-top: 32px;
  }

  .cat-grid {
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 12px;
    margin-top: 14px;
  }

  .cat-card {
    min-height: 112px;
    padding: 16px;
  }

  .cat-name {
    font-size: 15px;
  }

  .catalog {
    margin-top: 36px;
  }

  .catalog-title {
    font-size: 20px;
  }

  .pick-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
    margin-top: 20px;
  }

  .pick-cover,
  .pick-sk-cover {
    height: auto;
    aspect-ratio: 4 / 3;
  }

  .pick-info {
    min-height: 0;
    padding: 16px;
  }

  .pick-name {
    font-size: 15px;
  }

  .pick-amount {
    font-size: 24px;
  }

  .pick-more {
    margin-top: 24px;
    padding: 16px 4px;
  }

  .cov-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: 20px;
  }

  .cov-cell {
    padding: 20px;
  }

  .cov-name {
    font-size: 16px;
  }

  .section-note {
    max-width: 760px;
    font-size: 12.5px;
  }

  .footer {
    padding: 64px 0 56px;
  }
}

@media (min-width: 1400px) {
  /* 首页版心比通用 page--wide 更宽，桌面视觉重心不塌在中间一窄条 */
  .home {
    --shell-w: 1320px;
    max-width: 1320px;
  }

  .hero-title {
    font-size: 76px;
  }
}
</style>
