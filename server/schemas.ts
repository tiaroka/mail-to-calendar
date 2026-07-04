// リクエストボディの検証スキーマ（zod）。
import { z } from 'zod';

/** /api/parse: メール本文は必須・非空 */
export const parseSchema = z.object({
  emailContent: z.string().min(1),
});

/**
 * /api/create-ics・/api/google-calendar-create の共通イベント入力。
 * 各フィールドは任意（未指定は既定値で補完）。日時の妥当性は下流で扱う
 * （不正日時は ICS 生成側が空に落とす仕様のため、ここでは string のみ検証）。
 */
export const calendarEventSchema = z.object({
  title: z.string().optional().default(''),
  location: z.string().optional().default(''),
  startTime: z.string().optional().default(''),
  endTime: z.string().optional().default(''),
  description: z.string().optional().default(''),
  emailContent: z.string().optional().default(''),
  timezone: z.string().optional().default('Asia/Tokyo'),
});

export type CalendarEventBody = z.infer<typeof calendarEventSchema>;
