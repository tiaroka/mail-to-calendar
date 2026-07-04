// Express アプリの組み立て（旧 app.js の ESM/TS 移植版）。
// Phase 2a: ルートはまだこのファイルにインライン。Phase 2b で server/routes/* へ分割する。
// 起動処理（listen / graceful shutdown）は server/server.ts に分離。

import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import { google } from 'googleapis';
import OpenAI from 'openai';

import { config } from './config/index.js';
import { createICS } from './services/ics.js';
import { ensureSeconds } from './lib/datetime.js';
import { DEFAULT_TIMEZONE } from '../shared/types.js';

const app = express();

// ==================== OAuth クライアント ====================
// 認可URL生成用の共有クライアント（リクエスト処理には createOAuth2Client を使う）
const oauth2Client = new google.auth.OAuth2(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri,
);

// リクエストごとに独立した OAuth2Client を生成（共有状態バグ防止）
function createOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    redirectUri || config.google.redirectUri,
  );
}

/**
 * リクエスト元のホスト名に基づいて適切なリダイレクトURIを返す。
 * Cloud Run のカスタムドメイン利用時は X-Forwarded-Host を優先。
 */
function getRedirectUri(req: Request): string {
  const hostName = req.get('x-forwarded-host') || req.get('host');
  if (hostName === config.google.productionHost) {
    return `https://${config.google.productionHost}/auth/google/callback`;
  }
  return config.google.redirectUri;
}

console.log('Using redirect URI:', config.google.redirectUri);

// ==================== ミドルウェア ====================
// Cloud Run 等リバースプロキシ背後での正しいプロトコル検出用
app.set('trust proxy', true);

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

app.use(
  express.json({
    type: ['application/json', 'application/json; charset=utf-8'],
  }),
);

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.isProd, // 本番ではHTTPS必須
      httpOnly: true, // XSS対策
      sameSite: 'lax', // CSRF対策
      maxAge: 24 * 60 * 60 * 1000, // 24時間
    },
  }),
);

// ==================== ログイン必須ミドルウェア ====================
function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) {
    return res.redirect('/auth/google');
  }
  next();
}

// ==================== OpenAI ====================
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: 30000,
});

// ==================== ページ / 設定 ====================
app.get('/', requireLogin, (req: Request, res: Response) => {
  res.sendFile('index.html', { root: config.publicDir });
});

app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    googleClientId: config.google.clientId,
    serviceUrl: config.serviceUrl || `${req.protocol}://${req.get('host')}`,
  });
});

