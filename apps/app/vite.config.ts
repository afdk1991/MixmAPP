import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

/** MIXMAPP_SINGLE_FILE=1 时打成单文件（供只支持单 HTML 的免费托管平台使用）。 */
const singleFile = process.env.MIXMAPP_SINGLE_FILE === '1';

export default defineConfig({
  plugins: [uni()],
  // 所有端（H5 / 小程序 / App / Harmony）构建时写入 API 源。
  // H5 部署到静态平台后，还可以用 window.__MIXMAPP_API_BASE__ 在 HTML 里覆盖，无需重新构建。
  // 注意：留空不等于「自动找到后端」——生产态前端会回退到同域相对 `/api/v1`，
  // 只在同域自托管（nginx 反代 /mixmapp/api/v1）下成立；静态托管 / 壳必须由
  // scripts/build-h5*.mjs 注入绝对 API 源，否则请求会打到托管域 / https://localhost。
  define: {
    __MIXMAPP_API_BASE__: JSON.stringify(process.env.MIXMAPP_API_BASE ?? ''),
  },
  build: singleFile
    ? {
        // 单文件化：把动态 import 合成一个 chunk，小资源直接内联成 data URI
        cssCodeSplit: false,
        assetsInlineLimit: 4096 * 1024,
        rollupOptions: { output: { inlineDynamicImports: true, manualChunks: undefined } },
      }
    : {},
  // 仅 dev server（pnpm dev:h5）生效：把 /api 代理到本机 8080，同源免 CORS。
  // 生产构建产物里不会带这个代理；静态托管 / 壳内不能依赖它。
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.MIXMAPP_API_PROXY ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
