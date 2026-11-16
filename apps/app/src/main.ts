import App from './App.vue';
import { createSSRApp } from 'vue';
// #ifdef H5
import { installBeianFooter } from './site-footer';
import { installScrollButtons } from './site-scroll-buttons';
import { installTheme } from './theme';
// #endif

export function createApp() {
  const app = createSSRApp(App);
  // #ifdef H5
  // 主题先于页面渲染定好（index.html 已同步打标，这里兜底对齐内存状态），避免首屏闪白。
  installTheme();
  installBeianFooter();
  // 浮动滚动按钮组与页脚同层：仅在 H5 注入，不改任何页面模板。
  installScrollButtons();
  // #endif
  return { app };
}
