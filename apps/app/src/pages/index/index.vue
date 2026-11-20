<template>
  <view class="halo">
    <!-- home--search：搜索激活时整页切到「结果优先」形态，首屏自动收成一条搜索栏 -->
    <view class="page page--wide home" :class="{ 'home--search': searchActive }">
      <!-- 桌面端顶部导航（移动端不渲染，仍走底部 tabBar） -->
      <mx-bar desktop-only hide-back />

      <!-- ============================================================
           首屏「目录台」
           旧版首屏是一张品牌海报，搜索要越过运营位与推荐分类才出现，
           移动端首屏几乎看不到输入框；而首页的第一任务通常是「找一件具体的货」。
           所以这里把搜索做成首屏唯一的大控件，标题只留一句定位，
           账号 / 版本 / 链路收进右侧窄卡，不再与找货争抢注意力。
           搜索激活后 .home--search 会把标题、说明、数据尺、侧卡全部收起，
           让结果紧接着搜索出现，而不是被首屏继续往下推。
           ============================================================ -->
      <view class="hero">
        <view class="hero-grid">
          <view class="hero-main">
            <view class="hero-eyebrow-row">
              <text class="hero-eyebrow mono">MIXMAPP 五金商品</text>
              <!-- 状态只给用户能理解的两种说法，不暴露内部链路术语 -->
              <view class="hero-badge" :class="{ 'hero-badge--off': !online }">
                <view class="hero-badge-dot" />
                <text class="hero-badge-text mono">{{ online ? '在线' : '连不上' }}</text>
              </view>
            </view>

            <view class="hero-title-wrap">
              <text class="hero-title">五金商品，</text>
              <text class="hero-title hero-title--accent">一搜就到。</text>
            </view>
            <text class="hero-lede">输入名称、规格或项目号，结果直接出现在下面；想慢慢挑，也可以从类目进去看。</text>

            <!-- 搜索：首屏主控件。行为完全沿用原实现（输入即检 + 320ms 防抖 + 五态），只改位置与权重 -->
            <view class="search search--hero">
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

            <!-- 数据尺：用真实计数替代营销数字，给「目录有多大」一个可核对的量 -->
            <view v-if="!searchActive" class="hero-stats">
              <view class="stat">
                <text class="stat-k mono">商品类别</text>
                <text class="stat-v">{{ tabCategories.length || '—' }}<text class="stat-u"> 类</text></text>
              </view>
              <view class="stat">
                <text class="stat-k mono">在售商品</text>
                <text class="stat-v">{{ totalCountText }}<text class="stat-u"> 件</text></text>
              </view>
              <view class="stat">
                <text class="stat-k mono">本页推荐</text>
                <text class="stat-v">{{ PAGE_SIZE }}<text class="stat-u"> 件</text></text>
              </view>
            </view>
          </view>

          <!-- 通行证侧卡：品牌 / 运行态 / 登录入口仍集中在一处，但降为辅助层级 -->
          <view class="hero-side">
            <view class="pass">
              <view class="pass-head">
                <mx-logo size="md" tone="light" sub="我的账号" />
                <text class="pass-kicker mono">{{ signedIn ? '已登录' : '未登录' }}</text>
              </view>

              <view class="pass-facts">
                <!-- 版本号只在有正式发版号时展示：0.0.0 是仓库的初始占位版本，
                     直接摆出来像没做完的产品，没有信息价值 -->
                <view v-if="versionLabel" class="pass-fact">
                  <text class="pass-k mono">版本</text>
                  <view class="pass-line" />
                  <text class="pass-v mono">{{ versionLabel }}</text>
                </view>
                <view class="pass-fact">
                  <text class="pass-k mono">环境</text>
                  <view class="pass-line" />
                  <text class="pass-v mono">{{ envLabel }}</text>
                </view>
                <view class="pass-fact">
                  <text class="pass-k mono">网络</text>
                  <view class="pass-line" />
                  <view class="pass-status">
                    <view class="status-dot" :class="{ 'status-dot--off': !online }" />
                    <text class="pass-v mono">{{ online ? '正常' : '未连接' }}</text>
                  </view>
                </view>
              </view>

              <view v-if="error" class="pass-error">
                <view class="pass-error-mark mono">!</view>
                <view class="pass-error-main">
                  <text class="pass-error-title">暂时连不上服务</text>
                  <text class="pass-error-text">检查网络后再点一次重试。</text>
                </view>
                <view class="pass-retry" hover-class="is-press" @tap="loadMeta">
                  <text class="pass-retry-text mono">重试</text>
                </view>
              </view>

              <!-- 通行证主入口：与「通行入口 02」同一去向，全页只在这里给强调样式 -->
              <view class="pass-cta" hover-class="is-press" @tap="go(primaryUrl)">
                <view class="pass-cta-main">
                  <text class="pass-cta-title">{{ signedIn ? '查看我的通行证' : '登录或注册' }}</text>
                  <text class="pass-cta-sub">{{ signedIn ? '编号、绑定方式与账号资料' : '30 秒完成，手机电脑通用' }}</text>
                </view>
                <text class="pass-cta-arrow mono">→</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="body">
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

          <!-- 搜索态回执：让用户随时确认「现在看到的是哪个关键词的结果」，并可一键退回浏览态 -->
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
                    <text class="pick-cover-char" :class="{ 'pick-cover-char--on-tint': !!coverTint(product) }">{{ product.title.slice(0, 1) }}</text>
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
             02 通行入口
             货架之后才是账号与工具入口；卡片高度压到 150px 左右，
             让「找货」与「办事」在纵向节奏上有明确主次。
             ============================================================ -->
        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">02</text>
                <text class="sec-cap mono">入口</text>
              </view>
              <text class="sec-title">常用入口</text>
            </view>
            <text class="sec-count mono">共 {{ entries.length }} 项</text>
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

        <!-- ============================================================
             03 多端覆盖
             从 6 张大卡收成 6 个紧凑单元：这是静态事实，不该占据与货架同级的面积。
             已接通 / 规划中仍用绿点与虚线底区分，信息不丢。
             ============================================================ -->
        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <view class="sec-kicker">
                <text class="sec-no mono">03</text>
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
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { metaApi, mallApi, homeApi, productCover, coverTint, ApiError, applyMetaFlags, applyMetaThirdParty } from '../../api/client';
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

