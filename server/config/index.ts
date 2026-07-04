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
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  sessionSecret: resolveSessionSecret(),
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:8080'],
  /** SERVICE_URL の明示指定（未指定時はリクエストのホストから算出） */
  serviceUrl: process.env.SERVICE_URL || '',
  /** 静的ファイル（public/）の絶対パス。プロジェクトルートから解決 */
  publicDir: path.resolve(process.cwd(), 'public'),
} as const;

export type AppConfig = typeof config;
