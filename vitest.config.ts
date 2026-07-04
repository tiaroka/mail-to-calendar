import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // describe / it / expect / vi をグローバルで使えるようにする
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
    // テストを密閉化する。dotenv は既存の環境変数を上書きしないため、
    // ここで先にダミー値を入れておくと .env の実キーは読み込まれず、
    // 誤って実APIを叩くことを防げる。
    env: {
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'test-dummy-key',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      SESSION_SECRET: 'test-session-secret',
    },
  },
});
