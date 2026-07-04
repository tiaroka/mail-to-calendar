import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

/** 集約エラーハンドラ。本番では詳細を隠す。 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  logger.error('Unhandled error', { message: err?.message, stack: err?.stack });
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.isProd ? 'Something went wrong' : err?.message,
  });
}
