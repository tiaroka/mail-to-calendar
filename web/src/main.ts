import './styles.css';
import type { CalendarEventInput } from '../../shared/types.js';
import { createIcs, createGoogleEvent, AuthRequiredError } from './api.js';
import {
  extractEvent,
  OnDeviceParseError,
  type ParsePreference,
  type ParseResult,
} from './llm/index.js';
import { showNotification, ensureSeconds } from './ui.js';

let globalEmailContent = '';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element #${id} not found`);
  return el as T;
};

const emailContentInput = $<HTMLTextAreaElement>('emailContent');
const parseBtn = $<HTMLButtonElement>('parseBtn');
const parsePrefSelect = $<HTMLSelectElement>('parsePref');
const reparseCloudBtn = $<HTMLButtonElement>('reparseCloudBtn');
const parseResultDiv = $<HTMLDivElement>('parseResult');
const toggleOptionsBtn = $<HTMLButtonElement>('toggleOptions');
const optionsArea = $<HTMLDivElement>('optionsArea');
const downloadBtn = $<HTMLButtonElement>('downloadBtn');
const googleCreateBtn = $<HTMLButtonElement>('googleCreateBtn');

const titleInput = $<HTMLInputElement>('title');
const locationInput = $<HTMLInputElement>('location');
const startTimeInput = $<HTMLInputElement>('startTime');
const endTimeInput = $<HTMLInputElement>('endTime');
const descriptionInput = $<HTMLTextAreaElement>('description');
const timezoneSelect = $<HTMLSelectElement>('timezone');

// 詳細設定の折りたたみ
optionsArea.classList.add('collapsed');
toggleOptionsBtn.textContent = '▼ 詳細設定を表示';
toggleOptionsBtn.addEventListener('click', () => {
  const collapsed = optionsArea.classList.toggle('collapsed');
  toggleOptionsBtn.textContent = collapsed ? '▼ 詳細設定を表示' : '▲ 詳細設定を隠す';
});

// 現在のフォーム値を収集
function collectEventData(): CalendarEventInput {
  return {
    title: titleInput.value.trim(),
    location: locationInput.value.trim(),
    startTime: startTimeInput.value,
    endTime: endTimeInput.value,
    description: descriptionInput.value.trim(),
    emailContent: globalEmailContent,
    timezone: timezoneSelect.value,
  };
}

const SOURCE_LABEL: Record<ParseResult['source'], string> = {
  'on-device': '端末内AI',
  server: 'クラウド',
};

// 再ログイン前にメール本文を退避しておくキー（OAuth往復でページが再読み込みされるため）
const PENDING_EMAIL_KEY = 'pendingEmailContent';

/** 認証切れなら入力内容を退避して再ログインへ誘導する。処理した場合 true。 */
function handleAuthError(err: unknown): boolean {
  if (!(err instanceof AuthRequiredError)) return false;
  sessionStorage.setItem(PENDING_EMAIL_KEY, emailContentInput.value);
  showNotification('認証の有効期限が切れました。再ログインします...', true);
  setTimeout(() => {
    window.location.href = '/auth/google';
  }, 1500);
  return true;
}

