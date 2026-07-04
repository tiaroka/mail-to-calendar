import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

// トップページ（ログイン必須）
router.get('/', requireLogin, (_req: Request, res: Response) => {
  res.sendFile('index.html', { root: config.publicDir });
});

// クライアント設定エンドポイント
router.get('/api/config', (req: Request, res: Response) => {
  res.json({
    googleClientId: config.google.clientId,
    serviceUrl: config.serviceUrl || `${req.protocol}://${req.get('host')}`,
  });
});

export default router;
