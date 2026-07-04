// Google OAuth クライアント生成とリダイレクトURI決定（旧 app.js から分離）。
import { google } from 'googleapis';
import type { Request } from 'express';
import { config } from '../config/index.js';

/** リクエストごとに独立した OAuth2Client を生成（共有状態バグ防止）。 */
export function createOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri || config.google.redirectUri,
  );
}

/** 認可URL生成用の共有クライアント（リクエスト処理には createOAuth2Client を使う）。 */
export const authUrlClient = createOAuth2Client();

/**
 * リクエスト元のホスト名に基づいて適切なリダイレクトURIを返す。
 * Cloud Run のカスタムドメイン利用時は X-Forwarded-Host を優先。
 */
export function getRedirectUri(req: Request): string {
  const hostName = req.get('x-forwarded-host') || req.get('host');
  if (hostName === config.google.productionHost) {
    return `https://${config.google.productionHost}/auth/google/callback`;
  }
  return config.google.redirectUri;
}
