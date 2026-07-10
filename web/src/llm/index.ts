// フロント側の解析オーケストレーション。
// 端末内AI（Chrome）を第1候補とし、信頼度が低ければサーバー（LLM）へ自動エスカレーション。
// 端末内モデルは小型で精度が落ちるため「最初の下書き」扱いとする。
import type { EventInfo } from '../../../shared/types.js';
import { parseEmailOnServer } from '../api.js';
import { getOnDeviceStatus, extractOnDevice, triggerModelDownload } from './onDeviceChrome.js';

export type ParseSource = 'server' | 'on-device';

/** 解析の優先方針。auto=端末内優先＋低信頼度でサーバー補完 */
export type ParsePreference = 'auto' | 'on-device' | 'server';

export interface ParseResult {
  info: EventInfo;
  source: ParseSource;
  /** 端末内で試みたが信頼度不足でサーバーへ切り替えたか */
  escalated?: boolean;
  /** 端末内モデルのダウンロードをこの解析を機に開始したか */
  modelDownloadStarted?: boolean;
}

/**
 * 端末内AIが使えない・失敗したことを示すエラー。
 * on-device 固定時はプライバシー選択を尊重し、クラウドへは一切送信せずこれを投げる。
 */
export class OnDeviceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnDeviceParseError';
  }
}

export interface ExtractOptions {
  /** モデルダウンロードの進捗通知。0〜1（1=完了）、失敗時は -1 が渡される。 */
  onDownloadProgress?: (progress: number) => void;
}

// ダウンロードの多重起動防止（連続クリック対策）
let downloadInFlight = false;

/** モデルのダウンロードをバックグラウンドで開始する。開始できたら true。 */
function startModelDownload(onProgress?: (progress: number) => void): boolean {
  if (downloadInFlight) return false;
  downloadInFlight = true;
  triggerModelDownload(onProgress)
    .then(() => onProgress?.(1))
    .catch(() => onProgress?.(-1))
    .finally(() => {
      downloadInFlight = false;
    });
  return true;
}

/** 抽出結果が実用に足るか（信頼度ゲート）。必須項目と開始日時の妥当性で判定。 */
function isConfident(info: EventInfo): boolean {
  if (!info.title || !info.startTime || !info.endTime) return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(info.startTime);
}

/** メール本文から予定情報を抽出する。 */
export async function extractEvent(
  emailContent: string,
  preference: ParsePreference = 'auto',
  options: ExtractOptions = {},
): Promise<ParseResult> {
  // クラウド固定
  if (preference === 'server') {
    return { info: await parseEmailOnServer(emailContent), source: 'server' };
  }

  const status = await getOnDeviceStatus();

  // 端末内固定: プライバシー目的の明示選択のため、クラウドへは一切送信しない
  if (preference === 'on-device') {
    if (status === 'available') {
      try {
        return { info: await extractOnDevice(emailContent), source: 'on-device' };
      } catch {
        throw new OnDeviceParseError(
          '端末内AIでの解析に失敗しました。「クラウドで解析し直す」で再試行できます。',
        );
      }
    }
    if (status === 'downloadable') {
      startModelDownload(options.onDownloadProgress);
      throw new OnDeviceParseError(
        '端末内AIモデルのダウンロードを開始しました。完了後にもう一度お試しください。',
      );
    }
    if (status === 'downloading') {
      throw new OnDeviceParseError(
        '端末内AIモデルをダウンロード中です。完了後にもう一度お試しください。',
      );
    }
    throw new OnDeviceParseError(
      'この環境では端末内AIを利用できません（Chrome組み込みAI非対応）。',
    );
  }

  // auto: 端末内優先、低信頼度・失敗時はサーバーへエスカレーション
  if (status === 'available') {
    try {
      const info = await extractOnDevice(emailContent);
      if (isConfident(info)) {
        return { info, source: 'on-device' };
      }
      // 低信頼度 → サーバーへエスカレーション
      return { info: await parseEmailOnServer(emailContent), source: 'server', escalated: true };
    } catch {
      // 端末内失敗 → サーバーで救済
      return { info: await parseEmailOnServer(emailContent), source: 'server', escalated: true };
    }
  }

  // モデル未ダウンロードならバックグラウンドで取得を開始し（create() が引き金）、
  // 今回はサーバーで解析する。完了後の解析から端末内が使われるようになる。
  if (status === 'downloadable') {
    const started = startModelDownload(options.onDownloadProgress);
    return {
      info: await parseEmailOnServer(emailContent),
      source: 'server',
      ...(started && { modelDownloadStarted: true }),
    };
  }

  // 端末内が使えない（downloading 中含む）→ サーバー
  return { info: await parseEmailOnServer(emailContent), source: 'server' };
}
