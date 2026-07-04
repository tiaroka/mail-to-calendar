// front / back で共有するドメイン型（単一の真実）

/** メール本文から抽出される予定情報 */
export interface EventInfo {
  title: string;
  location?: string;
  /** ISO 8601 ローカル時刻 YYYY-MM-DDTHH:mm:ss（タイムゾーンは timezone フィールドで表す） */
  startTime: string;
  /** ISO 8601 ローカル時刻 YYYY-MM-DDTHH:mm:ss */
  endTime: string;
  description?: string;
  /** IANA タイムゾーン名（例: Asia/Tokyo, Europe/Berlin）。未指定時は Asia/Tokyo とみなす */
  timezone?: string;
}

/** ICS / Google カレンダー生成時の入力（EventInfo にメール原文を加えたもの） */
export interface CalendarEventInput extends EventInfo {
  /** 説明末尾に添付するメール原文 */
  emailContent?: string;
}

/** タイムゾーン未指定時の既定値 */
export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
