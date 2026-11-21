import { nextTick } from 'vue';

/**
 * 危险操作确认弹窗（取消订单 / 移除收藏 / 清空收藏夹等不可逆动作）。
 *
 * 背景：uni.showModal 的 H5 实现不暴露自定义类名，主按钮颜色由行内 style 给出；
 * 全局主题为压住框架后置同权重规则，用 !important 把默认主按钮固定成品牌青
 * （见 styles/theme.scss 的 .uni-modal__btn_primary），行内 confirmColor 会被一并压掉。
 * 这里在弹窗挂载后给根节点挂 `mx-modal--danger` 类，由 theme.scss 的危险态选择器
 * 接管主按钮颜色；颜色取 --mx-danger 令牌，深浅色自适应，页面代码不出现裸色值。
 *
 * 弹窗在 H5 是单例复用：每次关闭（确认 / 取消 / 失败）后摘除危险类，避免下一个普通
 * 确认继承红色。非 H5 端没有 DOM，挂类静默跳过，行为回落到普通 showModal。
 */

const DANGER_CLASS = 'mx-modal--danger';

function modalRoot(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('uni-modal .uni-modal') ?? document.querySelector('uni-modal');
}

function clearDangerClass(): void {
  modalRoot()?.classList.remove(DANGER_CLASS);
}

/** 危险确认：参数与回调透传 uni.showModal，仅额外把弹窗标记为危险态。 */
export function showDangerModal(options: UniApp.ShowModalOptions): void {
  const { success, fail, complete, ...rest } = options;

  uni.showModal({
    ...rest,
    success: (res) => {
      success?.(res);
      clearDangerClass();
    },
    fail: (err) => {
      fail?.(err);
      clearDangerClass();
    },
    complete: (res) => {
      complete?.(res);
      clearDangerClass();
    },
  });

  // 首次调用弹窗是异步挂载（两帧后可见）；复用单例时 DOM 已存在。两帧后挂类，覆盖两种时序。
  void nextTick(() => {
    void nextTick(() => {
      modalRoot()?.classList.add(DANGER_CLASS);
    });
  });
}
