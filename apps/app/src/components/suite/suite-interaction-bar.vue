<template>
  <view class="suite-bar">
    <!-- 点赞 / 收藏 / 评分：都是幂等切换，未登录点击时提示登录 -->
    <view
      class="suite-bar__act"
      :class="{ 'suite-bar__act--on': state.liked }"
      hover-class="is-press"
      role="button"
      :aria-label="state.liked ? '取消点赞' : '点赞'"
      :aria-pressed="state.liked"
      @tap="toggle('like')"
    >
      <text class="suite-bar__icon mono">{{ state.liked ? '★' : '☆' }}</text>
      <text class="suite-bar__num mono">{{ counts.like }}</text>
    </view>

    <view
      class="suite-bar__act"
      :class="{ 'suite-bar__act--on': state.saved }"
      hover-class="is-press"
      role="button"
      :aria-label="state.saved ? '取消收藏' : '收藏'"
      :aria-pressed="state.saved"
      @tap="toggle('save')"
    >
      <text class="suite-bar__icon mono">{{ state.saved ? '◆' : '◇' }}</text>
      <text class="suite-bar__num mono">{{ counts.save }}</text>
    </view>

    <view class="suite-bar__act suite-bar__act--static">
      <text class="suite-bar__icon mono">✎</text>
      <text class="suite-bar__num mono">{{ counts.comment }}</text>
    </view>

    <!-- 评论：展开输入框，提交后即时回显 -->
    <view class="suite-bar__act suite-bar__act--comment" hover-class="is-press" role="button" aria-label="写评论" @tap="openComment">
      <text class="suite-bar__icon mono">＋</text>
      <text class="suite-bar__num">{{ state.commentOpen ? '收起' : '评论' }}</text>
    </view>

    <view v-if="state.commentOpen" class="suite-bar__compose">
      <textarea
        v-model="state.draft"
        class="field field--area suite-bar__textarea"
        placeholder="说说你的看法（最多 2000 字）"
        placeholder-class="field-ph"
        :maxlength="2000"
      />
      <view class="suite-bar__compose-foot">
        <text class="hint">{{ state.draft.length }}/2000</text>
        <view
          class="btn btn--sm btn--primary suite-bar__submit"
          :class="{ 'btn--disabled': state.submitting || !state.draft.trim() }"
          hover-class="is-press"
          role="button"
          aria-label="提交评论"
          @tap="submitComment"
        >
          <text>{{ state.submitting ? '提交中' : '提交' }}</text>
        </view>
      </view>
      <text v-if="state.error" class="suite-bar__error">{{ state.error }}</text>
    </view>

    <!-- 最近 3 条评论：静态内容页也保留真实的社会认同 -->
    <view v-if="recentComments.length" class="suite-bar__recent">
      <view v-for="c in recentComments" :key="c.id" class="suite-bar__recent-item">
        <text class="suite-bar__recent-no mono">{{ c.accountNo || '匿名' }}</text>
        <text class="suite-bar__recent-body">{{ c.body }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type { SuiteInteractionDto, SuiteInteractionListDto } from '@mixmapp/contracts';
import { suiteApi } from '../../api/suite';
import { isLoggedIn } from '../../stores/session';

type Counts = SuiteInteractionListDto['counts'];

/**
 * 条目交互条：点赞 / 收藏 / 评论。
 *
 * 静态内容页也需要真实互动，所以这一层直接对接动态 API；
 * 任何一步失败都只提示、不阻断页面（正文是静态的，不该被接口拖住）。
 */
const props = defineProps<{
  domainId: string;
  entryId: string;
  /** 初始计数（可由服务端预取传入，省一次请求） */
  initial?: Partial<Counts>;
  /** 已登录：未登录时点击会引导登录 */
  signedIn?: boolean;
}>();

const emit = defineEmits<{ needLogin: [] }>();

const counts = reactive<Counts>({
  comment: props.initial?.comment ?? 0,
  like: props.initial?.like ?? 0,
  save: props.initial?.save ?? 0,
  rating: props.initial?.rating ?? 0,
});

const state = reactive({
  liked: false,
  saved: false,
  commentOpen: false,
  draft: '',
  submitting: false,
  error: '',
});

const recentComments = ref<SuiteInteractionDto[]>([]);

async function load(): Promise<void> {
  try {
    const res = await suiteApi.interactions(props.domainId, props.entryId);
    counts.comment = res.counts.comment;
    counts.like = res.counts.like;
    counts.save = res.counts.save;
    counts.rating = res.counts.rating;
    state.liked = res.mine.liked;
    state.saved = res.mine.saved;
    recentComments.value = res.items.filter((i) => i.kind === 'comment').slice(0, 3);
  } catch {
    // 交互读失败不影响正文展示，静默降级为计数 0。
  }
}

watch(
  () => [props.domainId, props.entryId] as const,
  () => {
    void load();
  },
  { immediate: true },
);

async function toggle(kind: 'like' | 'save'): Promise<void> {
  if (!props.signedIn && !isLoggedIn()) {
    emit('needLogin');
    return;
  }
  try {
    const res = await suiteApi.toggleInteraction(props.domainId, props.entryId, kind);
    counts.like = res.counts.like;
    counts.save = res.counts.save;
    if (kind === 'like') state.liked = res.active;
    else state.saved = res.active;
  } catch {
    state.error = '操作没成功，稍后再试一次。';
  }
}

function openComment(): void {
  if (!props.signedIn && !isLoggedIn()) {
    emit('needLogin');
    return;
  }
  state.commentOpen = !state.commentOpen;
}

async function submitComment(): Promise<void> {
  const body = state.draft.trim();
  if (!body || state.submitting) return;
  state.submitting = true;
  state.error = '';
  try {
    const created = await suiteApi.addInteraction({
      domainId: props.domainId,
      entryId: props.entryId,
      kind: 'comment',
      body,
    });
    recentComments.value = [created, ...recentComments.value].slice(0, 3);
    counts.comment += 1;
    state.draft = '';
    state.commentOpen = false;
  } catch {
    state.error = '评论没发出去，检查网络后再试。';
  } finally {
    state.submitting = false;
  }
}
</script>

<style scoped lang="scss">
.suite-bar {
  margin-top: $sp-3;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-3;
}

.suite-bar__act {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  height: 56rpx;
  padding: 0 18rpx;
  margin-right: 12rpx;
  border-radius: $r-control;
  background: $paper-2;
  font-size: $fs-meta;
  color: $ink-3;
}

.suite-bar__act--on {
  background: $brand-soft;
  color: $brand-deep;
}

.suite-bar__act--static {
  opacity: 0.9;
}

.suite-bar__icon {
  font-size: $fs-meta;
  line-height: 1;
}

.suite-bar__num {
  font-size: $fs-micro;
}

.suite-bar__compose {
  margin-top: $sp-3;
}

.suite-bar__textarea {
  min-height: 176rpx;
  font-size: $fs-body;
}

.suite-bar__compose-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $sp-2;
}

.suite-bar__submit {
  min-width: 160rpx;
}

.suite-bar__error {
  display: block;
  margin-top: $sp-2;
  font-size: $fs-meta;
  color: $signal;
}

.suite-bar__recent {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.suite-bar__recent-item {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 6rpx 0;
}

.suite-bar__recent-no {
  flex: 0 0 auto;
  font-size: $fs-micro;
  color: $acc-1;
}

.suite-bar__recent-body {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  color: $ink-2;
  line-height: $lh-body;
}
</style>
