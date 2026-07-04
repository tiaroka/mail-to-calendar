// LLM プロバイダの選択とエントリポイント。
// config.llm.provider（.env の LLM_PROVIDER）で OpenAI / Anthropic を切り替える。
import type { EventInfo } from '../../../shared/types.js';
import { config } from '../../config/index.js';
import type { EventExtractor } from './provider.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

export type { EventExtractor } from './provider.js';
export { LLMEmptyResponseError } from './provider.js';

function createProvider(): EventExtractor {
  if (config.llm.provider === 'anthropic') {
    return new AnthropicProvider(config.llm.anthropicApiKey, config.llm.anthropicModel);
  }
  return new OpenAIProvider(config.llm.openaiApiKey, config.llm.openaiModel);
}

let instance: EventExtractor | null = null;

/** 選択中プロバイダのシングルトンを返す（初回に生成）。 */
export function getExtractor(): EventExtractor {
  if (!instance) instance = createProvider();
  return instance;
}

/** メール本文から予定情報を抽出する（ルートから呼ぶエントリポイント）。 */
export async function extractEventInfo(
  emailContent: string,
  now: Date = new Date(),
): Promise<EventInfo> {
  return getExtractor().extractEventInfo(emailContent, now);
}
