import OpenAI from 'openai';
import type { EventInfo } from '../../../shared/types.js';
import { type EventExtractor, LLMEmptyResponseError } from './provider.js';
import {
  buildSystemPrompt,
  buildExtractParameters,
  normalizeEventInfo,
  EXTRACT_TOOL_NAME,
  EXTRACT_TOOL_DESCRIPTION,
} from './prompt.js';

/** OpenAI（Function Calling）で予定情報を抽出するプロバイダ。 */
export class OpenAIProvider implements EventExtractor {
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new OpenAI({ apiKey, timeout: 30000 });
  }

  async extractEventInfo(emailContent: string, now: Date): Promise<EventInfo> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(now) },
        { role: 'user', content: emailContent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: EXTRACT_TOOL_NAME,
            description: EXTRACT_TOOL_DESCRIPTION,
            parameters: buildExtractParameters(now) as Record<string, unknown>,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: EXTRACT_TOOL_NAME } },
    });

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      throw new LLMEmptyResponseError();
    }
    const parsed = JSON.parse(toolCalls[0].function.arguments) as Record<string, unknown>;
    return normalizeEventInfo(parsed);
  }
}
