require('dotenv').config();
const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const cors = require('cors');
const session = require('express-session');
const { google } = require('googleapis');
const { verifyIdToken } = require('./verify-token'); // JWT検証用ファイル

// ==================== 1) Expressアプリ生成 ====================
const app = express();

// ==================== 2) 環境変数 (Google API) ====================
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PRODUCTION_HOST = process.env.PRODUCTION_HOST || '';

// リダイレクトURIを実行環境に基づいて設定
let REDIRECT_URI;
if (process.env.GOOGLE_REDIRECT_URI) {
  // 環境変数で明示的に指定されている場合はそれを使用
  REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
} else {
  // 環境変数がない場合はホスト名をベースに推測
  const hostname = process.env.HOSTNAME || 'localhost';
  const port = process.env.PORT || 8080;
  if (hostname === 'localhost') {
    REDIRECT_URI = `http://localhost:${port}/auth/google/callback`;
  } else {
    // Cloudデプロイの場合はHTTPS
    REDIRECT_URI = `https://${hostname}/auth/google/callback`;
  }
}

console.log('Using redirect URI:', REDIRECT_URI);

// OAuthクライアント作成（認可URL生成用のみ。リクエスト処理にはcreateOAuth2Clientを使用）
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// リクエストごとに独立したOAuth2Clientを生成（共有状態バグ防止）
function createOAuth2Client(redirectUri) {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri || REDIRECT_URI);
}

// Cloud Run等リバースプロキシ背後での正しいプロトコル検出用
app.set('trust proxy', true);

// ==================== 3) ミドルウェア設定 ====================

// CORS
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:8080'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// JSONボディ (utf-8)
app.use(express.json({
  type: ['application/json', 'application/json; charset=utf-8']
}));

// SESSION_SECRETのフォールバック処理
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  const crypto = require('crypto');
  console.warn('WARNING: SESSION_SECRET is not set. Using random secret.');
  return crypto.randomBytes(32).toString('hex');
})();

// セッション管理（セキュリティオプション強化）
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // 本番ではHTTPS必須
    httpOnly: true,  // XSS対策
    sameSite: 'lax', // CSRF対策
    maxAge: 24 * 60 * 60 * 1000  // 24時間
  }
}));

// ===================== ここで express.static(...) は使わない =====================
// app.use(express.static(path.join(__dirname, 'public')));

// ==================== 4) ヘルパー関数 ====================

/**
 * リクエスト元のホスト名に基づいて適切なリダイレクトURIを返す
 * Cloud Runでカスタムドメインを使用する場合、X-Forwarded-Hostを優先的に使用
 */
function getRedirectUri(req) {
  const hostName = req.get('x-forwarded-host') || req.get('host');

  if (hostName === PRODUCTION_HOST) {
    return `https://${PRODUCTION_HOST}/auth/google/callback`;
  }
  return REDIRECT_URI;
}

// ==================== 5) ログイン必須ミドルウェア ====================
function requireLogin(req, res, next) {
  // セッションに user が無ければ Google OAuth に誘導
  if (!req.session.user) {
    return res.redirect('/auth/google');
  }
  next();
}

// ==================== 6) "/" ルート: ログイン必須 ====================
app.get('/', requireLogin, (req, res) => {
  // ログイン済みなら public/index.html を返す
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 7) OpenAI 初期化 ====================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  timeout: 30000  // 30秒タイムアウト
});

// ==================== 8) クライアント設定エンドポイント ====================
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: CLIENT_ID,
    serviceUrl: process.env.SERVICE_URL || `${req.protocol}://${req.get('host')}`
  });
});

// ==================== 9) 認証必須の例: /secured ====================
app.get('/secured', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.replace(/^Bearer\s+/, '');
    if (!idToken) {
      return res.status(401).send('Missing token');
    }
    const payload = await verifyIdToken(idToken);
    // OK
    return res.send(`Hello, ${payload.email}`);
  } catch (err) {
    console.error(err);
    return res.status(401).send('Invalid or expired token');
  }
});

