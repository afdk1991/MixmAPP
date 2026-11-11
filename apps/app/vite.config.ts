import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

export default defineConfig({
  plugins: [uni()],
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
