import './styles.css';
import type { CalendarEventInput } from '../../shared/types.js';
import { createIcs, createGoogleEvent } from './api.js';
import { extractEvent } from './llm/index.js';
import { showNotification, ensureSeconds } from './ui.js';

let globalEmailContent = '';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element #${id} not found`);
  return el as T;
};

const emailContentInput = $<HTMLTextAreaElement>('emailContent');
const parseBtn = $<HTMLButtonElement>('parseBtn');
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

// 解析
parseBtn.addEventListener('click', async () => {
  const emailContent = emailContentInput.value.trim();
  if (!emailContent) {
    parseResultDiv.textContent =
      'メール内容が空です。予定に関する情報を含むメール文面をコピペしてください。';
    return;
  }

  parseResultDiv.textContent = '解析中...';
  parseBtn.disabled = true;
  parseBtn.textContent = '解析中...';
  globalEmailContent = emailContent;

  try {
    const { info } = await extractEvent(emailContent);

    parseResultDiv.textContent = `
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
    showNotification('解析が完了しました');
  } catch (err) {
    console.error(err);
    parseResultDiv.textContent = `解析失敗: ${(err as Error).message}`;
    showNotification('解析に失敗しました', true);
  } finally {
    parseBtn.disabled = false;
    parseBtn.textContent = '解析する';
  }
});

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
    showNotification((err as Error).message, true);
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
    showNotification('Googleカレンダー登録失敗: ' + (err as Error).message, true);
  } finally {
    googleCreateBtn.disabled = false;
    googleCreateBtn.textContent = 'Googleカレンダーに登録';
  }
});

// ページ読み込み時に auth_success を確認
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth_success')) {
    showNotification('Googleアカウントとの連携に成功しました');
  }
});
