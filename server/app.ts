// Express アプリの組み立てのみ（ミドルウェア設定＋ルーターのマウント）。
// 起動処理は server/server.ts、各ルートは server/routes/* に分離。

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { buildSessionMiddleware } from './middleware/session.js';
import { errorHandler } from './middleware/error.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';
import parseRouter from './routes/parse.js';
import icsRouter from './routes/ics.js';
import calendarRouter from './routes/calendar.js';

logger.info('Using redirect URI', { redirectUri: config.google.redirectUri });

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

// Vite ビルド成果物（JS/CSS 等のアセット）を配信。
// index.html は '/' ルートで requireLogin 越しに返すため index:false にする。
app.use(express.static(config.publicDir, { index: false }));

app.use(
  express.json({
    type: ['application/json', 'application/json; charset=utf-8'],
  }),
);

app.use(buildSessionMiddleware());

// ルーターのマウント
app.use(pagesRouter);
app.use(authRouter);
app.use(parseRouter);
app.use(icsRouter);
app.use(calendarRouter);

// 集約エラーハンドラ（最後に登録）
app.use(errorHandler);

export default app;
