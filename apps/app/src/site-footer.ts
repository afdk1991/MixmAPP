/**
 * 全站备案页脚（仅 H5）。
 *
 * 项目里没有全站页脚组件，各页各自写尾部文案；用户可见页面里还有几页正在被
 * 其他分支修改，逐页改模板既会漏页也会撞车。这里在 H5 运行时把页脚挂到页面
 * 根节点末尾：登录前（首页 / 登录 / 注册 / 隐私政策）与登录后的页面自动带上，
 * 后台控制台（pages/admin/index）不注入。
 */

/** ICP 备案号：逐字符展示，不得改写或简化。 */
export const ICP_NO = '苏ICP备2025161175号-2';
export const ICP_URL = 'https://beian.miit.gov.cn/';
/** 公安备案号：逐字符展示，不得改写或简化。 */
export const PSB_NO = '苏公网安备32072202010511号';
export const PSB_URL = 'https://beian.mps.gov.cn/#/query/webSearch?code=32072202010511';

const FLAG = 'data-mx-beian';
const ADMIN_ROUTE = 'pages/admin/index';

function isAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, hash } = window.location;
  return `${pathname}${hash}`.includes(ADMIN_ROUTE);
}

/** 页面根节点上的路由串（uni-app H5 会写在 uni-page[data-page] 上）。 */
function routeOf(body: Element): string {
  const page = body.closest('uni-page');
  return page?.getAttribute('data-page') || '';
}

function createLink(text: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'mx-beian-link';
  link.textContent = text;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function createFooter(edge: boolean): HTMLElement {
  const box = document.createElement('div');
  box.className = edge ? 'mx-beian mx-beian--edge' : 'mx-beian';
  box.setAttribute(FLAG, '1');
  // 公安备案通常要求带警徽图标；仓库里没有该图标资源，按纯文字链接处理，不自制图标。
  box.appendChild(createLink(ICP_NO, ICP_URL));
  box.appendChild(createLink(PSB_NO, PSB_URL));
  return box;
}

function syncPage(body: Element): void {
  if (routeOf(body).includes(ADMIN_ROUTE)) return;
  const root = body.firstElementChild;
  if (!root) return;

  const page = root.classList.contains('page')
    ? root
    : (root.querySelector('.page') as Element | null);
  const host = page ?? root;

  const current = body.querySelector(`[${FLAG}]`);
  if (current && current.parentElement === host) return;
  if (current) current.remove();
  // 容器自身没有左右内边距（.halo / 首页通栏 .page）时，由页脚补内边距与底部安全区，
  // 避免文案贴着屏幕边缘。
  const padLeft = parseFloat(window.getComputedStyle(host).paddingLeft) || 0;
  host.appendChild(createFooter(padLeft < 8));
}

function syncAll(): void {
  if (typeof document === 'undefined') return;
  // 开发态后台控制台仍注册在路由里：停在控制台时整页不注入，离开后再补。
  if (isAdminRoute()) {
    document.querySelectorAll(`[${FLAG}]`).forEach((node) => node.remove());
    return;
  }
  document.querySelectorAll('uni-page-body').forEach(syncPage);
}

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    syncAll();
  });
}

/**
 * 启动页脚注入。首屏先同步一次，后续路由切换 / 异步渲染由观察器与 hashchange 兜底。
 * 幂等：同一页面已有页脚时直接返回，观察器不会自激。
 */
export function installBeianFooter(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  syncAll();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', schedule);
  window.addEventListener('load', schedule);
}
