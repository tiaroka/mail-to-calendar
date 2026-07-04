import type { Request, Response, NextFunction } from 'express';

/** ログイン必須。未ログインなら Google OAuth へ誘導する。 */
export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) {
    return res.redirect('/auth/google');
  }
  next();
}
