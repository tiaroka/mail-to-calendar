// サーバーAPIへの型付きクライアント。
import type { EventInfo, CalendarEventInput } from '../../shared/types.js';

/** サーバー経由（LLM）でメール本文を解析する。 */
export async function parseEmailOnServer(emailContent: string): Promise<EventInfo> {
  const resp = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ emailContent }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `解析失敗 (status ${resp.status})`);
  }
  return (await resp.json()) as EventInfo;
}

/** ICS ファイルを生成して Blob で返す。 */
export async function createIcs(input: CalendarEventInput): Promise<Blob> {
  const resp = await fetch('/api/create-ics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    throw new Error(`ICSファイル作成に失敗しました (status ${resp.status})`);
  }
  return await resp.blob();
}

/** Google カレンダーへ直接登録する。 */
export async function createGoogleEvent(input: CalendarEventInput): Promise<{ message: string }> {
  const resp = await fetch('/api/google-calendar-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    let errMsg = '不明なエラー';
    try {
      const data = await resp.json();
      errMsg = data.error || errMsg;
    } catch {
      /* ignore */
    }
    throw new Error(errMsg);
  }
  return (await resp.json()) as { message: string };
}
