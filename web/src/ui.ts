// UI ヘルパー（通知・秒補完）。
/** モバイルフレンドリーな一時通知を表示する。 */
export function showNotification(message: string, isError = false): void {
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: isError ? '#f44336' : '#4CAF50',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
    zIndex: '1000',
    maxWidth: '90%',
    textAlign: 'center',
  } as CSSStyleDeclaration);

  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.5s';
    setTimeout(() => el.remove(), 500);
  }, 3000);
}

/** "YYYY-MM-DDTHH:mm" 形式なら :00 を補う。 */
export function ensureSeconds(str: string): string {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
    return str + ':00';
  }
  return str;
}
