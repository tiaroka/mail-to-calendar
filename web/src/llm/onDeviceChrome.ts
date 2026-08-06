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

// 出力言語の明示。未指定だと品質・安全性検証の警告が出る（将来必須化の可能性あり）。
// expectedInputs/expectedOutputs が新API、outputLanguage は旧表記。未対応キーは無視される。
const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  outputLanguage: 'ja',
} as const;

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
 * onProgress には進捗（0〜1）が渡される。
 */
export async function triggerModelDownload(
  onProgress?: (loaded: number) => void,
): Promise<void> {
  const lm = getLanguageModel();
  if (!lm) return;
  const session = await lm.create({
    ...LANGUAGE_OPTIONS,
    monitor(m: EventTarget) {
      m.addEventListener('downloadprogress', (e) => {
        const loaded = (e as unknown as { loaded?: number }).loaded ?? 0;
        console.log(`端末内AIモデル ダウンロード進捗: ${Math.round(loaded * 100)}%`);
        onProgress?.(loaded);
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
title は「企業名 イベント名」の形式にする。変換例:
- 本文「〇〇株式会社（ABC）は…決算説明会を開催」→ title: "ABC 決算説明会"
- 件名「【〇〇社/取材案内】新製品発表会のご案内」→ title: "〇〇社 新製品発表会"
- 本文「サービス△△ドライブ 記者説明会のご案内」→ title: "△△ドライブ 記者説明会"
本文にない企業名は補わない。
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

// --- タイトルへの企業名補完 ---------------------------------------------
// 小型モデルは抽出と整形を同時に指示しても従いきれず、企業名を落としたタイトル
// （「取材のご案内」等）を返しがち。抽出の直後に「企業名だけ」を単一タスクとして
// 聞き直し、本文に実在することを確認したうえでタイトル先頭へ補う。

/** 企業名だけを尋ねる2回目のプロンプト（本文はセッション履歴に残っているため再送しない）。 */
const ORG_NAME_PROMPT = `上のメール本文で、この予定を主催している企業名・サービス名・団体名を1つだけ出力してください。
- 略称・通称が併記されている場合は略称を使ってください（例:「〇〇株式会社（ABC）」→ ABC）
- 名前だけを出力し、説明・記号・句読点は付けないでください
- 本文に企業名が書かれていない場合は NONE とだけ出力してください`;

/** 企業名として採用しない回答（モデルが「無い」を言い換えるパターン）。 */
const NO_ORG_ANSWER = /^(none|n\/a|なし|無し|不明|該当なし|ありません|記載なし)$/i;

/**
 * モデルの回答を企業名として使える形に整える。
 * 本文に実在しない文字列はハルシネーションとみなし null を返す。
 */
export function sanitizeOrgName(raw: string, emailContent: string): string | null {
  let name = (raw ?? '').trim().split('\n')[0].trim();
  // 引用符・鉤括弧・句読点が重なって付く（例:「〇〇株式会社」。）ため、変化がなくなるまで剥がす
  let prev = '';
  while (prev !== name) {
    prev = name;
    name = name
      .replace(/^["'`「『]+/, '')
      .replace(/["'`」』]+$/, '')
      .replace(/[。、．，.,:：]+$/, '')
      .trim();
  }
  if (!name) return null;
  // 名前ではなく文章を返してきた場合は捨てる
  if (name.length > 30) return null;
  if (NO_ORG_ANSWER.test(name)) return null;
  // 本文に存在しない名前は補わない（サーバー側プロンプトと同じ方針）
  if (!emailContent.includes(name)) return null;
  return name;
}

/** 企業名をタイトル先頭へ付ける。既に含まれている場合はそのまま返す。 */
export function composeTitle(title: string, org: string): string {
  const base = title.trim();
  if (!base) return org;
  if (base.includes(org)) return base;
  return `${org} ${base}`;
}

/** 抽出済みタイトルに企業名を補う。失敗しても元のタイトルを壊さない。 */
async function refineTitleWithOrg(
  session: LanguageModelSession,
  title: string,
  emailContent: string,
): Promise<string> {
  try {
    const org = sanitizeOrgName(await session.prompt(ORG_NAME_PROMPT), emailContent);
    if (!org) return title;
    return composeTitle(title, org);
  } catch (err) {
    console.warn('端末内AIの企業名補完に失敗:', err);
    return title;
  }
}

/** 端末内モデルでメール本文から予定情報を抽出する（失敗時は例外）。 */
export async function extractOnDevice(emailContent: string, now: Date = new Date()): Promise<EventInfo> {
  const lm = getLanguageModel();
  if (!lm) throw new Error('端末内AIは利用できません');

  const session = await lm.create({
    ...LANGUAGE_OPTIONS,
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
    const title = (data.title as string) || '';
    return {
      title: await refineTitleWithOrg(session, title, emailContent),
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
