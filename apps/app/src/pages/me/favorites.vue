<template>
  <view class="page">
    <mx-bar title="我的收藏" />
    <view class="head">
      <text class="eyebrow">FAVORITES</text>
      <text class="title">收藏夹</text>
      <text class="sub mono">{{ totalText }}</text>
    </view>

    <!-- 收藏夹切换：默认夹带「默认」角标；切换即重新拉条目 -->
    <scroll-view v-if="folders.length" scroll-x class="folders">
      <view
        v-for="folder in folders"
        :key="folder.id"
        class="folder"
        :class="{ 'folder--on': folder.id === activeId }"
        hover-class="is-press"
        @tap="selectFolder(folder.id)"
      >
        <text class="folder-name">{{ folder.name }}</text>
        <text class="folder-count mono">{{ folder.itemCount }}</text>
        <view v-if="folder.isDefault && !folder.name.includes('默认')" class="folder-flag">
          <text class="folder-flag-text mono">默认</text>
        </view>
      </view>
    </scroll-view>

    <!-- 当前夹操作：设默认 / 复制 / 清空（收藏夹本身始终保留） -->
    <view v-if="activeFolder" class="ops">
      <view
        v-if="!activeFolder.isDefault"
        class="btn btn--ghost btn--sm op"
        hover-class="is-press"
        @tap="askSetDefault"
      >
        设为默认
      </view>
      <view class="btn btn--ghost btn--sm op" hover-class="is-press" @tap="askCopy">复制收藏夹</view>
      <view class="btn btn--ghost btn--sm op" hover-class="is-press" @tap="askClear">
        {{ busy === 'clear' ? '清空中…' : '清空' }}
      </view>
    </view>

    <view v-if="loading" class="loading">
      <view v-for="i in 2" :key="i" class="sheet fav-sk">
        <view class="sk sk-cover" />
        <view class="sk-body">
          <view class="sk sk-line" />
          <view class="sk sk-line sk-short" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">收藏没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="loadAll">重新加载</view>
    </view>

    <view v-else-if="items.length === 0" class="empty">
      <view class="empty-mark">0</view>
      <text class="empty-title">这个收藏夹还是空的</text>
      <text class="empty-sub">去商品详情页点「收藏商品」就会出现在这里。</text>
      <view class="btn btn--deep empty-btn" hover-class="is-press" @tap="goMall">去商城</view>
    </view>

    <view v-else class="list">
      <view v-for="item in items" :key="item.id" class="sheet fav">
        <view class="fav-cover" :style="tintOf(item)" hover-class="is-press" @tap="openDetail(item)">
          <image
            v-if="coverOf(item)"
            class="fav-cover-img"
            :src="coverOf(item)"
            mode="aspectFill"
            lazy-load
            @error="markBroken(coverOf(item))"
          />
          <view v-else class="fav-cover-placeholder">
            <mx-icon name="box" :size="52" tone="ink2" :on-tint="coverTint({ cover: item.cover })" />
          </view>
        </view>
        <view class="fav-body">
          <text class="fav-title" hover-class="is-press" @tap="openDetail(item)">{{ item.title }}</text>
          <view class="fav-foot">
            <text v-if="item.available" class="fav-price mono">¥{{ price(item.priceFen) }}<text v-if="item.unit" class="fav-unit"> / {{ item.unit }}</text></text>
            <text v-else class="fav-off mono">商品已下架</text>
            <view class="fav-remove" hover-class="is-press" @tap="askRemove(item)">
              <text class="fav-remove-text mono">移除</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="items.length" class="foot">
      <text class="micro mono">收藏夹由服务端保存 · 价格以商品页实时价为准</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { FavoriteFolderDto, FavoriteItemDto } from '@mixmapp/contracts';
import { mallApi, productCover, coverTint } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import { showDangerModal } from '../../modal';
import MxIcon from '../../components/mx-icon/mx-icon.vue';

const folders = ref<FavoriteFolderDto[]>([]);
const items = ref<FavoriteItemDto[]>([]);
const activeId = ref('');
const loading = ref(false);
const error = ref('');
/** 正在进行的夹级操作：set-default / copy / clear，用于按钮态与防重 */
const busy = ref('');
/** 取图失败的封面，退回自有占位图标（色值 cover 不能直接塞进 image） */
const broken = ref<Set<string>>(new Set());

const activeFolder = computed<FavoriteFolderDto | undefined>(() =>
  folders.value.find((f) => f.id === activeId.value),
);

