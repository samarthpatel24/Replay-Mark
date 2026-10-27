export async function connect(onState, onConnection) {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Local server unavailable. Start node app/server.js.');
  const { token } = await response.json();
  async function api(path, method = 'GET', data) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-RM-Token': token }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }
  const events = new EventSource('/events');
  events.addEventListener('update', e => onState(JSON.parse(e.data)));
  events.onopen = () => onConnection?.(true);
  events.onerror = () => onConnection?.(false);
  await onState(await api('/api/state'));
  window.addEventListener('pagehide', () => events.close(), { once: true });
  return { api, token };
}

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeImage = value => { try { const url = new URL(value); return url.protocol === 'https:' ? escapeHTML(url.href) : ''; } catch { return ''; } };
export const $ = selector => document.querySelector(selector);
