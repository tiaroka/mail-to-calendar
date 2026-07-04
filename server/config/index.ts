// 環境変数を1箇所で読み込み・検証する（起動時 fail-fast）。
// 旧 app.js で散在していた env 参照とリダイレクトURI推測ロジックを集約。

import crypto from 'node:crypto';
import path from 'node:path';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * リダイレクトURIを実行環境に基づいて決定する。
 * - 明示指定（GOOGLE_REDIRECT_URI）があればそれを使う
 * - なければ HOSTNAME からローカル/本番を推測
 */
function computeRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const hostname = process.env.HOSTNAME || 'localhost';
  const port = process.env.PORT || '8080';
  if (hostname === 'localhost') {
    return `http://localhost:${port}/auth/google/callback`;
  }
  return `https://${hostname}/auth/google/callback`;
}

/**
 * SESSION_SECRET は必須。未設定時はランダム生成にフォールバックするが、
 * 本番でこれが起きるとインスタンス間・再起動でセッションが無効化されるため警告する。
 */
function resolveSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  console.warn('WARNING: SESSION_SECRET is not set. Using random secret.');
  return crypto.randomBytes(32).toString('hex');
}

export const config = {
  nodeEnv,
  isProd,
  isTest,
  port: Number(process.env.PORT) || 8080,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: computeRedirectUri(),
    productionHost: process.env.PRODUCTION_HOST || '',
  },
  llm: {
    // .env の LLM_PROVIDER で選択（既定 openai）。単一キーは Secret Manager / .env から。
    provider: (process.env.LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'openai') as
      | 'openai'
      | 'anthropic',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  },
  sessionSecret: resolveSessionSecret(),
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:8080'],
  /** SERVICE_URL の明示指定（未指定時はリクエストのホストから算出） */
  serviceUrl: process.env.SERVICE_URL || '',
  /** 静的ファイル（Viteビルド成果物）の絶対パス。dist/public を配信する */
  publicDir: path.resolve(process.cwd(), 'dist', 'public'),
  session: {
    // 本番、または明示指定時のみ Firestore ストアを使う。
    // ローカル/テストは MemoryStore（外部依存なし・密閉）にフォールバック。
    useFirestore: isProd || process.env.USE_FIRESTORE_SESSIONS === 'true',
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
    collection: process.env.SESSION_COLLECTION || 'sessions',
    // 使用する Firestore データベースID。空なら (default)。
    // 既定DBが Datastore モードのプロジェクトでは、セッション用に別の
    // Native モード名前付きDBを指定する（例: FIRESTORE_DATABASE_ID=sessions）。
    databaseId: process.env.FIRESTORE_DATABASE_ID || '',
  },
} as const;

export type AppConfig = typeof config;
