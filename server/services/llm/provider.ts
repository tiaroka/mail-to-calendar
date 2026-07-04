import type { EventInfo } from '../../../shared/types.js';

/** メール本文から予定情報を抽出する LLM プロバイダの共通インターフェース。 */
export interface EventExtractor {
  extractEventInfo(emailContent: string, now: Date): Promise<EventInfo>;
}

/** LLM が構造化された抽出結果を返さなかった場合のエラー。 */
export class LLMEmptyResponseError extends Error {
  constructor(message = 'LLM did not return structured event info') {
    super(message);
    this.name = 'LLMEmptyResponseError';
  }
}
