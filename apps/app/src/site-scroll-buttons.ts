/**
 * 全站右侧浮动滚动按钮组（仅 H5）：一键到底 / 一键回顶。
 *
 * 与 site-footer.ts 同一套做法：不改任何页面模板，在 H5 运行时把按钮组挂到
 * document.body，路由切换时自动补挂并重置状态，页面业务逻辑零改动。
 *
 * 为什么挂在 body 而不是 uni-page-body：
 *  - uni-app H5 切页会整棵替换页面节点，挂在 body 上只需一份、也不用每页补挂；
 *  - 页面转场可能给页面容器加 transform，fixed 子元素会被改写成相对容器定位。
 *
 * 为什么用 window 滚动：uni-app H5 的页面滚动就是文档滚动（uni 运行时自身也是
 * 监听 document 的 scroll 事件、读 scrollingElement），没有第二套内部滚动容器。
 */

/** 注入标记：幂等判断与线上排障用。 */
const FLAG = 'data-mx-scroll-fab';
/** 后台控制台不注入（与备案页脚保持一致）。 */
const ADMIN_ROUTE = 'pages/admin/index';
/** 可滚动高度低于该值时视为「内容不足一屏」，整组不显示。 */
const MIN_SCROLLABLE = 24;
/** 按钮与视口右缘 / 底部固定条之间的间距（px）。 */
const EDGE_GAP = 12;
/** 单枚按钮边长（px）：贴视口的控件不随 rpx 缩放，保证 320px 屏仍有 44px 触控区。 */
const FAB_SIZE = 44;
/** 两枚按钮的纵向间距（px）。 */
const FAB_GAP = 8;
/** 两枚按钮都出现时的整组高度，作为兜底（渲染后改用实际 offsetHeight）。 */
const STACK_HEIGHT = FAB_SIZE * 2 + FAB_GAP;
/** 顶部 / 底部的判定容差，吸收亚像素与移动端地址栏抖动。 */
const EDGE_TOLERANCE = 8;

/** 按钮组根节点（body 上唯一一份）。 */
let root: HTMLDivElement | null = null;
/** 「一键回顶」按钮。 */
let topBtn: HTMLButtonElement | null = null;
/** 「一键到底」按钮。 */
let bottomBtn: HTMLButtonElement | null = null;
/** rAF 合并标记：滚动 / DOM 变更都走同一个节流。 */
let scheduled = false;
/** 底部安全区高度（px），通过探针元素读 env(safe-area-inset-bottom)。 */
let safeBottom = 0;

/** 是否停在开发态后台控制台：该页不注入。 */
function isAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, hash } = window.location;
  return `${pathname}${hash}`.includes(ADMIN_ROUTE);
}

