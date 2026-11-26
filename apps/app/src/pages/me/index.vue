<template>
  <view class="page mx-ime-pad">
    <mx-bar />

    <view class="page-head">
      <text class="eyebrow">INTERSTELLAR FEDERATION</text>
      <text class="page-title">星际联邦通行证</text>
    </view>

    <block v-if="user">
      <!-- ---------- 深场通行证：页面唯一强视觉块，下沿直接切纸面 ---------- -->
      <view class="pass">
        <view class="pass-foil" />

        <view class="pass-head">
          <mx-logo size="md" tone="light" sub="INTERSTELLAR FEDERATION" />
          <view class="tag tag--dark pass-state" :class="{ 'pass-state--guest': user.isGuest }">
            <text class="pass-state-text mono">{{ user.isGuest ? 'GUEST' : 'CITIZEN' }}</text>
          </view>
        </view>

        <text class="pass-label mono">公民编号 / CITIZEN NO.</text>
        <text class="pass-no mono">{{ user.accountNo }}</text>
        <text class="pass-id mono">数字 ID · {{ user.id }}</text>

        <view class="pass-perf">
          <view class="notch notch--l" />
          <view class="notch notch--r" />
        </view>

        <view class="pass-meta">
          <view class="pass-cell">
            <text class="pass-k mono">持证人</text>
            <text class="pass-v">{{ holderText }}</text>
          </view>
          <view class="pass-cell">
            <text class="pass-k mono">签发方</text>
            <text class="pass-v">MixmAPP 发号中心</text>
          </view>
          <view class="pass-cell">
            <text class="pass-k mono">状态</text>
            <text class="pass-v pass-v--ok">{{ statusText }}</text>
          </view>
          <view class="pass-cell">
            <text class="pass-k mono">有效期</text>
            <text class="pass-v">长期有效</text>
          </view>
        </view>

        <view v-if="refreshError" class="mx-deep-error">
          <text class="mx-deep-error__text mono">资料未能刷新 · {{ refreshError }}</text>
          <view class="mx-deep-error__action" hover-class="is-press" @tap="reload">
            <text class="mx-deep-error__action-text mono">重试</text>
          </view>
        </view>

        <view class="pass-actions">
          <view class="pass-btn" hover-class="is-press" @tap="copyId">
            <text class="pass-btn-text">复制编号</text>
          </view>
          <view class="pass-btn" hover-class="is-press" @tap="reload">
            <text class="pass-btn-text">刷新资料</text>
          </view>
        </view>
        <text class="pass-foot mono">该编号全局唯一，可直接作为登录账号使用</text>
      </view>

      <!-- ---------- 设备与网络（契约 docs/39 §6，仅登录态渲染） ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">DEVICE</text>
          <text class="sec-title">设备与网络</text>
        </view>
        <view class="rule" />
        <view class="row">
          <text class="k">设备号</text>
          <view class="v device-id">
            <text class="device-id-text mono">{{ shortDeviceId(deviceSnapshot?.deviceId) }}</text>
            <text class="device-copy mono" hover-class="is-press" @tap="copyDeviceId">复制</text>
          </view>
        </view>
        <view class="row">
          <text class="k">机型</text>
          <text class="v">{{ deviceSnapshot?.model || '—' }}</text>
        </view>
        <view class="row">
          <text class="k">系统</text>
          <text class="v">{{ deviceOsText || '—' }}</text>
        </view>
        <view class="row">
          <text class="k">IP 地址</text>
          <text class="v device-id-text mono">{{ deviceIpText }}</text>
        </view>
        <view class="row">
          <text class="k">网络类型</text>
          <text class="v">{{ deviceNetworkText }}</text>
        </view>
        <view v-if="deviceSnapshot?.carrier" class="row">
          <text class="k">运营商</text>
          <text class="v">{{ deviceSnapshot.carrier }}</text>
        </view>
        <view class="row row--last">
          <text class="k">采集时间</text>
          <text class="v mono">{{ deviceUpdatedText }}</text>
        </view>
      </view>

      <!-- ---------- 身份 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">IDENTITY</text>
          <text class="sec-title">身份</text>
        </view>
        <view class="rule" />
        <view class="row">
          <text class="k">昵称</text>
          <text class="v">{{ user.nickname }}</text>
        </view>
        <view class="row">
          <text class="k">用户名</text>
          <text class="v">{{ user.username ?? '未设置' }}</text>
        </view>
        <view class="row">
          <text class="k">手机号</text>
          <text class="v mono">{{ user.phone ?? '未绑定' }}</text>
        </view>
        <view class="row">
          <text class="k">邮箱</text>
          <text class="v">{{ user.email ?? '未绑定' }}</text>
        </view>
        <view class="row" :class="{ 'row--last': !user.bindings.length }">
          <text class="k">第三方绑定</text>
          <text class="v">{{ bindingText }}</text>
        </view>
        <view v-if="user.bindings.length" class="bind-actions">
          <text
            v-for="b in user.bindings"
            :key="b"
            class="bind-chip mono"
            hover-class="is-press"
            @tap="unbind(b)"
          >解绑 {{ bindingLabel(b) }}</text>
        </view>
      </view>

      <!-- ---------- 资料编辑 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">PROFILE</text>
          <text class="sec-title">资料编辑</text>
        </view>
        <view class="rule" />

        <view class="avatar-row">
          <view class="avatar">
            <image v-if="avatarPreview" class="avatar-img" :src="avatarPreview" mode="aspectFill" />
            <view v-else class="avatar-mark">
              <mx-icon name="user" :size="56" tone="brand" />
            </view>
          </view>
          <view class="avatar-actions">
            <button class="btn btn--ghost btn--sm btn--block" :loading="avatarUploading" hover-class="is-press" @tap="pickAvatar">
              <text class="btn-text">{{ avatarUploading ? '上传中…' : '更换头像' }}</text>
            </button>
            <text class="hint">JPG / PNG / WebP，≤ 5MB；未配置云存储时落到本机存储回退。</text>
            <text v-if="avatarError" class="mx-field-error">{{ avatarError }}</text>
          </view>
          <input ref="fileInput" type="file" accept="image/*" class="avatar-file" @change="onAvatarPicked" />
        </view>

        <text class="label mt">昵称</text>
        <input
          class="field"
          type="text"
          maxlength="24"
          placeholder="展示昵称（1–24 字）"
          placeholder-class="field-ph"
          confirm-type="done"
          v-model="profileNickname"
          @confirm="saveProfile"
        />
        <text class="label mt">简介</text>
        <textarea
          class="field field--area"
          maxlength="160"
          placeholder="一句话介绍自己（可选）"
          placeholder-class="field-ph"
          v-model="profileBio"
        />
        <text v-if="profileSaved" class="notice-inline">{{ profileSaved }}</text>
        <text v-if="profileError" class="mx-field-error">{{ profileError }}</text>
        <view class="btn btn--deep btn--block mt-l" hover-class="is-press" @tap="saveProfile">
          <text class="btn-text">{{ profileSaving ? '保存中…' : '保存资料' }}</text>
        </view>
      </view>

      <!-- ---------- 账号完善：手机 / 邮箱补绑 ---------- -->
      <view v-if="!user.phone || !user.email" class="sec">
        <view class="sec-head">
          <text class="eyebrow">RECOVERY</text>
          <text class="sec-title">账号完善</text>
        </view>
        <view class="rule" />
        <text class="hint">绑定后可凭手机验证码或邮箱密码找回账号；缺一种找回方式存在登录风险。</text>

        <!-- 手机补绑 -->
        <view v-if="!user.phone" class="bind-block">
          <text class="label mt">手机号</text>
          <input
            class="field"
            type="number"
            maxlength="11"
            placeholder="用于绑定与登录的手机号"
            placeholder-class="field-ph"
            confirm-type="next"
            v-model="bindPhoneInput"
          />
          <view class="code-row">
            <input
              class="field code-input"
              type="number"
              maxlength="6"
              placeholder="6 位验证码"
              placeholder-class="field-ph"
              confirm-type="done"
              v-model="bindPhoneCode"
              @confirm="bindPhoneSubmit"
            />
            <view
              class="code-btn"
              :class="{ 'code-btn--off': bindPhoneCounting || bindPhoneSending }"
              hover-class="is-press"
              @tap="sendBindCode"
            >
              <text class="code-btn-text mono">
                {{ bindPhoneCounting ? `${bindPhoneCountdown}s` : bindPhoneSending ? '发送中' : '获取验证码' }}
              </text>
            </view>
          </view>
          <text v-if="bindPhoneDevCode" class="dev-hint">开发态验证码：{{ bindPhoneDevCode }}（正式环境不显示）</text>
          <text v-if="bindPhoneError" class="mx-field-error">{{ bindPhoneError }}</text>
          <view class="btn btn--ghost btn--block mt-s" hover-class="is-press" @tap="bindPhoneSubmit">
            <text class="btn-text btn-text--dark">{{ bindPhoneSubmitting ? '绑定中…' : '绑定手机号' }}</text>
          </view>
        </view>

        <!-- 邮箱补绑 -->
        <view v-if="!user.email" class="bind-block">
          <text class="label mt">邮箱</text>
          <input
            class="field"
            type="text"
            maxlength="254"
            placeholder="用于绑定与登录的邮箱"
            placeholder-class="field-ph"
            confirm-type="next"
            v-model="bindEmailInput"
          />
          <text class="label mt">账号密码</text>
          <input
            class="field"
            password
            placeholder="校验当前账号密码（至少 8 位，含字母与数字）"
            placeholder-class="field-ph"
            confirm-type="done"
            v-model="bindEmailPassword"
            @confirm="bindEmailSubmit"
          />
          <text v-if="bindEmailError" class="mx-field-error">{{ bindEmailError }}</text>
          <view class="btn btn--ghost btn--block mt-s" hover-class="is-press" @tap="bindEmailSubmit">
            <text class="btn-text btn-text--dark">{{ bindEmailSubmitting ? '绑定中…' : '绑定邮箱' }}</text>
          </view>
        </view>
      </view>

      <!-- ---------- 资产 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">ASSETS</text>
          <text class="sec-title">资产</text>
        </view>
        <view class="rule" />
        <view class="row">
          <text class="k">通行证公民编号</text>
          <text class="v v--mono mono">{{ user.accountNo }}</text>
        </view>
        <view class="row">
          <text class="k">数字 ID</text>
          <text class="v v--mono mono">{{ user.id }}</text>
        </view>
        <view class="row row--last">
          <text class="k">注册时间</text>
          <text class="v mono">{{ createdText }}</text>
        </view>
      </view>

      <!-- ---------- 游客升级 ---------- -->
      <view v-if="user.isGuest" class="sec upgrade">
        <view class="sec-head">
          <text class="eyebrow">UPGRADE</text>
          <text class="sec-title">升级为正式账号</text>
        </view>
        <view class="rule" />
        <text class="hint">补设用户名与密码后，换设备也能用「用户名 + 密码」登录。</text>
        <text class="label mt">用户名</text>
        <input
          class="field"
          type="text"
          maxlength="20"
          placeholder="用户名（2–20 个字符，中文/字母/数字/下划线）"
          placeholder-class="field-ph"
          confirm-type="next"
          v-model="upUsername"
        />
        <text class="label mt">密码</text>
        <input
          class="field"
          password
          placeholder="密码（至少 8 位，含字母与数字）"
          placeholder-class="field-ph"
          confirm-type="done"
          v-model="upPassword"
          @confirm="upgradeGuest"
        />
        <text class="hint mt-s">不得使用管理员、官方、政府机关等名称。</text>
        <text v-if="upError" class="mx-field-error">{{ upError }}</text>
        <view class="btn btn--deep btn--block mt-l" hover-class="is-press" @tap="upgradeGuest">
          <text class="btn-text">{{ upgrading ? '提交中…' : '设置用户名与密码' }}</text>
        </view>
      </view>

      <!-- ---------- 入口 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">ENTRIES</text>
          <text class="sec-title">入口</text>
        </view>
        <view class="rule" />
        <!-- 借鉴电商/社区个人页的「四宫格入口」：高频购物动作先做成磁贴，
             低频设置仍保留为下面的列表行，两类信息的密度分开。 -->
        <view class="tile-grid">
          <view class="tile" hover-class="is-press" @tap="go(ROUTES.mall)">
            <view class="tile-glyph">
              <mx-icon name="bag" :size="30" tone="brand" />
            </view>
            <text class="tile-label">去商城</text>
            <text class="tile-desc">挑商品 · 看分类</text>
          </view>
          <view class="tile" hover-class="is-press" @tap="go(ROUTES.cart)">
            <view class="tile-glyph">
              <mx-icon name="cart" :size="30" tone="brand" />
            </view>
            <text class="tile-label">购物车</text>
            <text class="tile-desc">已选商品与结算</text>
            <text v-if="cartBadgeText" class="tile-badge mono">{{ cartBadgeText }}</text>
          </view>
          <view class="tile" hover-class="is-press" @tap="go(ROUTES.orders)">
            <view class="tile-glyph">
              <mx-icon name="receipt" :size="30" tone="brand" />
            </view>
            <text class="tile-label">通行证订单</text>
            <text class="tile-desc">下单后看进度</text>
            <text v-if="orderBadgeText" class="tile-badge mono">{{ orderBadgeText }}</text>
          </view>
          <view class="tile" hover-class="is-press" @tap="go(ROUTES.favorites)">
            <view class="tile-glyph">
              <mx-icon name="bookmark" :size="30" tone="brand" />
            </view>
            <text class="tile-label">收藏夹</text>
            <text class="tile-desc">商品与分类整理</text>
            <text v-if="favoriteBadgeText" class="tile-badge mono">{{ favoriteBadgeText }}</text>
          </view>
        </view>

        <view v-if="aiLive" class="link-row" hover-class="is-press" @tap="go(ROUTES.assistant)">
          <text class="link-title">智能助手</text>
          <text class="link-desc">通用 AI 对话（开发态回显）</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view v-if="adminVisible" class="link-row" hover-class="is-press" @tap="go(ROUTES.admin)">
          <text class="link-title">管理后台</text>
          <text class="link-desc">渠道注册 · 合并审计 · 目录导入</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.suite)">
          <text class="link-title">业务套件</text>
          <text class="link-desc">办公 · 财税 · 医疗等十三类行业工具</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.legalPrivacy)">
          <text class="link-title">隐私政策与权限说明</text>
          <text class="link-desc">收集范围 · 权限用途 · 你的权利</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row link-row--last" hover-class="is-press" @tap="go(ROUTES.about)">
          <text class="link-title">关于与能力</text>
          <text class="link-desc">能力矩阵与版本</text>
          <text class="link-arrow mono">→</text>
        </view>
      </view>

      <view class="logout" hover-class="is-press" @tap="doLogout">
        <text class="logout-text">退出登录</text>
      </view>
    </block>

    <block v-else>
      <view class="guest">
        <text class="eyebrow">NO PASS</text>
        <text class="guest-title">未领取通行证</text>
        <text class="guest-lede">登录已有通行证，或注册即签发星际联邦通行证，并分配唯一的 MixmAPP 公民编号。</text>
      </view>

      <view class="guest-actions">
        <view class="btn btn--deep btn--block" hover-class="is-press" @tap="go(ROUTES.login)">
          <text class="btn-text">登录已有通行证</text>
        </view>
        <view class="btn btn--ghost btn--block mt-s" hover-class="is-press" @tap="go(ROUTES.register)">
          <text class="btn-text btn-text--dark">创建新的通行证</text>
        </view>
      </view>

      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">BROWSE</text>
        </view>
        <view class="rule" />
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.mall)">
          <text class="link-title">去商城</text>
          <text class="link-desc">商品 · 结算 · 订单</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.suite)">
          <text class="link-title">业务套件</text>
          <text class="link-desc">办公 · 财税 · 医疗等十三类行业工具</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.login)">
          <text class="link-title">设备与网络</text>
          <text class="link-desc">登录后查看设备与网络</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.legalPrivacy)">
          <text class="link-title">隐私政策与权限说明</text>
          <text class="link-desc">收集范围 · 权限用途 · 你的权利</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row link-row--last" hover-class="is-press" @tap="go(ROUTES.about)">
          <text class="link-title">关于与能力</text>
          <text class="link-desc">能力矩阵与版本</text>
          <text class="link-arrow mono">→</text>
        </view>
      </view>
    </block>

    <!-- ---------- 显示与外观：三态主题切换（登录/未登录都可见） ---------- -->
    <view class="sec">
      <view class="sec-head">
        <text class="eyebrow">APPEARANCE</text>
        <text class="sec-title">显示与外观</text>
      </view>
      <view class="rule" />
      <view class="theme-opts" role="radiogroup" aria-label="主题模式">
        <view
          v-for="opt in THEME_OPTIONS"
          :key="opt.key"
          class="theme-opt"
          :class="{ 'theme-opt--on': themePref === opt.key }"
          hover-class="is-press"
          role="radio"
          :aria-checked="themePref === opt.key ? 'true' : 'false'"
          @tap="chooseTheme(opt.key)"
        >
          <text class="theme-opt-label">{{ opt.label }}</text>
        </view>
      </view>
      <text class="hint theme-hint mt">{{ themeHint }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { OAuthProviderId } from '@mixmapp/contracts';
import { session, logout, refreshProfile, applySession } from '../../stores/session';
import { cartBadgeText, clearCartBadge, refreshCartBadge } from '../../stores/cart-badge';
import { meApi, mallApi, authApi, ApiError, providerLive, readAdminToken, uploadImageBlob, mediaUrl, deviceApi, type DeviceContextDto } from '../../api/client';
import { getDeviceSnapshot, networkTypeLabel, type DeviceSnapshot } from '../../device';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import {
  getSystemTheme,
  getThemePref,
  setThemePref,
  subscribeSystemTheme,
  type ThemeMode,
  type ThemePref,
} from '../../theme';
import MxLogo from '../../components/mx-logo/mx-logo.vue';
import MxIcon from '../../components/mx-icon/mx-icon.vue';

/* 主题三态：默认「跟随系统」，与历史行为一致；手动选择由 theme.ts 持久化。 */
const THEME_OPTIONS: Array<{ key: ThemePref; label: string }> = [
  { key: 'auto', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
];
const themePref = ref<ThemePref>(getThemePref());
const systemTheme = ref<ThemeMode>(getSystemTheme());
const themeHint = computed(() => {
  if (themePref.value === 'light') return '始终使用浅色，不再跟随系统。';
  if (themePref.value === 'dark') return '始终使用深色，不再跟随系统。';
  return systemTheme.value === 'dark' ? '跟随系统 · 当前系统为深色。' : '跟随系统 · 当前系统为浅色。';
});
function chooseTheme(next: ThemePref): void {
  setThemePref(next);
  themePref.value = next;
}

/** AI 能力已装配（含 dev 回退）才展示助手入口；off 时隐藏。 */
const aiLive = computed(() => providerLive('ai'));

/** 已配置过后台令牌才在通行证页露出后台入口；未配置时走关于页隐藏手势进入。 */
const adminVisible = computed(() => Boolean(readAdminToken()));

// ===== 头像上传 =====
const avatarUploading = ref(false);
const avatarError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const avatarPreview = computed(() => (user.value?.avatarUrl ? mediaUrl(user.value.avatarUrl) : ''));

function pickAvatar(): void {
  avatarError.value = '';
  fileInput.value?.click();
}

async function onAvatarPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    avatarError.value = '请选择图片文件';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    avatarError.value = '图片不能超过 5MB';
    return;
  }
  if (avatarUploading.value) return;
  avatarUploading.value = true;
  avatarError.value = '';
  try {
    const { publicUrl } = await uploadImageBlob(file, 'avatar');
    await meApi.update({ avatarUrl: publicUrl });
    await refreshProfile();
    uni.showToast({ title: '头像已更新', icon: 'none' });
  } catch (e) {
    avatarError.value = e instanceof ApiError ? e.message : '头像上传失败，请稍后重试';
  } finally {
    avatarUploading.value = false;
    if (input) input.value = '';
  }
}
let stopSystemTheme = (): void => {};

