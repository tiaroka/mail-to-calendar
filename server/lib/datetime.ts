// 日時ユーティリティ（純粋関数・サーバーTZ非依存）
// 旧 app.js の formatICSDate と、フロント/バックに重複していた ensureSeconds を集約。

/**
 * ISO 8601 文字列を ICS 用の日時形式 `YYYYMMDDTHHMMSS` に変換する。
 * サーバーのローカルタイムゾーンに依存せず、文字列を直接パースする。
 * 不正な入力（NaN 混入防止）には空文字を返す。
 */
export function formatICSDate(dateString: string | undefined | null): string {
  if (!dateString) return '';
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  const [, YYYY, MM, DD, HH, mm, ss] = match;
  return `${YYYY}${MM}${DD}T${HH}${mm}${ss || '00'}`;
}

/**
 * `YYYY-MM-DDTHH:mm` 形式に秒がなければ `:00` を補う。
 * それ以外の形式や空文字はそのまま返す。
 */
export function ensureSeconds(str: string | undefined | null): string {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
    return str + ':00';
  }
  return str;
}
