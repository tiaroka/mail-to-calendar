import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireLogin } from '../middleware/auth.js';
import { createICS } from '../services/ics.js';

const router = Router();

// ICS ファイル生成
router.post(
  '/api/create-ics',
  requireLogin,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title, location, startTime, endTime, description, emailContent, timezone } =
        req.body ?? {};
      const icsContent = createICS({
        title,
        location,
        startTime,
        endTime,
        description,
        emailContent,
        timezone,
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="event.ics"');
      return res.send(icsContent);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
