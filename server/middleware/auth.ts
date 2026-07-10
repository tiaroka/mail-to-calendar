import type { Request, Response, NextFunction } from 'express';

/** ログイン必須。未ログインならページ遷移は OAuth へ誘導、API は 401 JSON を返す。 */
export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) {
    // fetch からの API 呼び出しに 302 を返すと accounts.google.com への
    // クロスオリジンリクエストになり CORS エラーで失敗するため、401 JSON を返す
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'ログインが必要です。', requiresLogin: true });
    }
    return res.redirect('/auth/google');
  }
  next();
}