// ==================== 10) /api/parse (GPT 解析) ====================
app.post('/api/parse', requireLogin, async (req, res, next) => {
  try {
    const { emailContent } = req.body;
    if (!emailContent) {
      return res.status(400).json({ error: "No emailContent provided." });
    }

    // 現在の日付を取得
    const now = new Date();
    const currentDate = now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `あなたはメール本文から予定情報を抽出する有能なアシスタントです。
現在の日付: ${currentDate}（${currentYear}年${currentMonth}月）

重要な指示:
- メール本文に年が書かれていない場合は、現在の日付（${currentYear}年）を基準に、最も近い未来の日付を推測してください
- 例: 現在が${currentMonth}月で、メールに「12月25日」とある場合:
  - ${currentMonth}月より後なら ${currentYear}年12月25日
  - ${currentMonth}月より前なら ${currentYear + 1}年12月25日
- 過去の日付にならないように注意してください
- 日付が曖昧な場合は、常に未来の日付として解釈してください`
        },
        { role: "user", content: emailContent }
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_event_info",
          description: "メール本文からイベント情報を抽出する",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "イベントのタイトル"
              },
              location: {
                type: "string",
                description: "開催場所"
              },
              startTime: {
                type: "string",
                description: `開始日時（ISO 8601形式 YYYY-MM-DDTHH:mm:ss）。年が省略されている場合は、現在の日付（${currentYear}年${currentMonth}月）を基準に、最も近い未来の日付を使用してください。`
              },
              endTime: {
                type: "string",
                description: `終了日時（ISO 8601形式 YYYY-MM-DDTHH:mm:ss）。明示的な終了時刻が指定されていない場合は、開始時刻の1時間後を設定してください。年が省略されている場合は、開始日時と同じ年を使用してください。`
              },
              description: {
                type: "string",
                description: "イベントの説明"
              }
            },
            required: ["title", "startTime", "endTime"]
          }
        }
      }],
      tool_choice: { type: "function", function: { name: "extract_event_info" } }
    });

    // Tool Calls使用時のレスポンス処理
    const toolCalls = response.choices[0].message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: '【エラー】Tool Callの応答が返されませんでした。'
      });
    }

    try {
      const parsedData = JSON.parse(toolCalls[0].function.arguments);
      return res.json({
        title: parsedData.title || '',
        location: parsedData.location || '',
        startTime: parsedData.startTime || '',
        endTime: parsedData.endTime || '',
        description: parsedData.description || ''
      });
    } catch (err) {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: `【JSONパースエラー】Tool Callの応答:\n${toolCalls[0].function.arguments}`
      });
    }

  } catch (error) {
    console.error('OpenAI API Error:', error);

    // エラーの種類に応じてユーザーフレンドリーなメッセージを返す
    if (error.status === 429) {
      return res.status(429).json({
        error: 'APIの利用制限に達しました。しばらく待ってから再試行してください。'
      });
    } else if (error.status === 401) {
      return res.status(500).json({
        error: 'API設定に問題があります。管理者にお問い合わせください。'
      });
    } else if (error.status >= 500) {
      return res.status(500).json({
        error: 'AIサービスで一時的な問題が発生しています。しばらく待ってから再試行してください。'
      });
    }

    return res.status(500).json({
      error: 'メール解析中にエラーが発生しました。',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
});

// ==================== 11) /api/create-ics (ICS生成) ====================
app.post('/api/create-ics', requireLogin, (req, res, next) => {
  try {
    const { title, location, startTime, endTime, description, emailContent } = req.body;
    const icsContent = createICS(title, location, startTime, endTime, description, emailContent);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="event.ics"');
    return res.send(icsContent);

  } catch (error) {
    next(error);
  }
});

function createICS(title, location, startTime, endTime, description, emailContent) {
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = require('crypto').randomUUID() + '@example.com';

  const dtStart = formatICSDate(startTime);
  const dtEnd   = formatICSDate(endTime);

  const escTitle       = escapeICS(title || '');
  const escLocation    = escapeICS(location || '');
  const escDescription = escapeICS(description || '');
  const escEmailBody   = escapeICS(emailContent || '');

  const fullDescription = `${escDescription}\\n\\n--- Original Email ---\\n${escEmailBody}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Example Inc.//Calendar Test//JA',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `SUMMARY:${escTitle}`,
    `LOCATION:${escLocation}`,
    `DESCRIPTION:${fullDescription}`,
    `DTSTART;TZID=Asia/Tokyo:${dtStart}`,
    `DTEND;TZID=Asia/Tokyo:${dtEnd}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.map(foldICSLine).join('\r\n');
}

// ISO 8601文字列を直接パースしてICS日時形式に変換（サーバーTZ非依存）
function formatICSDate(dateString) {
  if (!dateString) return '';
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  const [, YYYY, MM, DD, HH, mm, ss] = match;
  return `${YYYY}${MM}${DD}T${HH}${mm}${ss || '00'}`;
}

function escapeICS(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

// RFC 5545: 行を75オクテット以内に折り返す（プロパティ名を含む行全体に適用）
function foldICSLine(line) {
  const MAX_OCTETS = 75;
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= MAX_OCTETS) return line;

  const parts = [];
  let start = 0;
  let limit = MAX_OCTETS;
  while (start < bytes.length) {
    // マルチバイト文字の途中で切らないよう調整
    let end = Math.min(start + limit, bytes.length);
    while (end > start && (bytes[end] & 0xC0) === 0x80) {
      end--;
    }
    parts.push(bytes.slice(start, end).toString('utf-8'));
    start = end;
    limit = MAX_OCTETS - 1; // 継続行は先頭にスペースが付くため1オクテット減
  }
  return parts.join('\r\n ');
}

// ==================== 12) Google連携 (OAuth) ====================

// A) OAuth認可URL
app.get('/auth/google', (req, res) => {
  // デバッグ情報（本番環境では出力しない）
  if (process.env.NODE_ENV !== 'production') {
    console.log('=== OAuth Debug Info ===');
    console.log('CLIENT_ID:', CLIENT_ID ? 'Configured (hidden)' : 'Not configured');
    console.log('CLIENT_SECRET:', CLIENT_SECRET ? 'Configured (hidden)' : 'Not configured');
    console.log('REDIRECT_URI:', REDIRECT_URI);
    console.log('Full URL:', `${req.protocol}://${req.get('host')}${req.originalUrl}`);
    console.log('OAuth Client Redirect URI:', oauth2Client.redirectUri);
    console.log('OAuth Client settings:', {
      redirectUri: oauth2Client.redirectUri
    });
    console.log('======================');
  }

  // userinfo 取得用に 'userinfo.email', 'userinfo.profile' も追加
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  // リダイレクトURIをリクエスト元のホストに基づいて決定
  const dynamicRedirectUri = getRedirectUri(req);

  console.log('Using redirect URI for host', req.get('host'), ':', dynamicRedirectUri);

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    redirect_uri: dynamicRedirectUri
  });
  return res.redirect(url);
});

