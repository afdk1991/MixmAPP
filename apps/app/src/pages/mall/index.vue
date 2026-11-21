<template>
  <view class="page page--wide mx-ime-pad">
    <mx-bar />
    <!-- 壳层下拉刷新：顶部下拉越过阈值松手后，复用下方同一套分类 + 首屏商品加载 -->
    <mx-pull-refresh :refreshing="shellRefreshing" :scroll-top="pageScrollTop" @refresh="onShellRefresh">
    <view class="head">
      <view class="head-top">
        <view class="head-title">
          <text class="eyebrow">MIXMAPP STORE</text>
          <text class="title">商城</text>
          <text class="count mono">商品 · {{ products.length }} 件</text>
        </view>
        <view class="cart-btn" hover-class="is-press" @tap="goCart">
          <text class="cart-text">购物车</text>
          <text v-if="cartBadgeText" class="cart-badge mono">{{ cartBadgeText }}</text>
          <text class="cart-arrow mono">→</text>
        </view>
      </view>
      <view class="rule head-rule" />

      <view class="search">
        <view class="search-mark">
          <view class="search-lens" />
          <view class="search-handle" />
        </view>
        <input
          :value="keyword"
          class="search-input"
          placeholder="搜商品 / 规格"
          placeholder-class="field-ph"
          confirm-type="search"
          @input="onKeywordInput"
          @confirm="onSearch"
        />
        <view class="search-go" hover-class="is-press" @tap="onSearch">
          <text class="search-go-text">搜索</text>
        </view>
      </view>

      <!-- 分类入口：与源站 /b2b/ 的「商品分类」抽屉同构，左侧滑出，一层层下钻 -->
      <view class="cat-entry" hover-class="is-press" @tap="openDrawer">
        <view class="cat-entry-mark">
          <view class="cat-entry-bar" />
          <view class="cat-entry-bar" />
          <view class="cat-entry-bar" />
        </view>
        <view class="cat-entry-body">
          <text class="cat-entry-title">商品分类</text>
          <text class="cat-entry-path mono">{{ currentPathText }}</text>
        </view>
        <text class="cat-entry-arrow mono">›</text>
      </view>

      <!-- 分类多选（源站 ccc_filter 的 ctgs 维度）：一级类目可多选，多值之间 OR -->
      <view v-if="l1Nodes.length" class="spec-group">
        <text class="spec-label mono">分类</text>
        <scroll-view :scroll-x="true" class="chips chips--spec" :show-scrollbar="false">
          <view class="chip chip--spec" :class="{ 'chip--active': !ctgs.length }" hover-class="is-press" @tap="clearCtgs">
            <text class="chip-label">不限</text>
          </view>
          <view
            v-for="node in l1Nodes"
            :key="`ctg-${node.id}`"
            class="chip chip--spec"
            :class="{ 'chip--active': ctgs.includes(node.id) }"
            hover-class="is-press"
            @tap="toggleCtg(node.id)"
          >
            <text class="chip-label">{{ node.name }}</text>
          </view>
        </scroll-view>
      </view>

      <!-- 筛选：直径/长度/品牌/标准/等级/材质/表面处理/牙别；选项来自商品真实取值，空维度不渲染 -->
      <view v-for="group in filterGroups" :key="group.key" class="spec-group">
        <text class="spec-label mono">{{ group.label }}</text>
        <scroll-view :scroll-x="true" class="chips chips--spec" :show-scrollbar="false">
          <view
            class="chip chip--spec"
            :class="{ 'chip--active': !group.value }"
            hover-class="is-press"
            @tap="selectFilter(group.key, '')"
          >
            <text class="chip-label">不限</text>
          </view>
          <view
            v-for="opt in group.options"
            :key="`${group.key}-${opt}`"
            class="chip chip--spec"
            :class="{ 'chip--active': group.value === opt }"
            hover-class="is-press"
            @tap="selectFilter(group.key, opt)"
          >
            <text class="chip-label mono">{{ opt }}</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <view v-if="loading && products.length === 0" class="grid wrap">
      <view v-for="i in 4" :key="i" class="card">
        <view class="sk cover-sk" />
        <view class="p-info">
          <view class="sk sk-line" />
          <view class="sk sk-line sk-line--short" />
          <view class="sk sk-price" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">没能取到商品</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="refresh">重新加载</view>
    </view>

    <view v-else-if="products.length === 0" class="empty">
      <view class="empty-mark">空</view>
      <text class="empty-title">{{ keyword.trim() ? '没有找到相关商品' : '这个分类还没有商品' }}</text>
      <text class="empty-sub">
        {{ keyword.trim() ? '换个关键词，或浏览其他分类看看。' : '换个分类看看，或稍后再来。' }}
      </text>
    </view>

    <view v-else>
      <view class="list-head">
        <text class="micro mono">{{ products.length }} ITEMS · 按上架顺序</text>
        <!-- 每页条数切换（20/50/100）：无限滚动保留，切换后从第一页重新拉取 -->
        <view class="page-size">
          <text class="page-size-label mono">每页</text>
          <view
            v-for="size in PAGE_SIZE_OPTIONS"
            :key="`ps-${size}`"
            class="page-size-chip"
            :class="{ 'page-size-chip--on': pageSize === size }"
            hover-class="is-press"
            @tap="selectPageSize(size)"
          >
            <text class="page-size-text mono">{{ size }}</text>
          </view>
        </view>
      </view>
      <view class="grid wrap">
        <view
          v-for="product in products"
          :key="product.id"
          class="card"
          hover-class="is-press"
          @tap="openDetail(product)"
        >
          <view class="cover">
            <image
              v-if="coverOf(product) && !isBroken(product.id)"
              class="cover-img"
              :src="coverOf(product)"
              mode="aspectFill"
              lazy-load
              @error="markBroken(product.id)"
            />
            <view v-else class="cover-placeholder" :style="tintOf(product)">
              <view class="cover-ring" />
              <text class="cover-char" :class="{ 'cover-char--on-tint': !!coverTint(product) }">{{ product.title.slice(0, 1) }}</text>
            </view>
            <text v-if="product.brand" class="cover-tag mono">{{ product.brand }}</text>
            <view
              v-if="isInquiryProduct(product)"
              class="cover-add cover-add--inquiry"
              hover-class="is-press"
              @tap.stop="addToCart(product)"
            >
              <text class="cover-add-text mono">询</text>
            </view>
            <view
              v-else-if="!isOutOfStock(product)"
              class="cover-add"
              hover-class="is-press"
              @tap.stop="addToCart(product)"
            >
              <text class="cover-add-text mono">+</text>
            </view>
          </view>
          <view class="p-info">
            <text class="p-name">{{ product.title }}</text>
            <text v-if="cardMeta(product)" class="p-sub">{{ cardMeta(product) }}</text>
            <text v-if="cardSpec(product)" class="p-spec mono">{{ cardSpec(product) }}</text>
            <view class="p-foot">
              <view v-if="isInquiryProduct(product)" class="p-price p-price--inquiry">
                <text class="p-inquiry">询价</text>
                <text class="p-inquiry-sub">联系报价</text>
              </view>
              <view v-else class="p-price">
                <text class="p-cur mono">¥</text>
                <text class="p-amount mono">{{ listPriceText(product) }}</text>
                <text v-if="priceUnitLabel(product)" class="p-unit mono">{{ priceUnitLabel(product) }}</text>
                <text v-if="product.originalPriceFen > 0" class="p-old mono">¥{{ priceText(product.originalPriceFen) }}</text>
              </view>
              <!-- 源站列表关键列：basePrcD3N2 千支面价 / disD2N2 商城折扣 / disbasePrc 折后千支价 -->
              <view v-if="!isInquiryProduct(product)" class="p-thousand">
                <text v-if="baseThousandText(product)" class="p-thousand-item mono">
                  千支面价 ¥{{ baseThousandText(product) }}
                </text>
                <text v-if="discountPctText(product)" class="p-thousand-item mono">
                  {{ discountPctText(product) }}% 折扣
                </text>
                <!-- 未登录：disbasePrc 在源站渲染为「登录可见」，不暴露折后价 -->
                <text
                  v-if="isLoginGated(product)"
                  class="p-thousand-item p-thousand-item--gated mono"
                  hover-class="is-press"
                  @tap.stop="goLogin"
                >
                  折后千支价 {{ LOGIN_VISIBLE_TEXT }}
                </text>
                <text v-else-if="discountThousandText(product)" class="p-thousand-item p-thousand-item--strong mono">
                  折后千支 ¥{{ discountThousandText(product) }}
                </text>
              </view>
              <view class="p-meta">
                <text v-if="packLabel(product)" class="p-pack mono">{{ packLabel(product) }}</text>
                <view v-if="isInquiryProduct(product)" class="status-chip status-chip--inquiry">
                  <text class="status-chip-text mono">询价待报</text>
                </view>
                <!-- 未登录：bpInvQty（库存）与 invStatus（库存状态）同为「登录可见」占位 -->
                <view v-else-if="isLoginGated(product)" class="status-chip status-chip--pending">
                  <text class="status-chip-text mono">库存 · {{ LOGIN_VISIBLE_TEXT }}</text>
                </view>
                <view v-else-if="isOutOfStock(product)" class="status-chip status-chip--oos">
                  <text class="status-chip-text mono">缺货</text>
                </view>
                <view v-else-if="isStockUnconfirmed(product)" class="status-chip status-chip--pending">
                  <text class="status-chip-text mono">货源待确认</text>
                </view>
                <view v-else class="status-chip status-chip--stock">
                  <text class="status-chip-text mono">{{ isBulkStock(product.stock) ? '在售' : `在售 · 余 ${product.stock}` }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="list-foot">
        <text v-if="loadingMore" class="mono foot-note">加载中…</text>
        <text v-else-if="noMore" class="mono foot-note">没有更多商品了</text>
        <text v-else class="mono foot-note">上拉加载更多 · 价格以服务端实时数据为准</text>
      </view>
    </view>
    </mx-pull-refresh>

    <!-- 商品分类抽屉：左侧滑出，标题「商品分类」+ 列表图标，逐级下钻、可返回上一级 -->
    <view v-if="drawerOpen" class="drawer-mask" @tap="closeDrawer" />
    <view class="drawer" :class="{ 'drawer--open': drawerOpen }">
      <view class="drawer-head">
        <view class="drawer-head-mark">
          <view class="cat-entry-bar" />
          <view class="cat-entry-bar" />
          <view class="cat-entry-bar" />
        </view>
        <text class="drawer-head-title">商品分类</text>
      </view>

      <view v-if="drawerStack.length" class="drawer-up" hover-class="is-press" @tap="drawerUp">
        <text class="drawer-up-arrow mono">‹</text>
        <text class="drawer-up-text">返回 {{ drawerParentName }}</text>
      </view>

      <scroll-view :scroll-y="true" class="drawer-body" :show-scrollbar="false">
        <view
          v-if="!drawerStack.length && l1"
          class="drawer-item drawer-item--reset"
          hover-class="is-press"
          @tap="selectFromDrawer({ id: '', name: '全部商品' }, 0)"
        >
          <text class="drawer-mark">›</text>
          <text class="drawer-name">全部商品</text>
        </view>
        <view
          v-if="drawerStack.length"
          class="drawer-item"
          :class="{ 'drawer-item--active': isSubtreeSelected }"
          hover-class="is-press"
          @tap="pickParentAll"
        >
          <text class="drawer-mark">›</text>
          <text class="drawer-name">全部 {{ drawerParentName }}</text>
          <text class="drawer-chev mono">›</text>
        </view>
        <view
          v-for="node in drawerNodes"
          :key="node.id"
          class="drawer-item"
          :class="{ 'drawer-item--active': isActiveNode(node), 'drawer-item--empty': !node.count }"
          hover-class="is-press"
          @tap="onDrawerTap(node)"
        >
          <text class="drawer-mark">›</text>
          <text class="drawer-name">{{ node.name }}</text>
          <text v-if="node.count > 0" class="drawer-count mono">{{ node.count }}</text>
          <text v-else class="drawer-count drawer-count--empty mono">暂无</text>
          <text class="drawer-chev mono">›</text>
        </view>
        <view v-if="drawerLoading" class="drawer-note mono">加载中…</view>
        <view v-else-if="!drawerNodes.length" class="drawer-note mono">这个分类下没有子分类</view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onPageScroll, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import MxPullRefresh from '../../components/mx-pull-refresh/mx-pull-refresh.vue';
import type { MallCategoryNodeDto, MallProductDto, MallSpecOptionsDto } from '../../api/mall';
import {
  breadcrumbLabel,
  fetchMallProducts,
  INQUIRY_NOTICE,
  isBulkStock,
  isInquiryProduct,
  isLoginGated,
  isOutOfStock,
  isStockUnconfirmed,
  listPriceText,
  LOGIN_VISIBLE_TEXT,
  OUT_OF_STOCK_NOTICE,
  packLabel,
  perThousandBaseYuan,
  perThousandDiscountYuan,
  priceText,
  priceUnitLabel,
  specEntries,
  yuanText,
} from '../../api/mall';
import { PAGE_SIZE_OPTIONS as PAGE_SIZE_WHITELIST } from '@mixmapp/contracts';
import { mallApi, productCover, coverTint, placeholderArt } from '../../api/client';
import { cartBadgeText, refreshCartBadge, syncCartBadge } from '../../stores/cart-badge';
import { ROUTES } from '../../routes';
import { goTo, consumeTabQuery } from '../../navigation';

/**
 * 每页条数可选档位（源站列表分页口径）：与 services/api 的 productQuerySchema 共用同一份白名单，
 * 避免前端能选、服务端拒收。
 */
const PAGE_SIZE_OPTIONS = PAGE_SIZE_WHITELIST;
/** 当前每页条数：默认 20，切换后重置分页（无限滚动只改变每次追加的条数） */
const pageSize = ref<number>(20);

/**
 * 分类三层下钻状态：l1/l2/l3 存分类树节点 id（c1:002 / c2:002:007 / c3:007）。
 * 上级切换时清空下级选择，避免残留的深层节点把结果收敛到空集。
 */
const l1 = ref('');
const l2 = ref('');
const l3 = ref('');
const l1Nodes = ref<MallCategoryNodeDto[]>([]);
const l2Nodes = ref<MallCategoryNodeDto[]>([]);
const l3Nodes = ref<MallCategoryNodeDto[]>([]);
/** 筛选：选项全部来自 `/mall/specs` 里真实落库的取值，空维度不渲染。 */
type FilterKey = 'dims' | 'lens' | 'brand' | 'std' | 'grd' | 'mtl' | 'ttt' | 'trts';
const FILTER_FIELDS: Array<{ key: FilterKey; label: string; field: keyof MallSpecOptionsDto }> = [
  { key: 'dims', label: '直径', field: 'dims' },
  { key: 'lens', label: '长度', field: 'lens' },
  { key: 'brand', label: '品牌', field: 'brands' },
  { key: 'std', label: '标准', field: 'stds' },
  { key: 'grd', label: '等级', field: 'grds' },
  { key: 'mtl', label: '材质', field: 'mtls' },
  { key: 'ttt', label: '表面处理', field: 'ttts' },
  // 牙别（源站 ccc_filter 的 trts 维度）：单独成维，不与表面处理合并
  { key: 'trts', label: '牙别', field: 'trts' },
];
const filters = reactive<Record<FilterKey, string>>({
  dims: '',
  lens: '',
  brand: '',
  std: '',
  grd: '',
  mtl: '',
  ttt: '',
  trts: '',
});
const filterOptions = reactive<Record<FilterKey, string[]>>({
  dims: [],
  lens: [],
  brand: [],
  std: [],
  grd: [],
  mtl: [],
  ttt: [],
  trts: [],
});
/** 分类多选（源站 ccc_filter 的 ctgs 维度）：存分类树节点 id，多值 OR，空数组表示不限 */
const ctgs = ref<string[]>([]);

function toggleCtg(id: string): void {
  ctgs.value = ctgs.value.includes(id) ? ctgs.value.filter((v) => v !== id) : [...ctgs.value, id];
  refresh();
}

function clearCtgs(): void {
  if (!ctgs.value.length) return;
  ctgs.value = [];
  refresh();
}
const filterGroups = computed(() =>
  FILTER_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    options: filterOptions[f.key],
    value: filters[f.key],
  })).filter((group) => group.options.length > 0),
);