/** 元素是否真实可见（uni 会把非当前页留在 DOM 里但隐藏）。 */
function isShown(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 取当前可见页面的 uni-page-body。
 * 路由切换的瞬间新旧两页可能同时在 DOM 里，倒序取最后一个可见的（新页在栈顶）。
 */
function activePageBody(): Element | null {
  const bodies = Array.from(document.querySelectorAll('uni-page-body'));
  for (let i = bodies.length - 1; i >= 0; i -= 1) {
    const body = bodies[i];
    if (!body) continue;
    const page = body.closest('uni-page') ?? body;
    if (isShown(page)) return body;
  }
  return null;
}

/** 读取底部安全区高度：用一次隐藏探针量 env()，避免在 JS 里硬编码 iPhone 的数值。 */
function readSafeBottom(): number {
  if (!document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

/** 开 / 关整组显示。 */
function setOn(on: boolean): void {
  if (!root) return;
  root.classList.toggle('is-on', on);
}

/** 单独开 / 关某一枚按钮（用 data-off 属性，样式里 display:none）。 */
function setOff(btn: HTMLButtonElement, off: boolean): void {
  if (off) btn.setAttribute('data-off', '');
  else btn.removeAttribute('data-off');
}

/** 目标位置滚动：尊重系统的「减少动态效果」设置。 */
function scrollToEdge(toTop: boolean): void {
  const doc = document.scrollingElement ?? document.documentElement;
  const maxTop = Math.max(0, doc.scrollHeight - window.innerHeight);
  const target = toTop ? 0 : maxTop;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' });
  schedule();
}

/** 创建一枚按钮：箭头 + 两字标签，完整名称放 aria-label / title。 */
function createButton(text: string, arrow: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mx-scroll-fab__btn';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  // 箭头只做视觉指示，屏幕阅读器读 aria-label 的完整名称。
  const arrowEl = document.createElement('span');
  arrowEl.className = 'mx-scroll-fab__arrow';
  arrowEl.setAttribute('aria-hidden', 'true');
  arrowEl.textContent = arrow;
  // 两字标签：44px 见方里放得下，且比图标更不容易被误读。
  const textEl = document.createElement('span');
  textEl.className = 'mx-scroll-fab__text';
  textEl.textContent = text;
  btn.append(arrowEl, textEl);
  btn.addEventListener('click', () => scrollToEdge(text === '回顶'));
  return btn;
}

/** 幂等挂载按钮组：节点被框架移走或首次启动时重建。 */
function ensureRoot(): void {
  if (root && root.isConnected) return;
  root = null;
  topBtn = null;
  bottomBtn = null;
  if (!document.body) return;

  const box = document.createElement('div');
  box.className = 'mx-scroll-fab';
  box.setAttribute(FLAG, '1');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', '页面滚动快捷按钮');
  // 顺序：上行在上一枚、下行在下一枚，与滚动方向对应。
  topBtn = createButton('回顶', '↑', '一键回顶');
  bottomBtn = createButton('到底', '↓', '一键到底');
  box.append(topBtn, bottomBtn);
  document.body.appendChild(box);
  root = box;
}

/** 桌面端贴版心右缘：版心外侧留白够放下按钮时放在版心外，不压正文。 */
function resolveRight(body: Element): number {
  const viewportW = window.innerWidth;
  const page = body.querySelector('.page');
  if (viewportW < 768 || !page) return EDGE_GAP;
  const rect = page.getBoundingClientRect();
  const outer = viewportW - rect.right;
  // 留白至少能容纳「按钮 + 两侧间距」才外置，否则退回视口右缘（常见于 768~1100 窄桌面）。
  return outer >= FAB_SIZE + EDGE_GAP * 2 ? Math.round(outer - FAB_SIZE - 8) : EDGE_GAP;
}

/** 计算底部偏移：先避让底部固定条，再避让站内备案页脚。 */
function resolveBottom(body: Element, right: number, viewportH: number): number {
  // 基础位置：安全区 + 间距。
  let bottom = safeBottom + EDGE_GAP;

  // 底部固定条（tabBar / 结算条 / 操作坞）：取最靠上的那条的顶边作为保留区。
  const fixed: Element[] = [];
  const tabbar = document.querySelector('.uni-tabbar');
  if (tabbar) fixed.push(tabbar);
  body.querySelectorAll('.bar, .dock').forEach((el) => fixed.push(el));

  let reserved = 0;
  for (const el of fixed) {
    const style = window.getComputedStyle(el);
    if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    // 只认真正贴在视口底部的条：height 为 0 或跑在页面中部的都不算。
    if (rect.height < 2 || rect.top > viewportH - 4) continue;
    reserved = Math.max(reserved, viewportH - rect.top);
  }
  bottom = Math.max(bottom, reserved + EDGE_GAP);

  // 页脚避让：按钮与页脚横向相交、且纵向会压住页脚时，整组抬到页脚上方。
  const footer = body.querySelector('.mx-beian');
  if (footer) {
    const rect = footer.getBoundingClientRect();
    // 按钮组实际高度（只显示一枚时是 44，两枚时 96）。
    const stack = root?.offsetHeight || STACK_HEIGHT;
    const fabLeft = window.innerWidth - right - FAB_SIZE;
    const fabTop = viewportH - bottom - stack;
    const inView = rect.width > 0 && rect.bottom > 0 && rect.top < viewportH;
    const horizontal = rect.right > fabLeft;
    if (inView && horizontal && rect.bottom > fabTop) {
      bottom = Math.max(bottom, viewportH - rect.top + EDGE_GAP);
    }
  }

  return Math.round(bottom);
}

/** 主更新：读取当前页滚动状态，决定两枚按钮各自显隐与整组位置。 */
function update(): void {
  ensureRoot();
  if (!root || !topBtn || !bottomBtn) return;

  // 后台控制台不注入。
  const body = isAdminRoute() ? null : activePageBody();
  if (!body) {
    setOn(false);
    return;
  }

  const doc = document.scrollingElement ?? document.documentElement;
  const viewportH = window.innerHeight || doc.clientHeight;
  const scrollTop = Math.max(window.scrollY || doc.scrollTop || 0, 0);
  const maxScroll = doc.scrollHeight - viewportH;

  // 内容不足一屏：整组不出现。
  if (maxScroll < MIN_SCROLLABLE) {
    setOn(false);
    return;
  }

  // 已在顶部不显示「回顶」，已到底不显示「到底」。
  setOff(topBtn, scrollTop <= EDGE_TOLERANCE);
  setOff(bottomBtn, scrollTop >= maxScroll - EDGE_TOLERANCE);

  // 位置每次随视口 / 页脚 / 底部条变化重算，避免换分辨率后压住东西。
  const right = resolveRight(body);
  const bottom = resolveBottom(body, right, viewportH);
  root.style.setProperty('--mx-fab-right', `${right}px`);
  root.style.setProperty('--mx-fab-bottom', `${bottom}px`);
  setOn(true);
}

/** 合并到下一帧执行：滚动与 DOM 变更都会高频触发，只保留最后一次。 */
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    update();
  });
}

/**
 * 路由切换重置：先立刻收起，避免残留上一页的「回顶 / 到底」状态；
 * 下一帧与新页首次渲染后再各算一次（uni 切页后才把滚动位置归零 / 恢复）。
 */
function hardReset(): void {
  setOn(false);
  schedule();
  window.setTimeout(schedule, 120);
}

/**
 * 启动按钮组。首屏先算一次，后续滚动 / 尺寸变化 / 路由切换 / 异步渲染由监听与观察器兜底。
 * 幂等：按钮组已存在时不会重复插入；观察器只看 childList，不会自激。
 */
export function installScrollButtons(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  safeBottom = readSafeBottom();
  update();

  // 滚动（document + window 都挂，兼容不同浏览器把文档滚动事件派发到谁身上）。
  window.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('scroll', schedule, { passive: true });

  // 视口变化：安全区数值可能随横竖屏改变，重新量一次。
  const onViewport = (): void => {
    safeBottom = readSafeBottom();
    schedule();
  };
  window.addEventListener('resize', onViewport);
  window.addEventListener('orientationchange', onViewport);

  // 路由切换：hash 模式走 hashchange，history 模式 / 返回前进走 popstate。
  window.addEventListener('hashchange', hardReset);
  window.addEventListener('popstate', hardReset);
  window.addEventListener('pageshow', hardReset);

  // 页面异步渲染（列表加载、图片撑高）后内容高度会变，重新判断是否可滚动。
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
}
