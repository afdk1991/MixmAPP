import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'db/migrate': 'src/db/migrate.ts', 'module-api': 'src/module-api.ts' },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: true,
  sourcemap: false,
  // workspace 包随 API 一起打包，线上 release 只依赖第三方 npm 依赖
  noExternal: ['@mixmapp/ids', '@mixmapp/contracts'],
});