const totalText = computed(() => {
  if (!folders.value.length) return 'NO FOLDERS';
  const total = folders.value.reduce((sum, f) => sum + f.itemCount, 0);
  return `${folders.value.length} FOLDERS · ${total} ITEMS`;
});

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 有图用图；无图（cover 是色值或空）退回自有占位图标，与商城列表同口径 */
function coverOf(item: FavoriteItemDto): string {
  const src = productCover(item);
  if (!src) return '';
  return broken.value.has(src) ? '' : src;
}

function markBroken(src: string): void {
  if (!src) return;
  broken.value = new Set(broken.value).add(src);
}

/** 无图商品的占位底色：cover 是十六进制色值时直接用 */
function tintOf(item: FavoriteItemDto): Record<string, string> {
  const tint = coverTint(item);
  return tint ? { background: tint } : {};
}

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

function goMall(): void {
  goTo(ROUTES.mall);
}

function openDetail(item: FavoriteItemDto): void {
  if (!item.available) {
    toast('商品已下架，暂无详情');
    return;
  }
  goTo(`${ROUTES.mallDetail}?id=${encodeURIComponent(item.productId)}`);
}

/** 拉收藏夹列表：首次访问服务端会懒创建「默认收藏夹」 */
async function loadFolders(): Promise<void> {
  const list = await mallApi.listFavoriteFolders();
  folders.value = Array.isArray(list) ? list : [];
  // 保持当前选中；失效时回落到默认夹，再退回第一个
  const stillThere = folders.value.some((f) => f.id === activeId.value);
  if (!stillThere) {
    activeId.value =
      folders.value.find((f) => f.isDefault)?.id ?? folders.value[0]?.id ?? '';
  }
}

async function loadItems(): Promise<void> {
  if (!activeId.value) {
    items.value = [];
    return;
  }
  const list = await mallApi.listFavoriteItems(activeId.value);
  items.value = Array.isArray(list) ? list : [];
}

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    await loadFolders();
    await loadItems();
  } catch (e) {
    const message = e instanceof Error ? e.message : '收藏夹加载失败';
    if (message.includes('登录') || message.includes('未授权')) {
      uni.navigateTo({ url: ROUTES.login });
      return;
    }
    error.value = message;
  } finally {
    loading.value = false;
  }
}

async function selectFolder(folderId: string): Promise<void> {
  if (folderId === activeId.value) return;
  activeId.value = folderId;
  loading.value = true;
  error.value = '';
  try {
    await loadItems();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '收藏条目加载失败';
  } finally {
    loading.value = false;
  }
}

function askRemove(item: FavoriteItemDto): void {
  showDangerModal({
    title: '移除收藏',
    content: `把「${item.title}」移出当前收藏夹？`,
    confirmText: '移除',
    success: (res) => {
      if (res.confirm) void doRemove(item);
    },
  });
}

async function doRemove(item: FavoriteItemDto): Promise<void> {
  try {
    await mallApi.removeFavorite(item.productId, activeId.value);
    items.value = items.value.filter((i) => i.id !== item.id);
    // 同步各夹计数，避免退回列表时角标还是旧值
    await loadFolders();
    toast('已移除');
  } catch (e) {
    toast(e instanceof Error ? e.message : '移除失败');
  }
}

function askSetDefault(): void {
  const folder = activeFolder.value;
  if (!folder || busy.value) return;
  uni.showModal({
    title: '设为默认收藏夹',
    content: `之后收藏的商品会默认进入「${folder.name}」。`,
    confirmText: '设为默认',
    success: (res) => {
      if (res.confirm) void doSetDefault();
    },
  });
}

async function doSetDefault(): Promise<void> {
  if (!activeFolder.value || busy.value) return;
  busy.value = 'set-default';
  try {
    await mallApi.setDefaultFavoriteFolder(activeFolder.value.id);
    await loadFolders();
    toast('已设为默认');
  } catch (e) {
    toast(e instanceof Error ? e.message : '设置失败');
  } finally {
    busy.value = '';
  }
}

function askCopy(): void {
  if (!activeFolder.value || busy.value) return;
  uni.showModal({
    title: '复制收藏夹',
    content: `把「${activeFolder.value.name}」复制一份（含全部条目）？`,
    confirmText: '复制',
    success: (res) => {
      if (res.confirm) void doCopy();
    },
  });
}

async function doCopy(): Promise<void> {
  if (!activeFolder.value || busy.value) return;
  busy.value = 'copy';
  try {
    const created = await mallApi.copyFavoriteFolder(activeFolder.value.id);
    await loadFolders();
    activeId.value = created.id;
    await loadItems();
    toast('已复制');
  } catch (e) {
    toast(e instanceof Error ? e.message : '复制失败');
  } finally {
    busy.value = '';
  }
}

