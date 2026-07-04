// メール本文の LLM 解析（GPT Function Calling）。
// NOTE(Phase 4): OpenAI 呼び出しは service 層へ抽出し、Anthropic 対応と
// 依存注入（テストのモック化）を可能にする。現状はこのファイルにインライン。
import { Router, type Request, type Response } from 'express';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import { requireLogin } from '../middleware/auth.js';
import { DEFAULT_TIMEZONE } from '../../shared/types.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: 30000,
});

const router = Router();

router.post('/api/parse', requireLogin, async (req: Request, res: Response) => {
  try {
    const { emailContent } = req.body ?? {};
    if (!emailContent) {
      return res.status(400).json({ error: 'No emailContent provided.' });
    }

    const now = new Date();
    const currentDate = now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `あなたはメール本文から予定情報を抽出する有能なアシスタントです。
現在の日付: ${currentDate}（${currentYear}年${currentMonth}月）

重要な指示:
- メール本文に年が書かれていない場合は、現在の日付（${currentYear}年）を基準に、最も近い未来の日付を推測してください
- 例: 現在が${currentMonth}月で、メールに「12月25日」とある場合:
  - ${currentMonth}月より後なら ${currentYear}年12月25日
  - ${currentMonth}月より前なら ${currentYear + 1}年12月25日
- 過去の日付にならないように注意してください
- 日付が曖昧な場合は、常に未来の日付として解釈してください

タイムゾーンの判定:
- メール本文にタイムゾーン情報がある場合は、対応するIANAタイムゾーン名を返してください
  - 標準略称: CET → Europe/Berlin, PST → America/Los_Angeles, EST → America/New_York, GMT → Europe/London
  - UTC/GMTオフセット: UTC+1 → Europe/Berlin, GMT-8 → America/Los_Angeles
  - 自然言語での指示: 「米西太平洋時間」→ America/Los_Angeles, 「バルセロナのタイムゾーン」→ Europe/Madrid
  - 都市名・国名からの推測: 開催場所が海外都市の場合、その都市のタイムゾーンを使用
    例: 「ベルリンのオフィスにて」→ Europe/Berlin, 「サンフランシスコ」→ America/Los_Angeles
- タイムゾーン情報が一切ない場合は Asia/Tokyo を使用してください
- 日時はそのタイムゾーンでのローカル時刻として返してください`,
        },
        { role: 'user', content: emailContent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_event_info',
            description: 'メール本文からイベント情報を抽出する',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'イベントのタイトル' },
                location: { type: 'string', description: '開催場所' },
                startTime: {
                  type: 'string',
                  description: `開始日時（ISO 8601形式 YYYY-MM-DDTHH:mm:ss）。年が省略されている場合は、現在の日付（${currentYear}年${currentMonth}月）を基準に、最も近い未来の日付を使用してください。`,
                },
                endTime: {
                  type: 'string',
                  description: `終了日時（ISO 8601形式 YYYY-MM-DDTHH:mm:ss）。明示的な終了時刻が指定されていない場合は、開始時刻の1時間後を設定してください。年が省略されている場合は、開始日時と同じ年を使用してください。`,
                },
                description: { type: 'string', description: 'イベントの説明' },
                timezone: {
                  type: 'string',
                  description:
                    'イベントのタイムゾーン（IANA形式、例: Asia/Tokyo, Europe/Berlin, America/Los_Angeles）。メール本文にタイムゾーン情報（CET, PST, UTC+9等）や海外都市名があれば対応するIANAタイムゾーンを設定。明示されていない場合はAsia/Tokyoを使用。',
                },
              },
              required: ['title', 'startTime', 'endTime'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_event_info' } },
    });

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: '【エラー】Tool Callの応答が返されませんでした。',
      });
    }

    try {
      const parsedData = JSON.parse(toolCalls[0].function.arguments);
      return res.json({
        title: parsedData.title || '',
        location: parsedData.location || '',
        startTime: parsedData.startTime || '',
        endTime: parsedData.endTime || '',
        description: parsedData.description || '',
        timezone: parsedData.timezone || DEFAULT_TIMEZONE,
      });
    } catch {
      return res.status(200).json({
        title: '',
        location: '',
        startTime: '',
        endTime: '',
        description: `【JSONパースエラー】Tool Callの応答:\n${toolCalls[0].function.arguments}`,
      });
    }
  } catch (error: any) {
    console.error('OpenAI API Error:', error);
    if (error?.status === 429) {
      return res.status(429).json({
        error: 'APIの利用制限に達しました。しばらく待ってから再試行してください。',
      });
    } else if (error?.status === 401) {
      return res.status(500).json({
        error: 'API設定に問題があります。管理者にお問い合わせください。',
      });
    } else if (error?.status >= 500) {
      return res.status(500).json({
        error: 'AIサービスで一時的な問題が発生しています。しばらく待ってから再試行してください。',
      });
    }
    return res.status(500).json({
      error: 'メール解析中にエラーが発生しました。',
      ...(!config.isProd && { details: error?.message }),
    });
  }
});

export default router;
