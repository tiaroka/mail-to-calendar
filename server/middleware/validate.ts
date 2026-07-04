import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

/**
 * リクエストボディを zod スキーマで検証するミドルウェア。
 * 成功時は既定値補完済みの値で req.body を差し替える。
 */
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: '入力が不正です。',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    next();
  };
}
