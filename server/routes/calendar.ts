import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { requireLogin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { calendarEventSchema } from '../schemas.js';
import { createOAuth2Client } from '../services/google.js';
import { ensureSeconds } from '../lib/datetime.js';
import { DEFAULT_TIMEZONE } from '../../shared/types.js';

const router = Router();

// Google カレンダーへ直接イベント作成。
// requireLogin で認証を全保護ルートと統一。ログイン済みでもトークンが無い場合は
// 手動チェックで 401 を返す（二段の防御）。
router.post(
  '/api/google-calendar-create',
  requireLogin,
  validateBody(calendarEventSchema),
  async (req: Request, res: Response) => {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const { title, location, description, emailContent, timezone } = req.body ?? {};
    let { startTime, endTime } = req.body ?? {};
    const tokens = req.session.googleTokens;
    if (!tokens) {
      return res.status(401).json({ error: 'Google認証されていません。' });
    }

    const requestOAuth2Client = createOAuth2Client();
    requestOAuth2Client.setCredentials(tokens);
    // アクセストークンが自動リフレッシュされたらセッションへ書き戻す
    // （リフレッシュ応答には refresh_token が含まれないためマージする）
    requestOAuth2Client.on('tokens', (newTokens) => {
      req.session.googleTokens = { ...req.session.googleTokens, ...newTokens };
    });
    const calendar = google.calendar({ version: 'v3', auth: requestOAuth2Client });

    startTime = ensureSeconds(startTime);
    endTime = ensureSeconds(endTime);

    const event = {
      summary: title || '',
      location: location || '',
      description: `${description || ''}\n\n--- Original Email ---\n${emailContent || ''}`,
      start: { dateTime: startTime, timeZone: timezone || DEFAULT_TIMEZONE },
      end: { dateTime: endTime, timeZone: timezone || DEFAULT_TIMEZONE },
    };

    const response = await calendar.events.insert({ calendarId: 'primary', requestBody: event });

    return res.json({
      message: 'Googleカレンダーにイベントを作成しました',
      eventId: response.data.id,
    });
  } catch (err: any) {
    logger.error('Google Calendar Insert Error', { message: err?.message, code: err?.code });
    let userMessage = 'カレンダーへの登録に失敗しました。';
    if (err?.code === 401) {
      // トークン失効はフロントで再ログイン誘導するため 401 で返す
      return res.status(401).json({
        error: '認証の有効期限が切れました。再度ログインしてください。',
        requiresLogin: true,
      });
    } else if (err?.code === 403) {
      userMessage = 'カレンダーへのアクセス権限がありません。';
    } else if (err?.code === 404) {
      userMessage = '指定されたカレンダーが見つかりません。';
    }
    return res.status(500).json({
      error: userMessage,
      ...(!config.isProd && { details: err?.message }),
    });
  }
});

export default router;
