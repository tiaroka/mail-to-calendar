// メール本文の LLM 解析。プロバイダ（OpenAI/Anthropic）は server/services/llm で抽象化。
import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { requireLogin } from '../middleware/auth.js';
import { parseRateLimiter } from '../middleware/rateLimit.js';
import { extractEventInfo } from '../services/llm/index.js';

const router = Router();

router.post('/api/parse', requireLogin, parseRateLimiter, async (req: Request, res: Response) => {
  try {
    const { emailContent } = req.body ?? {};
    if (!emailContent) {
      return res.status(400).json({ error: 'No emailContent provided.' });
    }

    const info = await extractEventInfo(emailContent);
    return res.json(info);
  } catch (error: any) {
    logger.error('LLM parse error', { message: error?.message, status: error?.status });
    const status: number = error?.status;
    if (status === 429) {
      return res.status(429).json({
        error: 'APIの利用制限に達しました。しばらく待ってから再試行してください。',
      });
    }
    if (status === 401) {
      return res.status(500).json({
        error: 'API設定に問題があります。管理者にお問い合わせください。',
      });
    }
    if (status >= 500) {
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

export default router;
