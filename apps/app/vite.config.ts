import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

/** MIXMAPP_SINGLE_FILE=1 时打成单文件（供只支持单 HTML 的免费托管平台使用）。 */
const singleFile = process.env.MIXMAPP_SINGLE_FILE === '1';

export default defineConfig({
  plugins: [uni()],
  build: singleFile
    ? {
        // 单文件化：把动态 import 合成一个 chunk，小资源直接内联成 data URI
        cssCodeSplit: false,
        assetsInlineLimit: 4096 * 1024,
        rollupOptions: { output: { inlineDynamicImports: true, manualChunks: undefined } },
      }
    : {},
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