const keyword = ref('');
const products = ref<MallProductDto[]>([]);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);
const error = ref('');

/** 图片 404 兜底：记录加载失败的 productId，命中后改用文字占位，避免破图。 */
const brokenImages = reactive(new Set<string>());
/** 搜索防抖计时器，避免逐字触发网关请求。 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** 深链带入的旧分类参数，待一级树加载后匹配。 */
let pendingCategory = '';

type TreeNode = { id: string; code: string; name: string; count: number };

function toNode(node: MallCategoryNodeDto): TreeNode {
  return { id: node.id, code: node.code, name: node.name, count: node.count ?? 0 };
}

/* ---------- 商品分类抽屉：与源站 /b2b/ 一致，左侧滑出，逐级下钻 ---------- */
const drawerOpen = ref(false);
const drawerLoading = ref(false);
/** 已下钻的路径；长度即当前展示层级的深度（0 = 一级） */
const drawerStack = ref<Array<{ id: string; name: string }>>([]);
const drawerNodes = ref<TreeNode[]>([]);
/** 子分类缓存：同一节点只取一次，返回上一级不重复请求 */
const childrenCache = new Map<string, TreeNode[]>();

const drawerParentName = computed(() => drawerStack.value[drawerStack.value.length - 1]?.name ?? '');

