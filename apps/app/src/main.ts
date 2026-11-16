import App from './App.vue';
import { createSSRApp } from 'vue';
// #ifdef H5
import { installBeianFooter } from './site-footer';
// #endif

export function createApp() {
  const app = createSSRApp(App);
  // #ifdef H5
  installBeianFooter();
  // #endif
  return { app };
}