/**
 * 版本文案由构建期 APP_VERSION 驱动，不写死版本号。
 * 初始版本 0.0.0 属于仓库占位值，展开口反而像未完成品，这里只保留「正式发布」。
 * 用函数宽化入参为 string，避免与版本字面量窄类型做无重叠比较。
 */
const isBaselineVersion = (v: string) => v === '0.0.0';
const releaseLabel = computed(() =>
  APP_VERSION && !isBaselineVersion(APP_VERSION) ? `版本 ${APP_VERSION} · 正式发布` : '正式发布',
);

const version = ref(APP_VERSION);
/** 通行证卡里的版本行：仅在拿到真实发版号时展示，0.0.0 直接隐藏。 */
const versionLabel = computed(() => (version.value && !isBaselineVersion(version.value) ? version.value : ''));
const env = ref('unknown');
/** 环境值来自接口，页面只展示用户能懂的中文，不直接暴露 production/development 这类内部值。 */
const envLabel = computed(() => {
  if (env.value === 'production') return '正式版';
  if (env.value === 'development') return '开发版';
  return '预览版';
});
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

/**
 * 通行入口：序号由数组顺序派生（01/02/03/04），不在数据里另写 key。
 * 之前数据里手写 04 排在 03 前面，序号与展示顺序不一致。
 */
const entryItems = [
  { tag: '购物', title: '逛商城', desc: '商品、购物车和订单都在这里', url: ROUTES.mall },
  { tag: '账号', title: '我的通行证', desc: '登录、注册，查看账号资料', url: ROUTES.me },
  { tag: '研究', title: '深度研究', desc: '多轮检索后给出结构化报告', url: ROUTES.research },
  { tag: '说明', title: '关于 MixmAPP', desc: '能做什么、当前版本与更新', url: ROUTES.about },
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
    // 版本以构建期 APP_VERSION（正式发布）为准，不被服务端 meta.version 覆盖成旧版串。
    env.value = meta.env;
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
});

/** 原生下拉刷新：同时刷新运行环境与精选目录，两者都落定后收起指示器 */
onPullDownRefresh(() => {
  void Promise.allSettled([loadMeta(), loadMall(), loadHome()]).then(() => uni.stopPullDownRefresh());
});
</script>