/** 收敛到当前选中的最深节点；三级 > 二级 > 一级。 */
const activeCat = computed(() => l3.value || l2.value || l1.value || '');

const currentPathText = computed(() => {
  const names: string[] = [];
  const n1 = l1Nodes.value.find((n) => n.id === l1.value);
  if (n1) names.push(n1.name);
  const n2 = l2Nodes.value.find((n) => n.id === l2.value);
  if (n2) names.push(n2.name);
  const n3 = l3Nodes.value.find((n) => n.id === l3.value);
  if (n3) names.push(n3.name);
  return names.length ? names.join(' / ') : '全部商品';
});

/** 当前路径是否已选到「全部 <父节点>」这一层（用于高亮父级整树） */
const isSubtreeSelected = computed(() => {
  const top = drawerStack.value[drawerStack.value.length - 1];
  if (!top) return false;
  const depth = drawerStack.value.length - 1;
  return depth === 0 ? l1.value === top.id && !l2.value : l2.value === top.id && !l3.value;
});

async function childrenOf(id: string): Promise<TreeNode[]> {
  const cached = childrenCache.get(id);
  if (cached) return cached;
  try {
    // includeEmpty：抽屉按源站完整树展示（含 0 商品节点），避免和源站层级对不上
    const list = await mallApi.listCategoryChildren(id || undefined, true);
    const rows = (Array.isArray(list) ? list : [])
      .filter((n) => n && n.id && n.name)
      .map(toNode);
    childrenCache.set(id, rows);
    return rows;
  } catch {
    return [];
  }
}

