// Express アプリの組み立てのみ（ミドルウェア設定＋ルーターのマウント）。
// 起動処理は server/server.ts、各ルートは server/routes/* に分離。

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';

import { config } from './config/index.js';
import { errorHandler } from './middleware/error.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';
import parseRouter from './routes/parse.js';
import icsRouter from './routes/ics.js';
import calendarRouter from './routes/calendar.js';

console.log('Using redirect URI:', config.google.redirectUri);

const app = express();

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

// ルーターのマウント
app.use(pagesRouter);
app.use(authRouter);
app.use(parseRouter);
app.use(icsRouter);
app.use(calendarRouter);

// 集約エラーハンドラ（最後に登録）
app.use(errorHandler);

export default app;
