import Anthropic from '@anthropic-ai/sdk';
import type { EventInfo } from '../../../shared/types.js';
import { type EventExtractor, LLMEmptyResponseError } from './provider.js';
import {
  buildSystemPrompt,
  buildExtractParameters,
  normalizeEventInfo,
  EXTRACT_TOOL_NAME,
  EXTRACT_TOOL_DESCRIPTION,
} from './prompt.js';

/** Anthropic（Tool Use）で予定情報を抽出するプロバイダ。 */
export class AnthropicProvider implements EventExtractor {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async extractEventInfo(emailContent: string, now: Date): Promise<EventInfo> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(now),
      tools: [
        {
          name: EXTRACT_TOOL_NAME,
          description: EXTRACT_TOOL_DESCRIPTION,
          input_schema: buildExtractParameters(now) as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL_NAME },
      messages: [{ role: 'user', content: emailContent }],
    });

    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new LLMEmptyResponseError();
    }
    return normalizeEventInfo(toolUse.input as Record<string, unknown>);
  }
}