function askClear(): void {
  if (!activeFolder.value || busy.value) return;
  if (activeFolder.value.itemCount === 0) {
    toast('收藏夹已经是空的');
    return;
  }
  showDangerModal({
    title: '清空收藏夹',
    content: `清空「${activeFolder.value.name}」里的 ${activeFolder.value.itemCount} 个商品？收藏夹本身会保留。`,
    confirmText: '清空',
    success: (res) => {
      if (res.confirm) void doClear();
    },
  });
}

async function doClear(): Promise<void> {
  if (!activeFolder.value || busy.value) return;
  busy.value = 'clear';
  try {
    await mallApi.clearFavoriteFolder(activeFolder.value.id);
    items.value = [];
    await loadFolders();
    toast('已清空');
  } catch (e) {
    toast(e instanceof Error ? e.message : '清空失败');
  } finally {
    busy.value = '';
  }
}

// 从商品详情页收藏后返回本页需要看到最新条目，因此用 onShow 而不是 onLoad
onShow(() => {
  void loadAll();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 calc($sp-8 + var(--mx-safe-bottom));
}

.head {
  padding: $sp-5 4rpx $sp-4;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: $lh-tight;
  color: $ink;
}

.sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: $ink-3;
}

/* ---------- 收藏夹 chips ---------- */
.folders {
  white-space: nowrap;
  margin-bottom: $sp-3;
}

.folder {
  display: inline-flex;
  align-items: center;
  height: 72rpx;
  margin-right: 16rpx;
  padding: 0 24rpx;
  border-radius: $r-pill;
  background: $shell;
  box-shadow: $shadow-card;
}

.folder--on {
  background: $brand-deep;
}

.folder-name {
  font-size: $fs-meta;
  color: $ink;
  max-width: 320rpx;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder--on .folder-name {
  color: $on-solid;
}

.folder-count {
  margin-left: 12rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.folder--on .folder-count {
  color: $on-solid;
  opacity: 0.72;
}

.folder-flag {
  margin-left: 12rpx;
  padding: 2rpx 12rpx;
  border-radius: $r-pill;
  background: $brand-soft;
  display: inline-flex;
  align-items: center;
}

.folder--on .folder-flag {
  background: rgba(244, 244, 241, 0.22);
}

.folder-flag-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $brand-deep;
}

.folder--on .folder-flag-text {
  color: $on-solid;
}

/* ---------- 夹操作 ---------- */
.ops {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-bottom: $sp-3;
}

.op {
  min-width: 180rpx;
}

/* ---------- 条目 ---------- */
.fav {
  display: flex;
  padding: $sp-3;
  margin-bottom: $sp-3;
}

.fav-cover {
  width: 160rpx;
  height: 160rpx;
  flex-shrink: 0;
  border-radius: 16rpx;
  overflow: hidden;
  background: $paper-2;
}

.fav-cover-img {
  width: 100%;
  height: 100%;
}

.fav-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fav-body {
  flex: 1;
  min-width: 0;
  margin-left: $sp-3;
  display: flex;
  flex-direction: column;
}

.fav-title {
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.35;
  color: $ink;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
}

.fav-unit {
  margin-left: 6rpx;
  font-size: $fs-micro;
  font-weight: 400;
  color: $ink-4;
}

.fav-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: $sp-2;
}

.fav-price {
  font-size: 32rpx;
  font-weight: 800;
  color: $acc-4;
}

.fav-off {
  font-size: $fs-micro;
  color: $ink-4;
}

.fav-remove {
  padding: 2rpx 0;
  background: transparent;
}

.fav-remove-text {
  font-size: $fs-micro;
  color: $ink-4;
}

/* ---------- 骨架 / 空态 ---------- */
.fav-sk {
  display: flex;
  padding: $sp-3;
  margin-bottom: $sp-3;
  border-radius: $r-card;
}

.sk-cover {
  width: 160rpx;
  height: 160rpx;
  border-radius: 16rpx;
}

.sk-body {
  flex: 1;
  margin-left: $sp-3;
  padding-top: 8rpx;
}

.sk-line {
  height: 26rpx;
  width: 82%;
}

.sk-short {
  width: 44%;
  margin-top: 20rpx;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}

.empty-btn {
  margin-top: $sp-5;
  width: 300rpx;
}

.foot {
  padding: $sp-3 0 $sp-6;
  text-align: center;
}
</style>