<style scoped lang="scss">
/* ==========================================================================
   首页 · 目录台
   层级：首屏搜索 → 运营位 → 热门分类 → 货架（分类 + 商品）→ 入口 → 覆盖。
   视觉原则沿用「星际联邦」令牌：暖白纸 + 深场石墨 + 品牌青，
   所有颜色/字阶/间距只取 uni.scss，不新增裸色值，深色模式自动跟随。
   ========================================================================== */

.halo {
  min-height: 100vh;
  background: $paper;
}

.home {
  /* 单一内边距变量：窄屏再收一档时只改这里，避免子块各自写死 */
  --home-pad: #{$sp-3};
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
}

@media (max-width: 360px) {
  .home {
    --home-pad: 20rpx;
  }
}

/* ---------- 首屏：深场 + 细网格，像一张目录工作台 ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: calc(32rpx + var(--status-bar-height, 0px)) $sp-4 $sp-5;
  background-color: $deep;
  /* 网格线放在渐变之上；两层发丝线给深场一点「图纸」质感，不抢内容 */
  background-image:
    linear-gradient($on-deep-line 1rpx, transparent 1rpx),
    linear-gradient(90deg, $on-deep-line 1rpx, transparent 1rpx),
    linear-gradient(168deg, $deep 0%, $deep-2 58%, $deep-3 100%);
  background-size:
    72rpx 72rpx,
    72rpx 72rpx,
    100% 100%;
  border-bottom: 1rpx solid $on-deep-line;
}

.hero-eyebrow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
}

.hero-eyebrow {
  min-width: 0;
  font-size: 20rpx;
  letter-spacing: $ls-label;
  color: $acc-on-deep-1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  flex: 0 0 auto;
  padding: 6rpx 14rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-pill;
}

.hero-badge-dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: $brand-on-deep;
}

.hero-badge-text {
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $brand-on-deep;
}

.hero-badge--off .hero-badge-dot {
  background: $amber-on-deep;
}

.hero-badge--off .hero-badge-text {
  color: $amber-on-deep;
}

.hero-title-wrap {
  display: flex;
  flex-direction: column;
  margin-top: $sp-4;
}

.hero-title {
  font-family: $font-display;
  font-size: 84rpx;
  font-weight: 800;
  line-height: $lh-tight;
  letter-spacing: $ls-tight;
  color: $acc-on-deep-2;
}

.hero-title--accent {
  color: $brand-on-deep;
}

.hero-lede {
  margin-top: $sp-2;
  font-size: $fs-meta;
  line-height: $lh-snug;
  color: $on-deep-2;
}

/* ---------- 搜索：首屏唯一主控件，白壳 + 品牌青描边明确「从这里开始」 ---------- */
.search {
  display: flex;
  align-items: center;
  gap: $sp-2;
  box-sizing: border-box;
  min-height: 100rpx;
  padding: 10rpx 12rpx 10rpx 28rpx;
  background: $shell;
  border: 2rpx solid $paper-3;
  border-radius: $r-control;
}

.search--hero {
  margin-top: $sp-4;
  border-color: $brand;
  box-shadow: $shadow-lift;
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
  gap: $sp-1 $sp-3;
  margin-top: $sp-2;
}

.search-hint-i {
  padding-left: 14rpx;
  border-left: 2rpx solid $on-deep-line;
  font-size: 22rpx;
  line-height: 1.5;
  color: $on-deep-3;
}

.search-notice {
  margin-top: $sp-2;
  padding: 18rpx 22rpx;
  background: $deep-3;
  border-left: 6rpx solid $amber-on-deep;
  border-radius: 0 $r-control $r-control 0;
}

.search-notice-text {
  font-size: $fs-meta;
  line-height: 1.5;
  color: $on-deep;
}

/* ---------- 数据尺：真实计数，给目录规模一个可核对的口径 ---------- */
.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-5;
  padding-top: $sp-3;
  border-top: 1rpx solid $on-deep-line;
}

.stat {
  min-width: 0;
}

.stat-k {
  display: block;
  font-size: 20rpx;
  letter-spacing: $ls-label;
  color: $on-deep-3;
}