onMounted(() => {
  themePref.value = getThemePref();
  systemTheme.value = getSystemTheme();
  stopSystemTheme = subscribeSystemTheme((next) => {
    systemTheme.value = next;
  });
});

onUnmounted(() => {
  stopSystemTheme();
});

const user = computed(() => session.user);
/** 手机号脱敏：138****8000，未绑定时不展示占位，避免通行证上出现「未绑定」这种后台口径。 */
const maskedPhone = computed(() => {
  const phone = user.value?.phone;
  if (!phone) return '';
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
});
const holderText = computed(() => {
  if (!user.value) return '';
  return maskedPhone.value ? `${user.value.nickname} · ${maskedPhone.value}` : user.value.nickname;
});
const statusText = computed(() => (user.value?.isGuest ? '有效 · 游客' : '有效'));
const refreshError = ref('');

// ===== 订单 / 收藏磁贴角标：服务端摘要口径，未登录归零 =====
const orderCount = ref(0);
const favoriteCount = ref(0);
const badgeText = (n: number): string => {
  const v = Math.max(0, Math.round(n));
  if (v <= 0) return '';
  return v >= 100 ? '99+' : String(v);
};
const orderBadgeText = computed(() => badgeText(orderCount.value));
const favoriteBadgeText = computed(() => badgeText(favoriteCount.value));