// 解析結果をフォームへ反映する
function applyResult(result: ParseResult): void {
  const { info, source, escalated, modelDownloadStarted } = result;
  let sourceNote = `解析元: ${SOURCE_LABEL[source]}${escalated ? '（端末内から自動切替）' : ''}`;
  if (modelDownloadStarted) {
    sourceNote += '\n端末内AIモデルのダウンロードを開始しました。完了後は端末内で解析します。';
  }

  parseResultDiv.textContent = `${sourceNote}
タイトル: ${info.title || '(取得できませんでした)'}
場所: ${info.location || '(取得できませんでした)'}
開始日時: ${info.startTime || '(取得できませんでした)'}
終了日時: ${info.endTime || '(取得できませんでした)'}
タイムゾーン: ${info.timezone || 'Asia/Tokyo'}
説明: ${info.description || '(取得できませんでした)'}
  `;

  titleInput.value = info.title || '';
  locationInput.value = info.location || '';
  if (info.startTime) startTimeInput.value = ensureSeconds(info.startTime).slice(0, 19);
  if (info.endTime) endTimeInput.value = ensureSeconds(info.endTime).slice(0, 19);
  descriptionInput.value = info.description || '';

  const tz = info.timezone || 'Asia/Tokyo';
  if (timezoneSelect.querySelector(`option[value="${tz}"]`)) {
    timezoneSelect.value = tz;
  } else {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz;
    timezoneSelect.appendChild(opt);
    timezoneSelect.value = tz;
  }

  downloadBtn.disabled = false;
  googleCreateBtn.disabled = false;
  // 端末内結果を採用した場合はクラウドで解析し直す導線を出す
  reparseCloudBtn.classList.toggle('collapsed', source !== 'on-device');
}

// 解析の実行本体（優先方針を指定）
async function runParse(preference: ParsePreference, button: HTMLButtonElement): Promise<void> {
  const emailContent = emailContentInput.value.trim();
  if (!emailContent) {
    parseResultDiv.textContent =
      'メール内容が空です。予定に関する情報を含むメール文面をコピペしてください。';
    return;
  }

  parseResultDiv.textContent = '解析中...';
  const prevLabel = button.textContent;
  button.disabled = true;
  button.textContent = '解析中...';
  globalEmailContent = emailContent;

  try {
    applyResult(await extractEvent(emailContent, preference));
    showNotification('解析が完了しました');
  } catch (err) {
    console.error(err);
    if (!handleAuthError(err)) {
      parseResultDiv.textContent = `解析失敗: ${(err as Error).message}`;
      showNotification('解析に失敗しました', true);
      // 端末内AI由来の失敗ならクラウドで解析し直す導線を出す（クリックして初めてクラウド送信）
      reparseCloudBtn.classList.toggle('collapsed', !(err instanceof OnDeviceParseError));
    }
  } finally {
    button.disabled = false;
    button.textContent = prevLabel;
  }
}

parseBtn.addEventListener('click', () =>
  runParse(parsePrefSelect.value as ParsePreference, parseBtn),
);
// クラウドで解析し直す（端末内結果を上書き）
reparseCloudBtn.addEventListener('click', () => runParse('server', reparseCloudBtn));

// ICSダウンロード
downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'ダウンロード中...';
  try {
    const blob = await createIcs(collectEventData());
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'event.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotification('ICSファイルをダウンロードしました');
  } catch (err) {
    console.error(err);
    if (!handleAuthError(err)) {
      showNotification((err as Error).message, true);
    }
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'ICSファイルをダウンロード';
  }
});

// Googleカレンダーに直接登録
googleCreateBtn.addEventListener('click', async () => {
  googleCreateBtn.disabled = true;
  googleCreateBtn.textContent = '登録中...';
  try {
    await createGoogleEvent(collectEventData());
    showNotification('Googleカレンダーに予定を登録しました');
  } catch (err) {
    console.error(err);
    if (!handleAuthError(err)) {
      showNotification('Googleカレンダー登録失敗: ' + (err as Error).message, true);
    }
  } finally {
    googleCreateBtn.disabled = false;
    googleCreateBtn.textContent = 'Googleカレンダーに登録';
  }
});

// ページ読み込み時に auth_success を確認し、退避していた入力内容を復元する
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth_success')) {
    showNotification('Googleアカウントとの連携に成功しました');
  }
  const pending = sessionStorage.getItem(PENDING_EMAIL_KEY);
  if (pending) {
    sessionStorage.removeItem(PENDING_EMAIL_KEY);
    emailContentInput.value = pending;
    showNotification('再ログイン前の入力内容を復元しました');
  }
});