// B) OAuthコールバック
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code returned from Google');
  }
  try {
    // リダイレクトURIをリクエスト元のホストに基づいて決定
    const dynamicRedirectUri = getRedirectUri(req);

    console.log('Using redirect URI for callback on host', req.get('host'), ':', dynamicRedirectUri);

    // 1) リクエストごとに独立したOAuth2Clientを生成
    const requestOAuth2Client = createOAuth2Client(dynamicRedirectUri);

    // 2) トークン取得
    const { tokens } = await requestOAuth2Client.getToken({ code });
    requestOAuth2Client.setCredentials(tokens);

    // 3) ユーザー情報を取得
    const oauth2 = google.oauth2({
      version: 'v2',
      auth: requestOAuth2Client
    });
    const userInfo = await oauth2.userinfo.get(); // ここで { data: { email, name, ... } } が取れる

    // 4) セッションに保存
    req.session.googleTokens = tokens;
    req.session.user = {
      email: userInfo.data.email,
      name: userInfo.data.name
    };

    // 5) 認証成功後にトップページへリダイレクト（パラメータ付き）
    return res.redirect('/?auth_success=true');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Authentication Error');
  }
});

// C) Googleカレンダーにイベント作成
app.post('/api/google-calendar-create', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    let { title, location, startTime, endTime, description, emailContent } = req.body;
    const tokens = req.session.googleTokens;
    if (!tokens) {
      return res.status(401).json({ error: 'Google認証されていません。' });
    }

    const requestOAuth2Client = createOAuth2Client();
    requestOAuth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: requestOAuth2Client });

    // 秒を補完する例
    function ensureSeconds(str) {
      if (!str) return '';
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
        return str + ':00';
      }
      return str;
    }
    startTime = ensureSeconds(startTime);
    endTime = ensureSeconds(endTime);

    const event = {
      summary: title || '',
      location: location || '',
      description: `${description || ''}\n\n--- Original Email ---\n${emailContent || ''}`,
      start: {
        dateTime: startTime,
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: endTime,
        timeZone: 'Asia/Tokyo'
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    return res.json({
      message: 'Googleカレンダーにイベントを作成しました',
      eventId: response.data.id
    });
  } catch (err) {
    console.error('Google Calendar Insert Error:', err);

    // ユーザーフレンドリーなメッセージに変換
    let userMessage = 'カレンダーへの登録に失敗しました。';
    if (err.code === 401) {
      userMessage = '認証の有効期限が切れました。再度ログインしてください。';
    } else if (err.code === 403) {
      userMessage = 'カレンダーへのアクセス権限がありません。';
    } else if (err.code === 404) {
      userMessage = '指定されたカレンダーが見つかりません。';
    }

    return res.status(500).json({
      error: userMessage,
      // detailsは開発環境のみ
      ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
  }
});

// ==================== 13) エラーハンドリング ====================
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ==================== 14) サーバ起動 ====================
const PORT = process.env.PORT || 8080;
// テスト用に app をエクスポート
module.exports = app;

// 本番ではサーバー起動（テストではスキップ）
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  // グレースフルシャットダウン（Cloud RunはSIGTERMを送信する）
  const shutdown = () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}