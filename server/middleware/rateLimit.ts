// レート制限。LLM 呼び出し（課金・濫用対象）を保護する。
// テスト環境では無効化して決定性を保つ。
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { config } from '../config/index.js';

const passthrough: RequestHandler = (_req, _res, next) => next();

/** /api/parse 用のレート制限（15分あたり30回）。 */
export const parseRateLimiter: RequestHandler = config.isTest
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'リクエストが多すぎます。しばらく待ってから再試行してください。' },
    });
