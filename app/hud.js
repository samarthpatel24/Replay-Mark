import { $, escapeHTML as esc } from './client.js';
import { playbackTime, fmt, clamp, parseTimestamp } from './model.mjs';

let token, bridge, match, pending = null, lastTitle = '', lastHeartbeat = 0, shownMatch, loadingMatch;
const session = sessionStorage.rmSession || (sessionStorage.rmSession = crypto.randomUUID());
let nonce = Number(sessionStorage.rmNonce || 0);
const frame = $('#bridgeFrame');
const status = (text, error = false) => { $('#hudStatus').textContent = text; $('#hudStatus').style.color = error ? 'var(--red)' : 'var(--green)'; };
const currentTime = () => match && bridge?.playback ? playbackTime(bridge.playback, match.duration) : 0;
const run = fn => (...args) => { try { return Promise.resolve(fn(...args)).catch(e => status(e.message, true)); } catch (e) { status(e.message, true); } };

function send(op, extra = {}) {
  if (!bridge || bridge.offline || pending) throw new Error('Wait for the bridge to connect and finish its pending message.');
  nonce += 1; sessionStorage.rmNonce = nonce;
  pending = { n: nonce, op, match: bridge.match, ...extra };
  frame.src = `/bridge?token=${encodeURIComponent(token)}&session=${encodeURIComponent(session)}#${encodeURIComponent(JSON.stringify(pending))}`;
  status('Sending to companion…');
}
async function control(patch) {
  if (!match || !bridge || match.id !== bridge.match) throw new Error('Wait for the active match to finish loading.');
  const response = await fetch('/api/playback', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-RM-Token': token }, body: JSON.stringify({ match: bridge.match, ...patch }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  bridge.playback = result.playback;
}
async function receive() {
  let title;
  try { title = frame.contentDocument?.title; } catch { return; }
  if (!title?.startsWith('RM1:{') || title === lastTitle) return;
  lastTitle = title;
  bridge = JSON.parse(title.slice(4));
  if (!bridge.offline) lastHeartbeat = Date.now();
  if (pending && bridge.n >= pending.n) { if (pending.op === 'add') $('#hudTitle').value = ''; pending = null; }
  if (pending && bridge.failedNonce === pending.n) pending = null;
  if (bridge.error) status(bridge.error, true);
  else status(pending ? 'Sending to companion…' : '● Companion connected · URL/title bridge live');
  if (bridge.offline) return;
  if (!bridge.match) { match = null; $('#hudMatch').textContent = 'No active match'; status('Choose a match in the companion, then click Set active.'); return; }
  if (shownMatch !== bridge.match && loadingMatch !== bridge.match) {
    const requested = bridge.match;
    loadingMatch = requested;
    try {
      const response = await fetch('/api/match/' + encodeURIComponent(requested));
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (bridge.match !== requested) return;
      match = result; shownMatch = requested;
      $('#hudMatch').textContent = match.label + (match.sample ? ' · SAMPLE DATA' : ' · API metadata');
      $('#hudScrubber').max = match.duration;
      $('#hudPlayer').innerHTML = match.players.map(p => `<option>${esc(p.name)}</option>`).join('');
    } finally { if (loadingMatch === requested) loadingMatch = null; }
  }
  $('#hudCount').textContent = `${bridge.bms.length}${bridge.total > bridge.bms.length ? '/' + bridge.total : ''}`;
  $('#hudList').innerHTML = [...bridge.bms].sort((a, b) => a.t - b.t).map(b => `<article class="bookmark-card"><button class="bookmark-main" data-seek="${b.t}"><span class="timestamp">${fmt(b.t)}</span><span class="bookmark-copy"><strong>${esc(b.title)}</strong><small><span class="tag ${b.tag}">${esc(b.tag)}</span> · ${b.c} comments</small></span></button><div class="bookmark-actions"><button class="text-button danger" data-delete="${b.id}">Delete</button></div></article>`).join('') || '<p class="empty">No bookmarks. Capture a moment above.</p>';
}
$('#hudForm').onsubmit = run(e => { e.preventDefault(); send('add', { t: Math.round(currentTime()), title: $('#hudTitle').value, tag: $('#hudTag').value, spec: $('#hudPlayer').value }); });
$('#hudList').onclick = run(async e => {
  const seek = e.target.closest('[data-seek]'); if (seek) return control({ t: Number(seek.dataset.seek) });
  const del = e.target.closest('[data-delete]'); if (del && confirm('Delete this bookmark and its comments?')) send('del', { id: del.dataset.delete });
});
$('#hudPlay').onclick = run(() => control({ playing: !bridge.playback.playing || currentTime() >= match.duration, ...(currentTime() >= match.duration ? { t: 0 } : {}) }));
$('#hudBack').onclick = run(() => control({ t: clamp(currentTime() - 10, match.duration) }));
$('#hudForward').onclick = run(() => control({ t: clamp(currentTime() + 10, match.duration) }));
$('#hudSpeed').onchange = run(e => control({ speed: Number(e.target.value) }));
$('#hudScrubber').onchange = run(e => control({ t: Number(e.target.value) }));
$('#hudSeekForm').onsubmit = run(e => { e.preventDefault(); return control({ t: parseTimestamp($('#hudSeekTime').value, match?.duration) }); });

try {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Local server unavailable.');
  ({ token } = await response.json());
  frame.src = `/bridge?token=${encodeURIComponent(token)}&session=${encodeURIComponent(session)}`;
  setInterval(run(receive), 150);
  setInterval(() => {
    if (!match || !bridge) return;
    const t = currentTime(), playing = bridge.playback.playing && t < match.duration;
    $('#hudClock').textContent = fmt(t);
    $('#hudTime').textContent = `${fmt(t)} / ${fmt(match.duration)}`;
    $('#hudAdd').textContent = '+ Bookmark at ' + fmt(t);
    $('#hudAdd').disabled = !!pending || match.id !== bridge.match || bridge.offline;
    if (document.activeElement !== $('#hudScrubber')) $('#hudScrubber').value = t;
    $('#hudPlay').textContent = playing ? 'Ⅱ' : '▶';
    $('#hudPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('#hudSpeed').value = bridge.playback.speed;
    if (Date.now() - lastHeartbeat > 6500) status('Disconnected · open Replay Mark companion.', true);
  }, 100);
} catch (e) { status(e.message, true); }
