// Chrome 組み込みAI（Prompt API / Gemini Nano）による端末内抽出アダプタ。
// 仕様はまだ流動的なため、存在しない／失敗する場合は必ず例外/false を返し、
// 呼び出し側（llm/index.ts）がサーバーへフォールバックできるようにする。
//
// 参考: グローバル `LanguageModel`（旧 window.ai.languageModel）。
// 実装時に最新のAPI仕様（availability の戻り値・responseConstraint 等）を要確認。
import type { EventInfo } from '../../../shared/types.js';

// Prompt API の最小型（正式な型定義が無いため自前で緩く宣言）
interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: unknown }): Promise<string>;
  destroy?(): void;
}
interface LanguageModelStatic {
  availability(): Promise<string>;
  create(options?: Record<string, unknown>): Promise<LanguageModelSession>;
}

function getLanguageModel(): LanguageModelStatic | null {
  const g = globalThis as unknown as {
    LanguageModel?: LanguageModelStatic;
    ai?: { languageModel?: LanguageModelStatic };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** 端末内モデルの利用可否ステータス（新旧APIの戻り値を正規化）。 */
export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable';

/** 端末内モデルの現在の状態を返す。 */
export async function getOnDeviceStatus(): Promise<OnDeviceStatus> {
  const lm = getLanguageModel();
  if (!lm) return 'unavailable';
  try {
    const status = await lm.availability();
    // 新旧の戻り値を吸収（'available' / 旧 'readily'、'downloadable' / 旧 'after-download'）
    if (status === 'available' || status === 'readily') return 'available';
    if (status === 'downloadable' || status === 'after-download') return 'downloadable';
    if (status === 'downloading') return 'downloading';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * モデルのダウンロードを開始する（Prompt API では create() がダウンロードの引き金）。
 * ユーザー操作（クリック等）の文脈で呼ぶこと。完了までは 'downloading' 状態になる。
 */
export async function triggerModelDownload(): Promise<void> {
  const lm = getLanguageModel();
  if (!lm) return;
  const session = await lm.create({
    monitor(m: EventTarget) {
      m.addEventListener('downloadprogress', (e) => {
        const loaded = (e as unknown as { loaded?: number }).loaded ?? 0;
        console.log(`端末内AIモデル ダウンロード進捗: ${Math.round(loaded * 100)}%`);
      });
    },
  });
  session.destroy?.();
}

function buildPrompt(emailContent: string, now: Date): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `次のメール本文から予定情報を抽出し、JSONだけを出力してください（前後の説明文は不要）。
現在は${y}年${m}月です。年が省略されていれば最も近い未来として解釈してください。
タイムゾーンはメールから推測（都市名・略称CET/PST等）。不明なら "Asia/Tokyo"。
出力キー: title, location, startTime, endTime, description, timezone
日時は ISO 8601 のローカル時刻 "YYYY-MM-DDTHH:mm:ss" 形式。

--- メール本文 ---
${emailContent}`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    location: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    description: { type: 'string' },
    timezone: { type: 'string' },
  },
  required: ['title', 'startTime', 'endTime'],
};

function parseJsonLoose(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('端末内モデルの出力からJSONを抽出できませんでした');
  return JSON.parse(match[0]) as Record<string, unknown>;
}

/** 端末内モデルでメール本文から予定情報を抽出する（失敗時は例外）。 */
export async function extractOnDevice(emailContent: string, now: Date = new Date()): Promise<EventInfo> {
  const lm = getLanguageModel();
  if (!lm) throw new Error('端末内AIは利用できません');

  const session = await lm.create({
    initialPrompts: [
      { role: 'system', content: 'あなたはメール本文から予定情報を正確に抽出するアシスタントです。' },
    ],
  });
  try {
    let text: string;
    try {
      // responseConstraint 対応環境では JSON スキーマで制約
      text = await session.prompt(buildPrompt(emailContent, now), {
        responseConstraint: RESPONSE_SCHEMA,
      });
    } catch {
      // 未対応環境ではプレーンにプロンプト
      text = await session.prompt(buildPrompt(emailContent, now));
    }
    const data = parseJsonLoose(text);
    return {
      title: (data.title as string) || '',
      location: (data.location as string) || '',
      startTime: (data.startTime as string) || '',
      endTime: (data.endTime as string) || '',
      description: (data.description as string) || '',
      timezone: (data.timezone as string) || 'Asia/Tokyo',
    };
  } finally {
    session.destroy?.();
  }
}