async function loadEntryBadges(): Promise<void> {
  try {
    const [orders, favs] = await Promise.all([
      mallApi.orderSummary().catch(() => null),
      mallApi.favoriteSummary().catch(() => null),
    ]);
    orderCount.value = orders?.total ?? 0;
    favoriteCount.value = favs?.total ?? 0;
  } catch {
    orderCount.value = 0;
    favoriteCount.value = 0;
  }
}

// ===== 设备与网络（契约 docs/39 §5/§6） =====
const deviceSnapshot = ref<DeviceSnapshot | null>(null);
const deviceContext = ref<DeviceContextDto | null>(null);
const deviceReporting = ref(false);
const deviceFailed = ref(false);

/** 系统展示值：osName + osVersion；缺版本号时只显示系统名。 */
const deviceOsText = computed(() => {
  const s = deviceSnapshot.value;
  if (!s) return '';
  return s.osVersion ? `${s.osName} ${s.osVersion}` : s.osName;
});

/** IP 只取服务端响应；上报中显示「获取中」，失败显示「不可用」，不用本地编造值。 */
const deviceIpText = computed(() => {
  if (deviceContext.value?.ip) return deviceContext.value.ip;
  if (deviceReporting.value) return '获取中';
  return deviceFailed.value ? '不可用' : '—';
});

