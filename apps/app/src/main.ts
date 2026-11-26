import App from './App.vue';
import { createSSRApp } from 'vue';
// #ifdef H5
import { installBeianFooter } from './site-footer';
import { installScrollButtons } from './site-scroll-buttons';
import { installTheme } from './theme';
import { installSeo, normalizeSeoEntry } from './seo';
// 对外漂亮地址（/mall、/mall/category/x、/mall/detail/<id>）必须在应用读取地址前
// 改写成 uni 内部路由，否则首帧会落到「页面不存在」。replaceState 不增加历史记录。
normalizeSeoEntry();
// #endif

export function createApp() {
  const app = createSSRApp(App);
  // #ifdef H5
  // 主题先于页面渲染定好（index.html 已同步打标，这里兜底对齐内存状态），避免首屏闪白。
  installTheme();
  // 运行期 SEO：按路由维护 title / description / canonical / OG / JSON-LD（仅 H5）。
  installSeo();
  installBeianFooter();
  // 浮动滚动按钮组与页脚同层：仅在 H5 注入，不改任何页面模板。
  installScrollButtons();
  // #endif
  return { app };
}
