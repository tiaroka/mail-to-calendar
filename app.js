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

// OAuthクライアント作成
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

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

// セッション管理
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// ===================== ここで express.static(...) は使わない =====================
// app.use(express.static(path.join(__dirname, 'public')));

// ==================== 4) ログイン必須ミドルウェア ====================
function requireLogin(req, res, next) {
  // セッションに user が無ければ Google OAuth に誘導
  if (!req.session.user) {
    return res.redirect('/auth/google');
  }
  next();
}

// ==================== 5) "/" ルート: ログイン必須 ====================
app.get('/', requireLogin, (req, res) => {
  // ログイン済みなら public/index.html を返す
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 6) OpenAI 初期化 ====================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

// ==================== 7) クライアント設定エンドポイント ====================
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: CLIENT_ID,
    serviceUrl: process.env.SERVICE_URL || `${req.protocol}://${req.get('host')}`
  });
});

// ==================== 8) 認証必須の例: /secured ====================
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

// ==================== 8) /api/parse (GPT 解析) ====================
app.post('/api/parse', async (req, res, next) => {
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
      model: "gpt-3.5-turbo",
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
      functions: [{
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
      }],
      function_call: { name: "extract_event_info" }
    });

    // Function Calling使用時のレスポンス処理
    const functionCall = response.choices[0].message.function_call;
    if (!functionCall) {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: '【エラー】Function Callの応答が返されませんでした。'
      });
    }

    try {
      const parsedData = JSON.parse(functionCall.arguments);
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
        description: `【JSONパースエラー】Function Callの応答:\n${functionCall.arguments}`
      });
    }

  } catch (error) {
    next(error);
  }
});

// ==================== 9) /api/create-ics (ICS生成) ====================
app.post('/api/create-ics', (req, res, next) => {
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
  const uid = Date.now() + '@example.com';

  const dtStart = formatICSDate(startTime);
  const dtEnd   = formatICSDate(endTime);

  const escTitle       = escapeICS(title || '');
  const escLocation    = escapeICS(location || '');
  const escDescription = escapeICS(description || '');
  const escEmailBody   = escapeICS(emailContent || '');

  const fullDescription = `${escDescription}\n\n--- Original Email ---\n${escEmailBody}`;

  return `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Example Inc.//Calendar Test//JA
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dtStamp}
SUMMARY:${escTitle}
LOCATION:${escLocation}
DESCRIPTION:${fullDescription}
DTSTART:${dtStart}
DTEND:${dtEnd}
END:VEVENT
END:VCALENDAR`;
}

function formatICSDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const YYYY = date.getUTCFullYear();
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(date.getUTCDate()).padStart(2, '0');
  const HH = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}T${HH}${mm}${ss}Z`;
}

function escapeICS(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/(.{70})/g, '$1\r\n ');  // 長い行を折り返し
}

// ==================== 10) Google連携 (OAuth) ====================

// A) OAuth認可URL
app.get('/auth/google', (req, res) => {
  // リダイレクトURIをデバッグ情報として表示（詳細追加版）
  console.log('=== OAuth Debug Info ===');
  console.log('CLIENT_ID:', CLIENT_ID ? 'Configured (hidden)' : 'Not configured');
  console.log('CLIENT_SECRET:', CLIENT_SECRET ? 'Configured (hidden)' : 'Not configured');
  console.log('REDIRECT_URI:', REDIRECT_URI);
  console.log('Full URL:', `${req.protocol}://${req.get('host')}${req.originalUrl}`);
  
  // oauth2Clientの設定確認
  console.log('OAuth Client Redirect URI:', oauth2Client.redirectUri);
  console.log('OAuth Client settings:', {
    redirectUri: oauth2Client.redirectUri
  });
  console.log('======================');

  // userinfo 取得用に 'userinfo.email', 'userinfo.profile' も追加
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];
  
  // リダイレクトURIをリクエスト元のホストに基づいて決定
  const hostName = req.get('host');
  let dynamicRedirectUri;

  if (hostName === 'calendar.aroka.net') {
    dynamicRedirectUri = 'https://calendar.aroka.net/auth/google/callback';
  } else {
    dynamicRedirectUri = REDIRECT_URI;
  }

  console.log('Using redirect URI for host', hostName, ':', dynamicRedirectUri);
  
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
    const hostName = req.get('host');
    let dynamicRedirectUri;

    if (hostName === 'calendar.aroka.net') {
      dynamicRedirectUri = 'https://calendar.aroka.net/auth/google/callback';
    } else {
      dynamicRedirectUri = REDIRECT_URI;
    }

    console.log('Using redirect URI for callback on host', hostName, ':', dynamicRedirectUri);
    
    // 1) トークン取得（リダイレクトURIを明示的に指定）
    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: dynamicRedirectUri
    });
    oauth2Client.setCredentials(tokens);

    // 2) ユーザー情報を取得
    const oauth2 = google.oauth2({
      version: 'v2',
      auth: oauth2Client
    });
    const userInfo = await oauth2.userinfo.get(); // ここで { data: { email, name, ... } } が取れる

    // 3) セッションに保存
    req.session.googleTokens = tokens;
    req.session.user = {
      email: userInfo.data.email,
      name: userInfo.data.name
    };

    // 4) 認証成功後にトップページへリダイレクト（パラメータ付き）
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

    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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
    return res.status(500).json({
      error: 'Failed to create event',
      details: err.message
    });
  }
});

// ==================== 11) エラーハンドリング ====================
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ==================== 12) サーバ起動 ====================
const PORT = process.env.PORT || 8080;
// テスト用に app をエクスポート
module.exports = app;

// 本番ではサーバー起動（テストではスキップ）
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}