// フロント側の解析オーケストレーション。
// Phase 5a: サーバー（LLM）のみ。
// Phase 5b: Chrome 端末内AIを第1候補にし、信頼度ゲートでサーバーへ自動エスカレーション予定。
import type { EventInfo } from '../../../shared/types.js';
import { parseEmailOnServer } from '../api.js';

export type ParseSource = 'server' | 'on-device';

export interface ParseResult {
  info: EventInfo;
  source: ParseSource;
}

/** メール本文から予定情報を抽出する。 */
export async function extractEvent(emailContent: string): Promise<ParseResult> {
  const info = await parseEmailOnServer(emailContent);
  return { info, source: 'server' };
}