// ==================== /api/parse (GPT 解析) ====================
// NOTE(Phase 4): OpenAI 呼び出しは service 層へ抽出し、Anthropic 対応と
// 依存注入（テストのモック化）を可能にする。
app.post('/api/parse', requireLogin, async (req: Request, res: Response) => {
  try {
    const { emailContent } = req.body ?? {};
    if (!emailContent) {
      return res.status(400).json({ error: 'No emailContent provided.' });
    }

    const now = new Date();
    const currentDate = now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `あなたはメール本文から予定情報を抽出する有能なアシスタントです。
現在の日付: ${currentDate}（${currentYear}年${currentMonth}月）

重要な指示:
- メール本文に年が書かれていない場合は、現在の日付（${currentYear}年）を基準に、最も近い未来の日付を推測してください
- 例: 現在が${currentMonth}月で、メールに「12月25日」とある場合:
  - ${currentMonth}月より後なら ${currentYear}年12月25日
  - ${currentMonth}月より前なら ${currentYear + 1}年12月25日
- 過去の日付にならないように注意してください
- 日付が曖昧な場合は、常に未来の日付として解釈してください

タイムゾーンの判定:
- メール本文にタイムゾーン情報がある場合は、対応するIANAタイムゾーン名を返してください
  - 標準略称: CET → Europe/Berlin, PST → America/Los_Angeles, EST → America/New_York, GMT → Europe/London
  - UTC/GMTオフセット: UTC+1 → Europe/Berlin, GMT-8 → America/Los_Angeles
  - 自然言語での指示: 「米西太平洋時間」→ America/Los_Angeles, 「バルセロナのタイムゾーン」→ Europe/Madrid
  - 都市名・国名からの推測: 開催場所が海外都市の場合、その都市のタイムゾーンを使用
    例: 「ベルリンのオフィスにて」→ Europe/Berlin, 「サンフランシスコ」→ America/Los_Angeles
- タイムゾーン情報が一切ない場合は Asia/Tokyo を使用してください
- 日時はそのタイムゾーンでのローカル時刻として返してください`,
        },
        { role: 'user', content: emailContent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_event_info',
            description: 'メール本文からイベント情報を抽出する',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'イベントのタイトル' },
                location: { type: 'string', description: '開催場所' },
                startTime: {
                  type: 'string',
                  description: `開始日時（ISO 8601形式 YYYY-MM-DDTHH:mm:ss）。年が省略されている場合は、現在の日付（${currentYear}年${currentMonth}月）を基準に、最も近い未来の日付を使用してください。`,
                },
                endTime: {
                  type: 'string',
                  description: `終了日時（ISO 8601形式 YYYY-MM-DDTHH:mm:ss）。明示的な終了時刻が指定されていない場合は、開始時刻の1時間後を設定してください。年が省略されている場合は、開始日時と同じ年を使用してください。`,
                },
                description: { type: 'string', description: 'イベントの説明' },
                timezone: {
                  type: 'string',
                  description:
                    'イベントのタイムゾーン（IANA形式、例: Asia/Tokyo, Europe/Berlin, America/Los_Angeles）。メール本文にタイムゾーン情報（CET, PST, UTC+9等）や海外都市名があれば対応するIANAタイムゾーンを設定。明示されていない場合はAsia/Tokyoを使用。',
                },
              },
              required: ['title', 'startTime', 'endTime'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_event_info' } },
    });

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: '【エラー】Tool Callの応答が返されませんでした。',
      });
    }

    try {
      const parsedData = JSON.parse(toolCalls[0].function.arguments);
      return res.json({
        title: parsedData.title || '',
        location: parsedData.location || '',
        startTime: parsedData.startTime || '',
        endTime: parsedData.endTime || '',
        description: parsedData.description || '',
        timezone: parsedData.timezone || DEFAULT_TIMEZONE,
      });
    } catch {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: `【JSONパースエラー】Tool Callの応答:\n${toolCalls[0].function.arguments}`,
      });
    }
  } catch (error: any) {
    console.error('OpenAI API Error:', error);
    if (error?.status === 429) {
      return res.status(429).json({
        error: 'APIの利用制限に達しました。しばらく待ってから再試行してください。',
      });
    } else if (error?.status === 401) {
      return res.status(500).json({
        error: 'API設定に問題があります。管理者にお問い合わせください。',
      });
    } else if (error?.status >= 500) {
      return res.status(500).json({
        error: 'AIサービスで一時的な問題が発生しています。しばらく待ってから再試行してください。',
      });
    }
    return res.status(500).json({
      error: 'メール解析中にエラーが発生しました。',
      ...(!config.isProd && { details: error?.message }),
    });
  }
});

// ==================== /api/create-ics (ICS生成) ====================
app.post('/api/create-ics', requireLogin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, location, startTime, endTime, description, emailContent, timezone } =
      req.body ?? {};
    const icsContent = createICS({
      title,
      location,
      startTime,
      endTime,
      description,
      emailContent,
      timezone,
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="event.ics"');
    return res.send(icsContent);
  } catch (error) {
    next(error);
  }
});

// ==================== Google 連携 (OAuth) ====================
// A) 認可URL
app.get('/auth/google', (req: Request, res: Response) => {
  if (!config.isProd) {
    console.log('=== OAuth Debug Info ===');
    console.log('CLIENT_ID:', config.google.clientId ? 'Configured (hidden)' : 'Not configured');
    console.log(
      'CLIENT_SECRET:',
      config.google.clientSecret ? 'Configured (hidden)' : 'Not configured',
    );
    console.log('REDIRECT_URI:', config.google.redirectUri);
    console.log('======================');
  }

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const dynamicRedirectUri = getRedirectUri(req);
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    redirect_uri: dynamicRedirectUri,
  });
  return res.redirect(url);
});

// B) コールバック
app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).send('No code returned from Google');
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
  } catch (err) {
    console.error(err);
    return res.status(500).send('Authentication Error');
  }
});

// C) Google カレンダーにイベント作成
app.post('/api/google-calendar-create', async (req: Request, res: Response) => {
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

// ==================== エラーハンドリング ====================
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.isProd ? 'Something went wrong' : err?.message,
  });
});

export default app;