async function openDrawer(): Promise<void> {
  drawerOpen.value = true;
  if (drawerNodes.value.length) return;
  drawerLoading.value = true;
  try {
    // 打开即定位到「包含当前选中项」的那一层，避免每次从根重新点
    if (l1.value) {
      if (l2.value && l2Nodes.value.some((n) => n.id === l2.value)) {
        drawerStack.value = [{ id: l1.value, name: l1Nodes.value.find((n) => n.id === l1.value)?.name ?? '' }];
        drawerNodes.value = await childrenOf(l1.value);
      } else {
        drawerStack.value = [];
        drawerNodes.value = await childrenOf('');
      }
    } else {
      drawerStack.value = [];
      drawerNodes.value = await childrenOf('');
    }
  } finally {
    drawerLoading.value = false;
  }
}

function closeDrawer(): void {
  drawerOpen.value = false;
}

function isActiveNode(node: TreeNode): boolean {
  const depth = drawerStack.value.length;
  if (depth === 0) return l1.value === node.id;
  if (depth === 1) return l2.value === node.id;
  return l3.value === node.id;
}

/** 选中一个节点：有子节点就继续下钻，末级就落到商品列表并收起抽屉。 */
async function onDrawerTap(node: TreeNode): Promise<void> {
  if (drawerLoading.value) return;
  drawerLoading.value = true;
  try {
    const kids = await childrenOf(node.id);
    if (kids.length) {
      drawerStack.value = [...drawerStack.value, { id: node.id, name: node.name }];
      drawerNodes.value = kids;
      return;
    }
    // 源站存在 0 商品的三级节点：保留在树上（与源站一致），但点进去没有东西，明确提示而不是跳空页
    if (!node.count) {
      uni.showToast({ title: '该分类暂无商品', icon: 'none' });
      return;
    }
    await selectFromDrawer(node, drawerStack.value.length);
  } finally {
    drawerLoading.value = false;
  }
}

/** depth 0=一级 1=二级 2=三级；id 为空表示「全部商品」 */
async function selectFromDrawer(node: { id: string; name: string }, depth: number): Promise<void> {
  closeDrawer();
  if (depth <= 0) await selectLevel1(node.id);
  else if (depth === 1) await selectLevel2(node.id);
  else await selectLevel3(node.id);
}

