import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { config } from '../config/index.js';
import { createOAuth2Client } from '../services/google.js';
import { ensureSeconds } from '../lib/datetime.js';
import { DEFAULT_TIMEZONE } from '../../shared/types.js';

const router = Router();

// Google カレンダーへ直接イベント作成。
// NOTE(Phase 3): 現状は requireLogin を通さず手動トークンチェックのみ（挙動不変）。
// Phase 3 で requireLogin を適用し全保護ルートの認証を統一する。
router.post('/api/google-calendar-create', async (req: Request, res: Response) => {
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
    console.error('Google Calendar Insert Error:', err);
    let userMessage = 'カレンダーへの登録に失敗しました。';
    if (err?.code === 401) {
      userMessage = '認証の有効期限が切れました。再度ログインしてください。';
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
