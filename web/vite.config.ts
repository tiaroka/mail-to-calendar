import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// web/ をルートにビルドし、成果物を dist/public へ出力する。
// サーバー（server/app.ts）は express.static で dist/public を配信する。
export default defineConfig({
  root: here,
  build: {
    outDir: resolve(here, '../dist/public'),
    emptyOutDir: true,
  },
  // 開発時（vite dev）は API/認証をローカルのサーバー（8080）へプロキシする。
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
});