async function drawerUp(): Promise<void> {
  const stack = drawerStack.value.slice(0, -1);
  drawerStack.value = stack;
  const parentId = stack.length ? stack[stack.length - 1]?.id ?? '' : '';
  drawerLoading.value = true;
  try {
    drawerNodes.value = await childrenOf(parentId);
  } finally {
    drawerLoading.value = false;
  }
}

/** 点击「全部 <父节点>」= 选中当前层级本身（父级整棵树） */
async function pickParentAll(): Promise<void> {
  const top = drawerStack.value[drawerStack.value.length - 1];
  if (!top) return;
  await selectFromDrawer(top, drawerStack.value.length - 1);
}

async function loadLevelOne(): Promise<void> {
  try {
    const list = await mallApi.listCategoryChildren();
    l1Nodes.value = Array.isArray(list) ? list : [];
  } catch {
    l1Nodes.value = [];
  }
  // 深链 ?category= 兼容：既接受节点 id（c1:002）也接受旧短码（002 / eg-screw）
  if (pendingCategory) {
    const hit = l1Nodes.value.find((n) => n.id === pendingCategory || n.code === pendingCategory);
    pendingCategory = '';
    if (hit) void selectLevel1(hit.id);
  }
}

async function loadChildren(parent: string, level: 2 | 3): Promise<void> {
  try {
    const list = await mallApi.listCategoryChildren(parent);
    const rows = Array.isArray(list) ? list : [];
    if (level === 2) l2Nodes.value = rows;
    else l3Nodes.value = rows;
  } catch {
    if (level === 2) l2Nodes.value = [];
    else l3Nodes.value = [];
  }
}

async function loadSpecs(nodeId: string): Promise<void> {
  for (const field of FILTER_FIELDS) {
    filters[field.key] = '';
    filterOptions[field.key] = [];
  }
  if (!nodeId) return;
  try {
    const opts = await mallApi.listSpecOptions(nodeId);
    for (const field of FILTER_FIELDS) {
      const list = opts?.[field.field];
      filterOptions[field.key] = Array.isArray(list) ? list : [];
    }
  } catch {
    for (const field of FILTER_FIELDS) filterOptions[field.key] = [];
  }
}

async function selectLevel1(id: string): Promise<void> {
  if (l1.value === id) return;
  l1.value = id;
  l2.value = '';
  l3.value = '';
  l2Nodes.value = [];
  l3Nodes.value = [];
  await loadSpecs(id);
  if (id) void loadChildren(id, 2);
  refresh();
}

async function selectLevel2(id: string): Promise<void> {
  if (l2.value === id) return;
  l2.value = id;
  l3.value = '';
  l3Nodes.value = [];
  await loadSpecs(id);
  if (id) void loadChildren(id, 3);
  refresh();
}

async function selectLevel3(id: string): Promise<void> {
  if (l3.value === id) return;
  l3.value = id;
  await loadSpecs(id);
  refresh();
}

function selectFilter(key: FilterKey, value: string): void {
  if (filters[key] === value) return;
  filters[key] = value;
  refresh();
}

/**
 * 请求看门狗：接口层已设 15s 超时，这里再加一层兜底。
 * 万一个别端上 uni.request 回调丢失（页面切换/WebView 暂停），没有这层兜底
 * `loading` 会永久停在 true，列表就一直卡在骨架屏、上拉也不会再触发加载。
 */
