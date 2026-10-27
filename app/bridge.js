const params = new URLSearchParams(location.search);
const token = params.get('token'), session = params.get('session');
let busy = false, lastError = '', failedNonce = 0;

async function sync() {
  if (busy) return;
  busy = true;
  try {
    let response = await fetch(`/api/bridge/state?token=${encodeURIComponent(token)}&session=${encodeURIComponent(session)}`);
    if (!response.ok) throw new Error('Bridge authentication failed. Reopen HUD simulator.');
    let state = await response.json();
    let msg;
    try { msg = location.hash.length > 1 ? JSON.parse(decodeURIComponent(location.hash.slice(1))) : null; }
    catch { lastError = 'Malformed bridge message.'; }
    if (msg && msg.n > state.n && msg.n !== failedNonce) {
      response = await fetch('/api/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RM-Token': token }, body: JSON.stringify({ ...msg, session }) });
      const result = await response.json();
      if (!response.ok) { lastError = result.error; failedNonce = msg.n; }
      else { state = result; lastError = ''; }
    }
    document.title = 'RM1:' + JSON.stringify({ ...state, error: lastError, failedNonce });
  } catch (e) { document.title = 'RM1:' + JSON.stringify({ error: e.message, offline: true, beat: Date.now() }); }
  finally { busy = false; }
}
window.addEventListener('hashchange', sync);
await sync();
setInterval(sync, 2000);