const deviceNetworkText = computed(() =>
  networkTypeLabel(deviceSnapshot.value?.networkType ?? 'none'),
);

const deviceUpdatedText = computed(() => {
  const at = deviceContext.value?.updatedAt;
  if (!at) return '—';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
});

/** 本地取快照 → 上报服务端 → 用响应里的 ip / updatedAt 回填；失败不阻塞页面。 */
async function loadDeviceContext(): Promise<void> {
  const snapshot = getDeviceSnapshot();
  deviceSnapshot.value = snapshot;
  deviceContext.value = null;
  deviceFailed.value = false;
  deviceReporting.value = true;
  try {
    deviceContext.value = await deviceApi.reportContext(snapshot);
  } catch {
    // 未登录 / 接口失败：保留本地快照字段，IP 与采集时间走占位文案
    deviceContext.value = null;
    deviceFailed.value = true;
  } finally {
    deviceReporting.value = false;
  }
}

/** 设备号只在中段省略展示，完整值仍由「复制」拿到，避免 UUID 在行尾折断成两行 */
function shortDeviceId(id?: string): string {
  if (!id) return '—';
  return id.length <= 22 ? id : `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function copyDeviceId(): void {
  const id = deviceSnapshot.value?.deviceId;
  if (!id) return;
  uni.setClipboardData({
    data: id,
    success: () => uni.showToast({ title: '设备号已复制', icon: 'success' }),
  });
}
const createdText = computed(() =>
  user.value ? new Date(user.value.createdAt).toLocaleString() : '',
);
const BINDING_LABEL: Record<string, string> = {
  wechat: '微信',
  wechat_mp: '微信公众号',
  qq: 'QQ',
  weibo: '微博',
  alipay: '支付宝',
  douyin: '抖音',
  dingtalk: '钉钉',
  wecom: '企业微信',
  apple: 'Apple',
  google: 'Google',
  facebook: 'Facebook',
  github: 'GitHub',
  gitee: 'Gitee',
};

function bindingLabel(key: string): string {
  return BINDING_LABEL[key] ?? key;
}
const bindingText = computed(() => {
  if (!user.value) return '';
  const list = user.value.bindings;
  if (!list.length) return '暂无';
  return list.map((b) => BINDING_LABEL[b] ?? b).join(' / ');
});
const upUsername = ref('');
const upPassword = ref('');
const upError = ref('');
const upgrading = ref(false);

// ===== 资料编辑（昵称 / 简介） =====
const profileNickname = ref('');
const profileBio = ref('');
const profileSaving = ref(false);
const profileError = ref('');
const profileSaved = ref('');

// ===== 手机补绑 =====
const bindPhoneInput = ref('');
const bindPhoneCode = ref('');
const bindPhoneDevCode = ref('');
const bindPhoneSending = ref(false);
const bindPhoneCounting = ref(false);
const bindPhoneCountdown = ref(0);
const bindPhoneSubmitting = ref(false);
const bindPhoneError = ref('');

// ===== 邮箱补绑 =====
const bindEmailInput = ref('');
const bindEmailPassword = ref('');
const bindEmailSubmitting = ref(false);
const bindEmailError = ref('');

/** 用当前账号资料回填资料表单；刷新后保持表单与通行证一致。 */
function syncProfileForm(): void {
  if (!user.value) return;
  profileNickname.value = user.value.nickname;
  profileBio.value = user.value.bio ?? '';
}

function go(url: string): void {
  goTo(url);
}

function copyId(): void {
  if (!user.value) return;
  uni.setClipboardData({
    data: user.value.accountNo,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  });
}

/** 解绑前二次确认；服务端会拒绝「解绑后没有任何登录方式」的操作。 */
function unbind(provider: string): void {
  uni.showModal({
    title: '解绑确认',
    content: `确定解绑 ${bindingLabel(provider)}？解绑后将不能用它登录。`,
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await meApi.unbindOAuth(provider as OAuthProviderId);
        await refreshProfile();
        uni.showToast({ title: '已解绑', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e instanceof ApiError ? e.message : '解绑失败', icon: 'none' });
      }
    },
  });
}

async function reload(): Promise<void> {
  try {
    await refreshProfile();
    refreshError.value = '';
    syncProfileForm();
    uni.showToast({ title: '已刷新', icon: 'none' });
  } catch (e) {
    refreshError.value = e instanceof ApiError ? e.message : '网络异常';
    uni.showToast({ title: '刷新失败，请重新登录', icon: 'none' });
  }
}

async function upgradeGuest(): Promise<void> {
  if (upgrading.value) return;
  upError.value = '';
  upgrading.value = true;
  try {
    await meApi.bindUsername(upUsername.value.trim(), upPassword.value);
    await refreshProfile();
    uni.showToast({ title: '已升级为正式账号', icon: 'none' });
  } catch (e) {
    upError.value = e instanceof ApiError ? e.message : '设置失败，请稍后重试';
  } finally {
    upgrading.value = false;
  }
}

async function saveProfile(): Promise<void> {
  if (profileSaving.value) return;
  profileError.value = '';
  profileSaved.value = '';
  const nickname = profileNickname.value.trim();
  if (!nickname) {
    profileError.value = '昵称不能为空';
    return;
  }
  profileSaving.value = true;
  try {
    await meApi.update({ nickname, bio: profileBio.value.trim() });
    await refreshProfile();
    syncProfileForm();
    profileSaved.value = '资料已保存';
  } catch (e) {
    profileError.value = e instanceof ApiError ? e.message : '保存失败，请稍后重试';
  } finally {
    profileSaving.value = false;
  }
}

async function sendBindCode(): Promise<void> {
  if (bindPhoneCounting.value || bindPhoneSending.value) return;
  if (!/^1[3-9]\d{9}$/.test(bindPhoneInput.value)) {
    bindPhoneError.value = '请输入正确的手机号';
    return;
  }
  bindPhoneSending.value = true;
  bindPhoneError.value = '';
  try {
    const res = await authApi.requestSmsCode(bindPhoneInput.value, 'bind');
    if (res.devCode) bindPhoneDevCode.value = res.devCode;
    bindPhoneCounting.value = true;
    bindPhoneCountdown.value = 60;
    const timer = setInterval(() => {
      bindPhoneCountdown.value -= 1;
      if (bindPhoneCountdown.value <= 0) {
        clearInterval(timer);
        bindPhoneCounting.value = false;
      }
    }, 1000);
  } catch (e) {
    bindPhoneError.value = e instanceof ApiError ? e.message : '验证码发送失败';
  } finally {
    bindPhoneSending.value = false;
  }
}

async function bindPhoneSubmit(): Promise<void> {
  if (bindPhoneSubmitting.value) return;
  bindPhoneError.value = '';
  if (!/^1[3-9]\d{9}$/.test(bindPhoneInput.value)) {
    bindPhoneError.value = '请输入正确的手机号';
    return;
  }
  if (!/^\d{6}$/.test(bindPhoneCode.value)) {
    bindPhoneError.value = '验证码为 6 位数字';
    return;
  }
  bindPhoneSubmitting.value = true;
  try {
    const res = await meApi.bindPhone(bindPhoneInput.value, bindPhoneCode.value);
    // 手机号归属其他账号时会触发合并：返回主账号资料与新令牌，必须换用新令牌。
    await applySession(res.user, res.tokens);
    uni.showToast({ title: res.merged ? '已合并到主账号' : '手机号已绑定', icon: 'none' });
  } catch (e) {
    bindPhoneError.value = e instanceof ApiError ? e.message : '绑定失败，请稍后重试';
  } finally {
    bindPhoneSubmitting.value = false;
  }
}

async function bindEmailSubmit(): Promise<void> {
  if (bindEmailSubmitting.value) return;
  bindEmailError.value = '';
  const email = bindEmailInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    bindEmailError.value = '邮箱格式不正确';
    return;
  }
  if (bindEmailPassword.value.length < 8) {
    bindEmailError.value = '密码至少 8 位，需包含字母与数字';
    return;
  }
  bindEmailSubmitting.value = true;
  try {
    await meApi.bindEmail(email, bindEmailPassword.value);
    await refreshProfile();
    uni.showToast({ title: '邮箱已绑定', icon: 'none' });
  } catch (e) {
    bindEmailError.value = e instanceof ApiError ? e.message : '绑定失败，请稍后重试';
  } finally {
    bindEmailSubmitting.value = false;
  }
}

async function doLogout(): Promise<void> {
  await logout();
  clearCartBadge();
  orderCount.value = 0;
  favoriteCount.value = 0;
  uni.showToast({ title: '已退出', icon: 'none' });
}

onShow(() => {
  void refreshCartBadge();
  if (session.user) {
    void refreshProfile()
      .then(() => { refreshError.value = ''; syncProfileForm(); })
      .catch((e) => { refreshError.value = e instanceof ApiError ? e.message : '网络异常'; });
    void loadDeviceContext();
    void loadEntryBadges();
  } else {
    orderCount.value = 0;
    favoriteCount.value = 0;
    deviceSnapshot.value = null;
    deviceContext.value = null;
    deviceFailed.value = false;
    deviceReporting.value = false;
  }
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  /* tabBar 页面：为原生底部标签栏 + 安全区 + 软键盘留距离 */
  padding: $sp-4 $sp-3 calc(140rpx + var(--mx-tabbar-h) + var(--mx-safe-bottom) + var(--mx-ime-bottom));
}

/* ---------- 深场通行证 ---------- */
.pass {
  position: relative;
  overflow: hidden;
  padding: $sp-4;
  background:
    radial-gradient(130% 100% at 92% -16%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 56%),
    radial-gradient(90% 80% at 0% 110%, rgba(244, 244, 241, 0.05), rgba(244, 244, 241, 0) 60%),
    linear-gradient(152deg, $deep 0%, $deep-2 58%, $deep-3 128%);
  border: 1rpx solid $on-deep-line;
  border-radius: $r-shell $r-shell 0 0;
}

.pass-foil {
  position: absolute;
  top: -40%;
  left: 0;
  width: 30%;
  height: 180%;
  background: linear-gradient(90deg, rgba(143, 233, 221, 0), rgba(143, 233, 221, 0.1), rgba(143, 233, 221, 0));
  animation: foil 9s ease-in-out 1s infinite;
  pointer-events: none;
}

.pass-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.pass-state {
  border-radius: $r-pill;
}

.pass-state--guest {
  border-color: $amber-on-deep;
}

.pass-state--guest .pass-state-text {
  color: $amber-on-deep;
}

.pass-state-text {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-2;
}

.pass-label {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: $sp-6;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-3;
}

.pass-no {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 10rpx;
  font-size: $fs-h3;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
  color: $acc-on-deep-1;
  word-break: break-all;
}

.pass-id {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep-3;
  word-break: break-all;
}

.pass-perf {
  position: relative;
  height: 1rpx;
  margin: $sp-4 (-$sp-4) $sp-3;
  border-top: 1rpx dashed $on-deep-line;
}

.notch {
  position: absolute;
  top: -13rpx;
  width: 26rpx;
  height: 26rpx;
  border-radius: 50%;
  background: $paper;
}

.notch--l {
  left: -13rpx;
}

.notch--r {
  right: -13rpx;
}

.pass-meta {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  row-gap: $sp-3;
}

.pass-cell {
  flex: 1 1 50%;
  min-width: 0;
  max-width: 50%;
  padding-right: 16rpx;
  box-sizing: border-box;
}

.pass-cell:nth-child(even) {
  padding-right: 0;
}

.pass-v--ok {
  color: $brand-on-deep;
}

.pass-k {
  display: block;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-3;
}

.pass-v {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: 1.35;
  color: $on-deep;
  overflow: hidden;
}

.pass-actions {
  position: relative;
  z-index: 2;
  display: flex;
  margin-top: $sp-4;
}

.pass-btn {
  height: 68rpx;
  padding: 0 26rpx;
  margin-right: 14rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-control;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pass-btn-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep;
}

.pass-foot {
  position: relative;
  z-index: 2;
  display: block;
  max-width: 74%;
  margin-top: $sp-3;
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $on-deep-3;
}

/* ---------- 分节（身份 / 资产 / 入口） ---------- */
.sec {
  margin-top: $sp-5;
}

.sec-head {
  display: block;
  margin-bottom: $sp-2;
}

.sec-title {
  display: block;
  margin-top: 8rpx;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.25;
  color: $ink;
}

.rule {
  height: 1rpx;
  background: $paper-3;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.row--last {
  border-bottom: none;
}

.bind-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  padding: 0 0 18rpx;
}

.bind-chip {
  padding: 8rpx 18rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  font-size: $fs-micro;
  color: $ink-3;
  background: $shell;
}

.k {
  flex-shrink: 0;
  margin-right: $sp-3;
  font-size: $fs-micro;
  color: $ink-3;
}

.v {
  flex: 1;
  font-size: $fs-meta;
  line-height: 1.5;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.v--mono {
  font-size: $fs-micro;
  line-height: 1.45;
  letter-spacing: 0;
  color: $ink-3;
}

/* ---------- 设备与网络 ---------- */
.device-id {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14rpx;
}

.device-id-text {
  user-select: text;
  -webkit-user-select: text;
  word-break: break-all;
}

.device-copy {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  flex-shrink: 0;
  font-size: $fs-micro;
  color: $acc-2;
}

/* ---------- 升级 ---------- */
.upgrade {
  .hint {
    margin-top: 12rpx;
  }
}

.mt {
  margin-top: $sp-3;
}

.mt-s {
  margin-top: 16rpx;
}

.mt-l {
  margin-top: $sp-4;
}

.btn-text {
  font-size: $fs-meta;
  font-weight: 600;
  letter-spacing: 2rpx;
  /* 跟随按钮底色：deep 为反白，ghost 为墨色，避免白字落在白底上 */
  color: inherit;
}

.btn-text--dark {
  color: $acc-2;
}

/* ---------- 头像上传 ---------- */
.avatar-row {
  display: flex;
  align-items: center;
  gap: $sp-3;
  margin-top: $sp-3;
}

.avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.avatar-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: $brand-soft;
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-actions {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.avatar-file {
  display: none;
}

/* ---------- 四宫格入口：借鉴电商/社区个人页的磁贴 ---------- */
.tile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $sp-2;
  margin: $sp-3 0 $sp-4;
}

.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: $sp-3;
  background: $shell;
  border-radius: $r-card;
  box-shadow: $shadow-card;
}

.tile-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  margin-bottom: 6rpx;
  background: $brand-soft;
  border-radius: 18rpx;
}

.tile-label {
  font-size: $fs-meta;
  font-weight: 700;
  line-height: 1.3;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-desc {
  font-size: $fs-micro;
  line-height: 1.4;
  color: $ink-3;
}

.tile-badge {
  position: absolute;
  right: 18rpx;
  top: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32rpx;
  height: 32rpx;
  padding: 0 10rpx;
  background: $brand-deep;
  border-radius: $r-pill;
  font-size: 16rpx;
  line-height: 1;
  color: $on-solid;
}

/* ---------- 入口行：发丝线分隔，不叠卡片；标题独占一行，说明落到第二行 ---------- */
.link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-2;
}

.link-row--last {
  border-bottom: none;
}

.link-title {
  grid-column: 1;
  grid-row: 1;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 700;
  letter-spacing: $ls-tight;
  color: $ink;
  min-width: 0;
}

.link-desc {
  grid-column: 1 / -1;
  grid-row: 2;
  margin-top: 6rpx;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
  text-align: left;
}

.link-arrow {
  grid-column: 2;
  grid-row: 1;
  margin-left: 14rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.link-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 8rpx;
  margin-left: $sp-3;
  background: $brand;
  border-radius: $r-pill;
  font-size: 16rpx;
  line-height: 1;
  color: $on-solid;
}

/* ---------- 显示与外观：三态分段选择 ---------- */
.theme-opts {
  display: flex;
  gap: 12rpx;
  margin-top: $sp-3;
}

.theme-opt {
  flex: 1 1 0;
  min-width: 0;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

/* 选中态沿用全站的实心反白按钮：浅色墨黑底浅字、深色浅底深字，两套主题都 >=10:1 */
.theme-opt--on {
  background: $solid;
  border-color: $solid;
}

.theme-opt-label {
  font-size: $fs-meta;
  line-height: 1;
  color: $ink-2;
}

.theme-opt--on .theme-opt-label {
  font-weight: 600;
  color: $on-solid;
}

/* 说明文案：默认 .hint 用的 ink-3 在浅色纸面上只有 4.43:1，低于 AA；
 * 这里单独提到 ink-2（浅色 11.7:1 / 深色 10.8:1），不影响全站其它 hint。 */
.theme-hint {
  color: $ink-2;
}

/* ---------- 退出 ---------- */
.logout {
  margin-top: $sp-5;
  padding: $sp-3;
  text-align: center;
}

.logout-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $signal;
}

/* ---------- 账号完善表单 ---------- */
.bind-block {
  margin-top: $sp-3;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-2;
}

.code-row {
  display: flex;
  align-items: center;
  margin-top: $sp-2;
}

.code-input {
  flex: 1;
}

.code-btn {
  margin-left: 14rpx;
  height: 96rpx;
  padding: 0 24rpx;
  border-radius: $r-control;
  background: $solid;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.code-btn--off {
  background: $paper-3;
}

.code-btn--off .code-btn-text {
  color: $ink-3;
}

.code-btn-text {
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $on-solid;
}

.dev-hint {
  display: block;
  margin-top: 14rpx;
  font-size: $fs-micro;
  color: $amber;
}

.notice-inline {
  display: block;
  margin-top: 14rpx;
  font-size: $fs-meta;
  color: $brand-deep;
}

/* ---------- 未登录（纸面） ---------- */
.guest {
  padding: $sp-5 0 $sp-3;
}

.guest-title {
  display: block;
  margin-top: $sp-3;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.25;
  @include mx-gradient-text;
}

.guest-lede {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

.guest-actions {
  margin-top: $sp-4;
}

/* 窄屏通行证编号降一级，避免 24 位编号被折断 */
@media (max-width: 420px) {
  .pass-no {
    font-size: 36rpx;
  }
}
</style>