.stat-v {
  display: block;
  margin-top: 8rpx;
  font-family: $font-display;
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1.1;
  color: $acc-on-deep-2;
}

.stat-u {
  font-size: $fs-micro;
  font-weight: 400;
  color: $on-deep-3;
}

/* ---------- 通行证侧卡：品牌与账号仍在，但不再占据首屏主位 ---------- */
.hero-side {
  margin-top: $sp-5;
}

.pass {
  padding: $sp-4;
  background: $deep-3;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-shell;
}

.pass-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.pass-kicker {
  padding-top: 6rpx;
  font-size: 18rpx;
  letter-spacing: $ls-label;
  color: $on-deep-3;
}

.pass-facts {
  margin-top: $sp-4;
}

.pass-fact {
  display: flex;
  align-items: center;
  gap: $sp-2;
  padding: 14rpx 0;
  border-bottom: 1rpx solid $on-deep-line;
}

.pass-fact:last-child {
  border-bottom: 0;
}

.pass-k {
  flex: 0 0 auto;
  width: 56rpx;
  font-size: 20rpx;
  letter-spacing: $ls-label;
  color: $on-deep-3;
}

.pass-line {
  flex: 1;
  height: 1rpx;
  background: $on-deep-line;
}

.pass-v {
  font-size: $fs-micro;
  color: $on-deep;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pass-status {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.status-dot {
  flex: 0 0 auto;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: $brand-on-deep;
}

.status-dot--off {
  background: $amber-on-deep;
}

.pass-error {
  display: flex;
  align-items: flex-start;
  gap: $sp-2;
  margin-top: $sp-3;
  padding: $sp-2;
  background: $deep;
  border: 1rpx solid $amber-on-deep;
  border-radius: $r-control;
}

.pass-error-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 34rpx;
  height: 34rpx;
  border: 1rpx solid $amber-on-deep;
  border-radius: 50%;
  font-size: 20rpx;
  color: $amber-on-deep;
}

.pass-error-main {
  flex: 1;
  min-width: 0;
}

.pass-error-title {
  display: block;
  font-size: $fs-meta;
  font-weight: 600;
  color: $on-deep;
}

.pass-error-text {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  line-height: 1.4;
  color: $on-deep-3;
  overflow-wrap: break-word;
}

.pass-retry {
  flex: 0 0 auto;
  padding: 8rpx 16rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-pill;
}

.pass-retry-text {
  font-size: 20rpx;
  color: $on-deep;
}

/* 反白按钮：底色用深场白、文字固定用深色，避免深色主题下与 $ink 一起反转 */
.pass-cta {
  display: flex;
  align-items: center;
  gap: $sp-2;
  margin-top: $sp-3;
  padding: $sp-3;
  background: $on-deep;
  border-radius: $r-control;
}

.pass-cta-main {
  flex: 1;
  min-width: 0;
}

.pass-cta-title {
  display: block;
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.25;
  color: $deep;
}

.pass-cta-sub {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $deep;
  opacity: 0.62;
}

.pass-cta-arrow {
  flex: 0 0 auto;
  font-size: $fs-body;
  color: $deep;
}

/* 搜索态：首屏只留「眉标 + 搜索」，其余全部收起，结果紧接着出现 */
.home--search .hero {
  padding-bottom: $sp-4;
}

.home--search .hero-title-wrap,
.home--search .hero-lede,
.home--search .search-hint,
.home--search .hero-stats,
.home--search .hero-side {
  display: none;
}

.home--search .search--hero {
  margin-top: $sp-3;
}

/* ---------- 纸面 ---------- */
.body {
  padding: $sp-5 var(--home-pad) 0;
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

.sec-title {
  display: block;
  margin-top: $sp-1;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: $ls-tight;
  @include mx-gradient-text;
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
  gap: $sp-1;
  margin-top: $sp-2;
}

.cat-card {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  box-sizing: border-box;
  min-height: 120rpx;
  padding: 16rpx 18rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.cat-card--active {
  background: $solid;
  border-color: $solid;
}

.cat-no {
  font-size: 18rpx;
  color: $acc-2;
}

.cat-name {
  font-size: $fs-meta;
  font-weight: 600;
  line-height: 1.25;
  color: $acc-1;
  overflow-wrap: break-word;
}

.cat-count {
  margin-top: auto;
  font-size: 18rpx;
  color: $acc-2;
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
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

/* 用 padding-top 撑 4:3，兼容旧 WebView；图片绝对定位铺满 */
.pick-cover {
  position: relative;
  width: 100%;
  padding-top: 75%;
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

.pick-cover-char {
  font-family: $font-display;
  font-size: 64rpx;
  font-weight: 800;
  color: $ink-4;
}

.pick-cover-char--on-tint {
  color: $on-deep;
}

/* 无图封面：不再留一块空框，改成「首字 + 类目」的文字封面；
 * 高度与有图封面一致，保证同一行卡片对齐，不因缺图塌下去。 */
.pick-cover--text .pick-cover-ph {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  box-sizing: border-box;
  padding: 0 $sp-2;
}

.pick-cover--text .pick-cover-char {
  font-size: 52rpx;
  line-height: 1;
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
  background: $shell;
  border-radius: 6rpx;
  font-size: 16rpx;
  color: $acc-1;
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
  width: 56rpx;
  height: 56rpx;
  background: $solid;
  border-radius: 50%;
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
  line-height: 1.35;
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
  font-size: 36rpx;
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
  padding-top: 75%;
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

/* ---------- 02 通行入口 ---------- */
.entry-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin-top: $sp-3;
}

.entry-card {
  display: flex;
  flex-direction: column;
  min-height: 180rpx;
  padding: $sp-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
}

.entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $sp-2;
}

.entry-no {
  font-size: 20rpx;
  color: $acc-2;
}

.entry-tag {
  font-size: 16rpx;
  letter-spacing: $ls-label;
  color: $acc-1;
}

.entry-title {
  margin-top: $sp-2;
  font-family: $font-display;
  font-size: $fs-body;
  font-weight: 800;
  line-height: 1.25;
  color: $acc-1;
}

.entry-desc {
  margin-top: 6rpx;
  font-size: 20rpx;
  line-height: 1.45;
  color: $ink-3;
}

.entry-arrow {
  margin-top: auto;
  padding-top: $sp-2;
  font-size: $fs-body;
  color: $ink-4;
}

/* ---------- 03 多端覆盖：紧凑单元，已接通 / 规划中仍可区分 ---------- */
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
   768 起：网格加密（分类 4 列、商品 3 列、入口 4 列）；
   1000 起：首屏才切双栏，避免 768 宽度下搜索被侧卡挤窄。
   ========================================================================== */
@media (min-width: 768px) {
  .hero {
    padding: 40px 32px 36px;
  }

  .hero-title {
    font-size: 56px;
  }

  .hero-lede {
    max-width: 560px;
    font-size: 15px;
  }

  .search--hero {
    margin-top: 28px;
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

  .hero-stats {
    margin-top: 32px;
    padding-top: 20px;
  }

  .stat-v {
    font-size: 28px;
  }

  .body {
    padding: 40px 32px 0;
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

  .entry-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .entry-card {
    min-height: 150px;
    padding: 20px;
  }

  .cov-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .sec-title {
    font-size: 28px;
  }

  .catalog-title {
    font-size: 22px;
  }
}

@media (min-width: 1000px) {
  .home {
    --shell-w: 1000px;
    max-width: 1000px;
  }

  .hero {
    padding: 56px 48px 44px;
  }

  /* 双栏：左侧标题 + 搜索 + 数据尺，右侧通行证卡 */
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.8fr);
    column-gap: 56px;
    align-items: start;
  }

  .hero-side {
    margin-top: 0;
  }

  .pass {
    padding: 24px;
  }

  .pass-cta {
    padding: 18px;
  }

  .pass-cta-title {
    font-size: 17px;
  }

  .body {
    padding: 44px 48px 0;
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

  /* 搜索态：侧卡已隐藏，首屏塌成单列，搜索栏独占一行 */
  .home--search .hero-grid {
    display: block;
  }

  .home--search .hero-main {
    max-width: 880px;
  }
}

@media (min-width: 1400px) {
  .home {
    --shell-w: 1320px;
    max-width: 1320px;
  }

  .hero-grid {
    grid-template-columns: minmax(0, 1.7fr) minmax(360px, 0.8fr);
  }
}
</style>
