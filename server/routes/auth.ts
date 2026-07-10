import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { authUrlClient, createOAuth2Client, getRedirectUri } from '../services/google.js';

const router = Router();

// A) OAuth 認可URLへリダイレクト
router.get('/auth/google', (req: Request, res: Response) => {
  logger.debug('OAuth authorize', {
    clientIdConfigured: Boolean(config.google.clientId),
    clientSecretConfigured: Boolean(config.google.clientSecret),
    redirectUri: config.google.redirectUri,
  });

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const dynamicRedirectUri = getRedirectUri(req);
  const url = authUrlClient.generateAuthUrl({
    access_type: 'offline',
    // Google は初回同意時しか refresh_token を返さないため、毎回同意画面を出して
    // 確実に refresh_token を取得する（無いとアクセストークン失効後に登録が失敗する）
    prompt: 'consent',
    scope: scopes,
    redirect_uri: dynamicRedirectUri,
  });
  return res.redirect(url);
});

// B) OAuth コールバック
router.get('/auth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    // code が無い場合は Google 側のエラー（access_denied 等）を可視化する
    const oauthError = req.query.error as string | undefined;
    const oauthErrorDesc = req.query.error_description as string | undefined;
    logger.warn('OAuth callback without code', {
      queryKeys: Object.keys(req.query),
      error: oauthError,
      error_description: oauthErrorDesc,
    });
    const detail = oauthError
      ? ` (error: ${oauthError}${oauthErrorDesc ? ` - ${oauthErrorDesc}` : ''})`
      : ' (クエリに code も error もありません)';
    return res.status(400).send(`No code returned from Google${detail}`);
  }
  try {
    const dynamicRedirectUri = getRedirectUri(req);
    const requestOAuth2Client = createOAuth2Client(dynamicRedirectUri);

    const { tokens } = await requestOAuth2Client.getToken({ code });
    requestOAuth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: requestOAuth2Client });
    const userInfo = await oauth2.userinfo.get();

    req.session.googleTokens = tokens;
    req.session.user = {
      email: userInfo.data.email ?? '',
      name: userInfo.data.name ?? undefined,
    };

    return res.redirect('/?auth_success=true');
  } catch (err: any) {
    logger.error('OAuth callback error', { message: err?.message });
    return res.status(500).send('Authentication Error');
  }
});

export default router;