function withDeadline<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('商品请求超时，请重试')), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function fetchPage(reset: boolean): Promise<void> {
  if (reset) {
    page.value = 1;
    noMore.value = false;
    loading.value = true;
    error.value = '';
  } else {
    if (loadingMore.value || loading.value || noMore.value) return;
    loadingMore.value = true;
  }
  try {
    // 可选登录态：登录后服务端才下发折后千支价与真实库存（源站 disbasePrc / bpInvQty 口径）
    const list = await withDeadline(
      fetchMallProducts({
        cat: activeCat.value || undefined,
        ctgs: ctgs.value.length ? ctgs.value.join(',') : undefined,
        dims: filters.dims || undefined,
        lens: filters.lens || undefined,
        brand: filters.brand || undefined,
        std: filters.std || undefined,
        grd: filters.grd || undefined,
        mtl: filters.mtl || undefined,
        ttt: filters.ttt || undefined,
        trts: filters.trts || undefined,
        keyword: keyword.value.trim() || undefined,
        page: page.value,
        pageSize: pageSize.value,
      }),
      20000,
    );
    // 接口异常或网关返回非 JSON 时保持空数组，避免模板读取 length 时报错白屏
    const rows = Array.isArray(list) ? list : [];
    products.value = reset ? rows : [...products.value, ...rows];
    if (rows.length < pageSize.value) noMore.value = true;
    else page.value += 1;
    // 记录首屏成功时间，供 onShow 节流判断（避免重复 refresh 把列表打回骨架屏）
    if (reset) lastLoadedAt = Date.now();
  } catch (e) {
    if (reset) {
      error.value = e instanceof Error ? e.message : '商品加载失败';
    } else {
      uni.showToast({ title: '下一页加载失败，请重试', icon: 'none' });
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function refresh(): void {
  void fetchPage(true);
}

/** 输入即检索（350ms 防抖），键盘「搜索」/按钮立即检索并取消在途防抖。 */
function inputValue(e: unknown): string {
  const event = e as { detail?: { value?: string }; target?: { value?: string } };
  return event?.detail?.value ?? event?.target?.value ?? '';
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    refresh();
  }, 350);
}

function onKeywordInput(e: unknown): void {
  keyword.value = inputValue(e);
  scheduleSearch();
}

function onSearch(): void {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  refresh();
}

function loadMore(): void {
  void fetchPage(false);
}

/** 切换每页条数：重置分页后重新拉取，已加载的旧条数不保留（避免 20→100 时出现半页重复）。 */
function selectPageSize(size: number): void {
  if (pageSize.value === size) return;
  pageSize.value = size;
  refresh();
}

function coverOf(product: MallProductDto): string {
  return productCover(product);
}

/** 无图自有商品：矢量高清占位封面（SVG data URI），兜底底色取 cover 色值。 */
function tintOf(product: MallProductDto): Record<string, string> {
  const art = placeholderArt(product);
  const tint = coverTint(product);
  if (art) {
    return {
      backgroundImage: `url("${art}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundColor: tint || '#0f9d8f',
    };
  }
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

/** 千支面价文案（元/千支）：源站列表列 basePrcD3N2。 */
function baseThousandText(product: MallProductDto): string {
  return yuanText(perThousandBaseYuan(product));
}

/** 商城折扣文案：源站列 disD2N2，100 也是合法值（无折扣，照常显示）。 */
function discountPctText(product: MallProductDto): string {
  const pct = product.discountPct;
  return pct != null && pct > 0 ? String(pct) : '';
}

/** 折后千支价文案（元/千支）：源站列 disbasePrc = 面价 × 折扣 / 100。 */
function discountThousandText(product: MallProductDto): string {
  return yuanText(perThousandDiscountYuan(product));
}

/** 匿名视角折后价 / 库存均为「登录可见」，点击占位直接去登录页。 */
function goLogin(): void {
  goTo(ROUTES.login);
}

function openDetail(product: MallProductDto): void {
  goTo(`${ROUTES.mallDetail}?id=${encodeURIComponent(product.id)}`);
}

function goCart(): void {
  goTo(ROUTES.cart);
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

// 深链进入时可通过 ?keyword=&category= 预填检索条件；onShow 随后按当前 ref 拉首屏。
onLoad((options) => {
  const q = (options?.['keyword'] as string | undefined) ?? '';
  const c = (options?.['category'] as string | undefined) ?? '';
  keyword.value = q.trim();
  pendingCategory = c.trim();
});

/**
 * 首屏节流：H5 上 onShow 会在切页 / 重进 / 部分滚动场景里重复触发，
 * 之前每次 onShow 都无条件 refresh()，会把首屏反复拉成 loading 态，
 * 列表一进页面就长期停在骨架屏。这里只在「没数据」或「距上次成功拉取超过 60s」时才重拉。
 */
let lastLoadedAt = 0;
const REFRESH_THROTTLE_MS = 60_000;

onShow(() => {
  // switchTab 不带 query：首页经临时通道转交的关键词/分类在这里一次性取回。
  const tq = consumeTabQuery(ROUTES.mall);
  if (tq.keyword) keyword.value = tq.keyword.trim();
  if (tq.category) pendingCategory = tq.category.trim();
  void loadLevelOne();
  if (tq.keyword || tq.category || !lastLoadedAt || Date.now() - lastLoadedAt > REFRESH_THROTTLE_MS) {
    refresh();
  }
  void refreshCartBadge();
});
onReachBottom(() => {
  loadMore();
});

/** 原生下拉刷新：分类与第一页商品同时重取，两者都落定后收起指示器 */
onPullDownRefresh(() => {
  console.info('[mixmapp] onPullDownRefresh 已触发（uni 原生钩子）');
  void Promise.allSettled([loadLevelOne(), fetchPage(true)]).then(() =>
    uni.stopPullDownRefresh(),
  );
});

/** 页面滚动距离：交给壳层下拉刷新判断是否在顶部（跨端不取 document） */
const pageScrollTop = ref(0);
onPageScroll(({ scrollTop }) => {
  pageScrollTop.value = scrollTop;
});

/** 壳层下拉刷新状态：组件回调后真实重跑分类与首屏商品，全部落定后复位收起指示环 */
const shellRefreshing = ref(false);

function onShellRefresh(): void {
  if (shellRefreshing.value) return;
  console.info('[mixmapp] onPullDownRefresh 已触发（壳层手势）');
  shellRefreshing.value = true;
  void Promise.allSettled([loadLevelOne(), fetchPage(true)]).finally(() => {
    shellRefreshing.value = false;
  });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  /* tabBar 页面：为原生底部标签栏 + 安全区 + 软键盘留距离，避免列表底部被遮挡 */
  padding: 0 $sp-3 calc(140rpx + var(--mx-tabbar-h) + var(--mx-safe-bottom) + var(--mx-ime-bottom));
}

/* ---------- 页头：eyebrow + 大标 + 等宽计数 + 发丝线 ---------- */
.head {
  padding: $sp-5 0 $sp-3;
}

.head-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.head-title {
  flex: 1;
  min-width: 0;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: $lh-tight;
  @include mx-gradient-text;
}

.count {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  letter-spacing: $ls-label;
  color: $acc-2;
}

.head-rule {
  margin-top: $sp-3;
}

.cart-btn {
  margin-top: 20rpx;
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 22rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
  flex-shrink: 0;
}

.cart-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-2;
}

.cart-arrow {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.cart-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 8rpx;
  margin-left: 8rpx;
  background: $brand;
  border-radius: $r-pill;
  font-size: 16rpx;
  line-height: 1;
  color: $on-solid;
}

.search {
  display: flex;
  align-items: center;
  margin-top: $sp-4;
  height: 96rpx;
  padding: 0 8rpx 0 26rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.search-mark {
  position: relative;
  width: 36rpx;
  height: 36rpx;
  margin-right: 12rpx;
  flex-shrink: 0;
}

.search-lens {
  position: absolute;
  left: 0;
  top: 0;
  width: 24rpx;
  height: 24rpx;
  border: 2rpx solid $ink-4;
  border-radius: 50%;
}

.search-handle {
  position: absolute;
  right: 0;
  bottom: 2rpx;
  width: 16rpx;
  height: 2rpx;
  background: $ink-4;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  height: 96rpx;
  font-size: $fs-meta;
  color: $ink;
}

.search-go {
  height: 72rpx;
  padding: 0 28rpx;
  border-radius: $r-control;
  background: $solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-go-text {
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $on-solid;
}

/* ---------- 分类 chip：分类用 control 圆角 ---------- */
.chips {
  margin-top: $sp-4;
  white-space: nowrap;
}

/* 二/三级与规格行收紧间距，保持深色主题变量不变 */
.chips--sub {
  margin-top: $sp-2;
}

.chips--spec {
  margin-top: 0;
  flex: 1;
  min-width: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 64rpx;
  padding: 0 24rpx;
  margin-right: 16rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.chip--sub {
  height: 56rpx;
  padding: 0 20rpx;
  margin-right: 12rpx;
}

.chip--spec {
  height: 52rpx;
  padding: 0 18rpx;
  margin-right: 10rpx;
}

.spec-group {
  display: flex;
  align-items: center;
  margin-top: $sp-2;
}

.spec-label {
  flex: 0 0 auto;
  width: 68rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.chip--active {
  background: $brand-soft;
  border-color: transparent;
}

.chip-label {
  font-family: $font-mono;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.chip--active .chip-label {
  color: $brand-deep;
  font-weight: 600;
}

.chip-count {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $acc-2;
}

/* ---------- 商品分类入口 + 左侧抽屉（结构照源站 /b2b/ 的商品分类） ---------- */
.cat-entry {
  display: flex;
  align-items: center;
  margin-top: $sp-4;
  height: 104rpx;
  padding: 0 24rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.cat-entry-mark,
.drawer-head-mark {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 40rpx;
  height: 26rpx;
  margin-right: 18rpx;
  flex-shrink: 0;
}

.cat-entry-bar {
  height: 3rpx;
  border-radius: 2rpx;
  background: $ink-2;
}

.cat-entry-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.cat-entry-title {
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $acc-1;
}

.cat-entry-path {
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-4;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cat-entry-arrow {
  margin-left: 12rpx;
  font-size: 34rpx;
  color: $acc-2;
}

.is-press {
  opacity: 0.7;
}

.drawer-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 900;
  background: rgba(0, 0, 0, 0.55);
}

.drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 901;
  display: flex;
  flex-direction: column;
  width: 78vw;
  max-width: 640rpx;
  padding-top: calc(var(--mx-safe-top) + 20rpx);
  background: $shell;
  box-shadow: 8rpx 0 40rpx rgba(0, 0, 0, 0.35);
  transform: translateX(-100%);
  transition: transform 0.24s ease;
}

.drawer--open {
  transform: translateX(0);
}

.drawer-head {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx 18rpx;
}

.drawer-head-title {
  font-family: $font-display;
  font-size: 40rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: $acc-1;
}

.drawer-up {
  display: flex;
  align-items: center;
  padding: 14rpx 32rpx;
  border-bottom: 1rpx solid $paper-3;
}

.drawer-up-arrow {
  margin-right: 8rpx;
  font-size: 32rpx;
  color: $ink-3;
}

.drawer-up-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.drawer-body {
  flex: 1;
  padding: 4rpx 0 48rpx;
}

.drawer-item {
  display: flex;
  align-items: center;
  padding: 30rpx 32rpx;
  border-bottom: 1rpx solid $paper-3;
}

.drawer-item--active {
  background: $brand-soft;
}

.drawer-mark {
  width: 30rpx;
  font-size: 30rpx;
  line-height: 1;
  color: $brand-deep;
}

.drawer-name {
  flex: 1;
  min-width: 0;
  font-size: 32rpx;
  color: $ink;
}

.drawer-item--active .drawer-name {
  color: $brand-deep;
  font-weight: 700;
}

.drawer-item--reset .drawer-name {
  color: $ink-3;
}

.drawer-count {
  margin: 0 12rpx;
  font-size: $fs-micro;
  color: $acc-2;
}

/* 源站本身 0 商品的节点：仍出现在树上（与源站一致），用「暂无」区分 */
.drawer-count--empty {
  color: $ink-4;
  opacity: 0.7;
}

.drawer-item--empty .drawer-name {
  color: $ink-4;
}

.drawer-chev {
  font-size: 34rpx;
  color: $ink-4;
}

.drawer-note {
  padding: 32rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

/* ---------- 目录索引卡 ---------- */
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $sp-2 0 $sp-3;
}

/* ---------- 每页条数切换（20 / 50 / 100） ---------- */
.page-size {
  display: flex;
  align-items: center;
}

.page-size-label {
  margin-right: 10rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.page-size-chip {
  margin-left: 8rpx;
  padding: 6rpx 16rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.page-size-chip--on {
  background: $brand-soft;
  border-color: transparent;
}

.page-size-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.page-size-chip--on .page-size-text {
  color: $brand-deep;
  font-weight: 600;
}

.wrap {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.card {
  position: relative;
  width: 48.6%;
  margin-bottom: $sp-4;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
  overflow: hidden;
  box-shadow: $shadow-card;
  transition: transform 0.16s ease;
}

/* 卡片顶部彩色细条：青→靛蓝→紫，与标题渐变同源，作为彩色体系的描边装饰 */
.card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 4rpx;
  background: $grad-title;
  z-index: 4;
}

/* ---------- 平板 / 折叠屏展开态：商品网格三栏 ---------- */
@media (min-width: 1000px) {
  .card {
    width: 32%;
  }
}

.cover {
  position: relative;
  width: 100%;
  height: 300rpx;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $paper-2;
  border-bottom: 1rpx solid $paper-3;
}

.cover-img {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.cover-placeholder {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.cover-ring {
  position: absolute;
  width: 210rpx;
  height: 210rpx;
  border-radius: 50%;
  border: 1rpx solid $acc-3;
  opacity: 0.35;
  top: 46rpx;
  left: 50%;
  margin-left: -105rpx;
}

.cover-tag {
  position: absolute;
  left: 20rpx;
  top: 20rpx;
  z-index: 2;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  text-transform: uppercase;
  color: $acc-1;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: 6rpx;
  padding: 4rpx 10rpx;
}

.cover-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 84rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1;
  color: $ink;
}

/* 自有商品无实物图时后端 cover 是品牌色：占位块铺该底色，首字改白。 */
.cover-char--on-tint {
  color: $on-deep;
  opacity: 0.92;
}

.cover-add {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  z-index: 3;
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: $shell;
  border: 1rpx solid $paper-3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-add--inquiry {
  background: $brand-soft;
}

.cover-add-text {
  font-size: 36rpx;
  line-height: 1;
  color: $ink;
}

.p-info {
  padding: $sp-3;
  display: flex;
  flex-direction: column;
  min-height: 176rpx;
}

.p-name {
  font-family: $font-display;
  font-size: 30rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.4;
  color: $acc-2;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.p-sub,
.p-spec {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $acc-6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-spec {
  margin-top: 4rpx;
  color: $ink-4;
}

.p-foot {
  display: block;
  margin-top: auto;
  padding-top: $sp-2;
}

.p-price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

.p-cur {
  font-size: 26rpx;
  color: $acc-4;
  margin-right: 2rpx;
}

.p-amount {
  font-family: $font-mono;
  font-size: 40rpx;
  font-weight: 800;
  color: $acc-4;
}

.p-unit {
  margin-left: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.p-old {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
  text-decoration: line-through;
}

.p-price--inquiry {
  align-items: baseline;
}

.p-inquiry {
  font-size: 36rpx;
  font-weight: 800;
  color: $brand-deep;
}

.p-inquiry-sub {
  margin-left: 10rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.p-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-top: $sp-1;
}

.p-pack {
  font-size: $fs-micro;
  color: $ink-3;
  margin-right: 12rpx;
}

/* 千支口径行：源站 basePrcD3N2 / disD2N2 / disbasePrc 三列，窄屏自动换行 */
.p-thousand {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx 16rpx;
  margin-top: 6rpx;
}

.p-thousand-item {
  font-size: $fs-micro;
  color: $ink-3;
  letter-spacing: 1rpx;
}

/* 折后千支价：登录后主展示项 */
.p-thousand-item--strong {
  color: $brand-deep;
}

/* 未登录占位：可点击去登录 */
.p-thousand-item--gated {
  color: $amber;
  text-decoration: underline;
}

/* 状态 chip：仅状态用 pill 圆角 */
.status-chip {
  display: inline-flex;
  align-items: center;
  height: 40rpx;
  padding: 0 16rpx;
  border-radius: $r-pill;
}

.status-chip--stock {
  background: $brand-soft;
}

.status-chip--stock .status-chip-text {
  /* 浅色底 $brand-deep 实测 4.48 略低于 AA，改用彩色 token（5.25）。 */
  color: $acc-1;
}

.status-chip--oos {
  background: $paper-2;
}

.status-chip--oos .status-chip-text {
  color: $amber;
}

.status-chip--pending {
  background: $paper-2;
}

.status-chip--pending .status-chip-text {
  /* 琥珀在 brand-soft 上仅 3.48，换纸面色底（4.98）。 */
  color: $acc-5;
}

.status-chip--inquiry {
  background: $paper-2;
}

.status-chip--inquiry .status-chip-text {
  color: $ink-2;
}

.status-chip-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
}

/* ---------- 骨架 ---------- */
.cover-sk {
  height: 300rpx;
  border-radius: 0;
}

.sk-line {
  height: 28rpx;
  margin-top: 14rpx;
  width: 82%;
}

.sk-line--short {
  width: 54%;
}

.sk-price {
  height: 32rpx;
  margin-top: 20rpx;
  width: 40%;
}

.list-foot {
  padding: $sp-3 0 $sp-6;
  text-align: center;
}

.foot-note {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}
</style>
