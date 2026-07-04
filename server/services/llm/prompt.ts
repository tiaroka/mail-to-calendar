// LLM プロバイダ共通のプロンプトと抽出ツールのスキーマ。
// OpenAI（function calling）と Anthropic（tool use）の両方で使い回す。

/** 現在日時を織り込んだシステムプロンプトを生成する。 */
export function buildSystemPrompt(now: Date): string {
  const currentDate = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return `あなたはメール本文から予定情報を抽出する有能なアシスタントです。
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
- 日時はそのタイムゾーンでのローカル時刻として返してください`;
}

/** 抽出ツールの入力スキーマ（JSON Schema）。OpenAI/Anthropic 共通。 */
export function buildExtractParameters(now: Date) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return {
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
  };
}

export const EXTRACT_TOOL_NAME = 'extract_event_info';
export const EXTRACT_TOOL_DESCRIPTION = 'メール本文からイベント情報を抽出する';

/** LLM の生出力を EventInfo 形へ正規化（既定値の補完）。 */
export function normalizeEventInfo(data: Record<string, unknown>) {
  return {
    title: (data.title as string) || '',
    location: (data.location as string) || '',
    startTime: (data.startTime as string) || '',
    endTime: (data.endTime as string) || '',
    description: (data.description as string) || '',
    timezone: (data.timezone as string) || 'Asia/Tokyo',
  };
}
