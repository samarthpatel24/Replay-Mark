import { connect, escapeHTML as esc, safeImage, $ } from './client.js';
import { SAMPLE_ID, TAGS, fmt, clamp, color, playbackTime, position, snapshot, parseTimestamp, itemsAt, healthAt } from './model.mjs';

let api, state, match, selected = 0, tab = 'bookmarks', filter = 'all', thread = null, local, loading = 0, modalContext;
let previousSecond = -1, previousBookmarks = '', displayedActive = null;
const detail = $('#details');
const layers = { trails: true, deaths: true, objectives: true };
const notice = (text, error = false) => { $('#notice').textContent = text; $('#notice').classList.toggle('error', error); };
const run = fn => (...args) => { try { return Promise.resolve(fn(...args)).catch(e => notice(e.message, true)); } catch (e) { notice(e.message, true); } };
const player = slot => match.players.find(p => p.slot === slot);
const currentPlayer = () => player(selected) || match.players[0];
const clockState = () => state.activeMatch === match?.id ? state.playback : local;
const now = () => match ? playbackTime(clockState(), match.duration) : 0;
const bookmarks = () => state.bookmarks.filter(b => b.match === match.id).sort((a, b) => a.t - b.t || a.created - b.created);

async function load(id) {
  const generation = ++loading;
  notice('Loading match…');
  const loaded = await api('/api/match/' + encodeURIComponent(id));
  if (generation !== loading) return;
  match = loaded;
  selected = loaded.players[0].slot;
  local = { match: loaded.id, t: 0, playing: false, speed: 1, at: Date.now() };
  previousSecond = -1;
  thread = null;
  $('#matchTitle').textContent = match.label;
  $('#matchMeta').textContent = `${fmt(match.duration)} · ${match.players.length} players · ${match.sample ? 'Offline sample workspace' : 'Deadlock API metadata'}`;
  $('#dataBadge').textContent = match.sample ? 'SAMPLE DATA' : 'API MATCH DATA';
  $('#duration').textContent = '/ ' + fmt(match.duration);
  $('#scrubber').max = match.duration;
  $('#ticks').innerHTML = Array.from({ length: 6 }, (_, i) => `<span>${fmt(match.duration * i / 5)}</span>`).join('');
  const image = $('#mapImage');
  image.removeAttribute('href');
  $('#schematic').style.display = '';
  if (match.map && safeImage(match.map)) {
    image.onload = () => { $('#schematic').style.display = 'none'; };
    image.onerror = () => { $('#schematic').style.display = ''; $('#mapCaption').textContent = 'MAP IMAGE UNAVAILABLE · UNCALIBRATED POSITIONS'; };
    image.setAttribute('href', match.map);
  }
  $('#mapCaption').textContent = match.sample ? 'SCHEMATIC MAP · SIMULATED POSITIONS' : 'API POSITIONS · MAP CALIBRATION UNVERIFIED';
  notice(match.sample ? 'Sample workspace · Generated data, not match #125686736. Notes save locally. Open HUD simulator to test two-way sync.' : `Loaded real metadata. ${match.warnings.join(' ')} Positions need visual calibration; objective names use IDs. Stats are periodic snapshots.`);
  renderActive(); renderRoster(); renderMarkers(); renderDetails(); renderTime();
}

function renderActive() {
  if (!match) return;
  $('#setActive').disabled = state.activeMatch === match.id;
  $('#setActive').textContent = state.activeMatch === match.id ? '✓ Active in HUD' : 'Set active';
}

async function control(patch) {
  if (!match) return;
  if (state.activeMatch === match.id) {
    const result = await api('/api/playback', 'PUT', { match: match.id, ...patch });
    state = result;
  } else local = { ...local, t: now(), ...patch, at: Date.now() };
  previousSecond = -1;
  renderTime();
}
const seek = t => control({ t: clamp(t, match.duration) });

function renderRoster() {
  const t = now();
  $('#players').innerHTML = [0, 1].map(team => `<div class="roster-team" style="color:${color(team)}">${team === 0 ? 'AMBER' : 'SAPPHIRE'}</div>` + match.players.filter(p => p.team === team).map(p => {
    const s = snapshot(p, t), icon = safeImage(p.icon), health = healthAt(p, t);
    return `<button class="player-row ${p.slot === selected ? 'selected' : ''}" data-player="${p.slot}" aria-pressed="${p.slot === selected}"><span class="hero-avatar ${p.team === 1 ? 'blue' : ''}">${icon ? `<img src="${icon}" alt="">` : esc(p.name.slice(0, 2).toUpperCase())}</span><span class="player-info">${esc(p.name)}${s.level == null ? '' : `<span class="player-level">Lv ${s.level}</span>`}<small>${esc(p.person)}</small><small>${s.net_worth == null ? 'Souls unavailable' : s.net_worth.toLocaleString() + ' souls'} · ${itemsAt(p, t).length} items</small>${health == null ? '' : `<span class="health-bar" role="meter" aria-label="${esc(p.name)} health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${health}" title="Recorded health: ${health}%"><i style="width:${health}%"></i></span>`}</span><span class="kda">${s.kills ?? '—'} / ${s.deaths ?? '—'} / ${s.assists ?? '—'}</span></button>`;
  }).join('')).join('');
}

function renderMap(t) {
  const dead = new Set(match.kills.filter(d => t >= d.t && t < d.t + d.duration).map(d => d.victim));
  const p = currentPlayer();
  const points = [];
  for (let at = Math.max(0, t - 20); at <= t; at++) { const pos = position(p, at); if (pos) points.push(`${pos.x},${pos.y}`); }
  $('#trails').innerHTML = layers.trails ? `<polyline points="${points.join(' ')}" stroke="${color(p.team)}" stroke-width="3" fill="none" opacity=".6"/>` : '';
  $('#dots').innerHTML = match.players.map(p => {
    const pos = position(p, t);
    if (!pos) return '';
    return `<g class="player-dot" data-player="${p.slot}" tabindex="0" role="button" aria-label="Follow ${esc(p.name)}" transform="translate(${pos.x} ${pos.y})" opacity="${dead.has(p.slot) ? .3 : 1}"><title>${esc(p.name)}</title>${p.slot === selected ? '<circle r="17" fill="none" stroke="#eee9d5" opacity=".7"/>' : ''}<circle r="11" fill="#18241f" stroke="${color(p.team)}"/><text>${esc(p.name.slice(0, 2).toUpperCase())}</text></g>`;
  }).join('');
  $('#deaths').innerHTML = layers.deaths ? match.kills.filter(d => d.pos && t >= d.t && t < d.t + 25).map(d => `<text x="${d.pos.x}" y="${d.pos.y}" fill="#e6968a" font-size="20" text-anchor="middle">×</text>`).join('') : '';
  $('#objectives').innerHTML = layers.objectives ? match.objectives.filter(o => o.pos && o.t > t).map(o => `<rect x="${o.pos.x - 4}" y="${o.pos.y - 4}" width="8" height="8" fill="${color(o.team)}" transform="rotate(45 ${o.pos.x} ${o.pos.y})"><title>${esc(o.name)}</title></rect>`).join('') : '';
}

function renderTime() {
  if (!match) return;
  const t = now(), playback = clockState();
  const playing = playback.playing && t < match.duration;
  $('#clock').textContent = fmt(t);
  $('#timelineTime').textContent = `${fmt(t)} / ${fmt(match.duration)}`;
  if (document.activeElement !== $('#scrubber')) $('#scrubber').value = t;
  $('#play').textContent = playing ? 'Ⅱ' : '▶';
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#speed').value = playback.speed;
  $('#amberScore').textContent = match.kills.filter(d => d.t <= t && player(d.killer)?.team === 0 && player(d.victim)?.team === 1).length;
  $('#sapphireScore').textContent = match.kills.filter(d => d.t <= t && player(d.killer)?.team === 1 && player(d.victim)?.team === 0).length;
  renderMap(t);
  const second = Math.floor(t);
  if (second !== previousSecond) {
    previousSecond = second;
    renderRoster();
    const totals = [0, 1].map(team => {
      const values = match.players.filter(p => p.team === team).map(p => snapshot(p, t).net_worth);
      return values.length && values.every(value => Number.isFinite(value)) ? values.reduce((sum, value) => sum + value, 0) : null;
    });
    $('#amberSouls').textContent = totals[0] == null ? '—' : totals[0].toLocaleString();
    $('#sapphireSouls').textContent = totals[1] == null ? '—' : totals[1].toLocaleString();
    $('#soulLead').textContent = totals.some(total => total == null) ? 'Waiting for stats snapshots' : totals[0] === totals[1] ? 'Souls even' : `${totals[0] > totals[1] ? 'Amber' : 'Sapphire'} +${Math.abs(totals[0] - totals[1]).toLocaleString()}`;
    const add = $('#addBookmark'); if (add) add.textContent = '+ Bookmark at ' + fmt(t);
    if (tab === 'stats' || tab === 'items') renderDetails();
  }
}

function renderMarkers() {
  const make = (t, type, label, symbol) => `<button class="event-marker ${type}" data-seek="${t}" style="left:${t / match.duration * 100}%" title="${esc(label)} · ${fmt(t)}" aria-label="Seek to ${esc(label)} at ${fmt(t)}">${symbol}</button>`;
  $('#markers').innerHTML = match.kills.map(d => make(d.t, 'death', `${player(d.victim)?.name || 'Player'} dies`, '×')).join('') + match.objectives.map(o => make(o.t, 'objective', o.name, '◆')).join('') + bookmarks().map(b => make(b.t, 'bookmark', b.title, '★')).join('');
  $('#bookmarkCount').textContent = bookmarks().length;
}

const linkedComment = text => esc(text).replace(/\b(\d{1,3}):([0-5]\d)\b/g, (all, min, sec) => `<button class="time-link" data-seek="${Number(min) * 60 + Number(sec)}">${all}</button>`);
function renderDetails() {
  if (!match) return;
  const p = currentPlayer(), t = now();
  const draft = detail.querySelector('.reply input')?.value;
  const focusedReply = document.activeElement === detail.querySelector('.reply input');
  if (tab === 'bookmarks') {
    const list = bookmarks().filter(b => filter === 'all' || b.tag === filter);
    detail.innerHTML = `<div class="details-heading"><div><h3>Moments worth another look</h3><p>Private notes, synced with your replay HUD.</p></div></div><button id="addBookmark" class="add-bookmark">+ Bookmark at ${fmt(t)}</button><div class="filters">${['all', ...TAGS].map(tag => `<button class="filter ${filter === tag ? 'active' : ''}" data-filter="${tag}">${tag === 'all' ? 'All notes' : tag[0].toUpperCase() + tag.slice(1)}</button>`).join('')}</div>${list.length ? list.map(b => `<article class="bookmark-card"><button class="bookmark-main" data-seek="${b.t}"><span class="timestamp">${fmt(b.t)}</span><span class="bookmark-copy"><strong>${esc(b.title)}</strong><small><span class="tag ${b.tag}">${b.tag}</span> · ${esc(b.spec || 'No player selected')} · ${b.source === 'game' ? 'HUD' : 'App'}</small></span></button><div class="bookmark-actions"><button class="text-button" data-thread="${b.id}" aria-expanded="${thread === b.id}">${b.comments.length} comments</button><button class="text-button" data-edit="${b.id}">Edit</button><button class="text-button danger" data-delete="${b.id}">Delete</button></div>${thread === b.id ? `<div class="thread">${b.comments.length ? b.comments.map(c => `<div class="comment"><small>${esc(c.by)} · ${new Date(c.at).toLocaleDateString()}</small>${linkedComment(c.text)}</div>`).join('') : '<p class="empty">Start a note. Use 12:40 to link a replay time.</p>'}<form class="reply" data-reply="${b.id}"><input required maxlength="2000" aria-label="Comment" placeholder="Add a comment…"><button>Post</button></form></div>` : ''}</article>`).join('') : '<p class="empty">No bookmarks here yet.<br>Pause at a moment and add your first note.</p>'}<p class="detail-note">Local only. Sharing, team access, camera presets, and ability casts are outside this MVP.</p>`;
    const input = detail.querySelector('.reply input'); if (input && draft !== undefined) { input.value = draft; if (focusedReply) input.focus(); }
  } else if (tab === 'items') {
    const events = p.items.flatMap(i => [{ ...i, at: i.t, action: 'Purchased' }, ...(i.sold > 0 ? [{ ...i, at: i.sold, action: 'Sold' }] : [])]).filter(i => i.at >= 0 && i.at <= match.duration).sort((a, b) => a.at - b.at);
    const inventory = itemsAt(p, t);
    detail.innerHTML = `<div class="details-heading"><div><h3>${esc(p.name)} · Items</h3><p>Inventory at ${fmt(t)} · ${inventory.length} items</p></div></div><div class="inventory-row">${inventory.map(i => `<span title="${esc(i.name)}" class="inventory-item">${safeImage(i.icon) ? `<img src="${safeImage(i.icon)}" alt="${esc(i.name)}">` : esc(i.name)}</span>`).join('') || '<span class="empty">No purchased items at this time.</span>'}</div><p class="detail-note">BUY / SELL HISTORY · CLICK TIME TO SEEK</p>${events.map(i => `<div class="event-row"><button class="timestamp" data-seek="${i.at}">${fmt(i.at)}</button>${safeImage(i.icon) ? `<img class="item-icon" src="${safeImage(i.icon)}" alt="">` : '<span class="item-icon" aria-hidden="true">◇</span>'}<span class="event-copy">${esc(i.name)}<small>${i.action}${i.action === 'Purchased' && i.cost ? ' · ' + i.cost.toLocaleString() + ' souls' : ''}</small></span></div>`).join('') || '<p class="empty">No classified shop items available.</p>'}<p class="detail-note">Select another player on the roster. Ability upgrades are excluded.</p>`;
  } else if (tab === 'kills') {
    detail.innerHTML = `<div class="details-heading"><div><h3>Kill feed</h3><p>All players · ${match.kills.length} recorded deaths</p></div></div>${match.kills.map(d => `<div class="event-row"><button class="timestamp" data-seek="${d.t}">${fmt(d.t)}</button><span class="event-copy"><span style="color:${color(player(d.killer)?.team)}">${esc(player(d.killer)?.name || 'World / NPC')}</span> → ${esc(player(d.victim)?.name || 'Unknown')}<small>Respawn duration: ${Math.round(d.duration)}s</small></span></div>`).join('') || '<p class="empty">No death data available.</p>'}`;
  } else {
    const s = snapshot(p, t), max = Math.max(1, ...match.players.flatMap(p => p.stats.map(s => s.net_worth || 0)));
    detail.innerHTML = `<div class="details-heading"><div><h3>${esc(p.name)} · Stats</h3><p>${s.t == null ? "No snapshot yet" : "Latest snapshot at " + fmt(s.t)} · viewing ${fmt(t)}</p></div></div><div class="stat-grid">${[['Net worth', s.net_worth], ['K / D / A', `${s.kills ?? "—"} / ${s.deaths ?? "—"} / ${s.assists ?? "—"}`], ['Player damage', s.player_damage], ['Creep kills', s.creep_kills]].map(([label, value]) => `<div class="stat"><small>${label}</small><strong>${typeof value === 'number' ? value.toLocaleString() : value ?? '—'}</strong></div>`).join('')}</div><p class="detail-note">NET WORTH · ALL PLAYERS</p><svg id="networth" viewBox="0 0 320 210" role="img" aria-label="Net worth over match time. Selected player highlighted.">${[0, .5, 1].map(f => `<path d="M35 ${175 - f * 150}H310" stroke="#ffffff10"/><text x="2" y="${178 - f * 150}" fill="#89918e" font-size="8">${Math.round(max * f / 1000)}k</text>`).join('')}${match.players.map(p => `<polyline points="${p.stats.map(s => `${35 + s.t / match.duration * 270},${175 - (s.net_worth || 0) / max * 150}`).join(' ')}" stroke="${color(p.team)}" stroke-width="${p.slot === selected ? 2.5 : 1}" opacity="${p.slot === selected ? 1 : .2}" fill="none"/>`).join('')}<path d="M${35 + t / match.duration * 270} 20V180" stroke="#e8c681" stroke-dasharray="3 4"/><text x="35" y="198" fill="#89918e" font-size="8">0:00</text><text x="280" y="198" fill="#89918e" font-size="8">${fmt(match.duration)}</text></svg><div class="chart-legend"><span class="amber">— Amber</span><span class="sapphire">— Sapphire</span><span>Bright line: ${esc(p.name)}</span></div><p class="detail-note">Snapshots are roughly 3 minutes apart; intermediate stats are not known. Select another player to highlight their line.</p>`;
  }
}

function openBookmark(id) {
  if (!match) return;
  const b = bookmarks().find(b => b.id === id);
  modalContext = { match: match.id, t: b?.t ?? Math.round(now()), spec: b?.spec || currentPlayer().name };
  $('#bookmarkId').value = b?.id || '';
  $('#bookmarkTitle').value = b?.title || '';
  $('#bookmarkTag').value = b?.tag || 'note';
  $('#dialogTitle').textContent = b ? 'Edit bookmark' : 'New bookmark';
  $('#bookmarkAt').textContent = `${fmt(modalContext.t)} · ${modalContext.spec} · ${match.label}`;
  $('#bookmarkDialog').showModal();
  $('#bookmarkTitle').focus();
}

$('#loadForm').onsubmit = run(async e => {
  e.preventDefault();
  const id = $('#lookup').value.trim();
  if ($('#lookupKind').value === 'match') return load(id);
  notice('Loading player history…');
  const rows = await api('/api/history/' + encodeURIComponent(id));
  $('#history').hidden = false;
  $('#history').innerHTML = Array.isArray(rows) && rows.length ? rows.slice(0, 15).map(m => `<button class="button" data-match="${esc(m.match_id)}">#${esc(m.match_id)} · ${fmt(m.match_duration_s ?? m.duration_s ?? 0)}</button>`).join('') : '<p class="empty">No recent matches found.</p>';
  notice('Select a recent match to load it.');
});
$('#history').onclick = run(e => { const button = e.target.closest('[data-match]'); if (button) return load(button.dataset.match); });
$('#sample').onclick = run(() => load(SAMPLE_ID));
$('#setActive').onclick = run(async () => { state = await api('/api/state', 'PUT', { activeMatch: match.id }); renderActive(); renderTime(); notice('Active match set. HUD simulator and companion now share playback.'); });
$('#play').onclick = run(() => control({ playing: !clockState().playing || now() >= match.duration, ...(now() >= match.duration ? { t: 0 } : {}) }));
$('#back').onclick = run(() => seek(now() - 10));
$('#forward').onclick = run(() => seek(now() + 10));
$('#speed').onchange = run(e => control({ speed: Number(e.target.value) }));
$('#scrubber').oninput = () => { $('#timelineTime').textContent = `${fmt(Number($('#scrubber').value))} / ${fmt(match.duration)}`; };
$('#scrubber').onchange = run(e => seek(Number(e.target.value)));
document.querySelectorAll('[data-layer]').forEach(input => { input.onchange = () => { layers[input.dataset.layer] = input.checked; if (match) renderMap(now()); }; });
$('#seekForm').onsubmit = run(e => { e.preventDefault(); return seek(parseTimestamp($('#seekTime').value, match?.duration)); });
$('#prevMarker').onclick = run(() => seek([...bookmarks()].reverse().find(b => b.t < now() - 1)?.t ?? 0));
$('#nextMarker').onclick = run(() => seek(bookmarks().find(b => b.t > now() + 1)?.t ?? match.duration));
document.addEventListener('click', run(async e => {
  const seekButton = e.target.closest('[data-seek]'); if (seekButton) return seek(Number(seekButton.dataset.seek));
  const p = e.target.closest('[data-player]'); if (p) { selected = Number(p.dataset.player); renderRoster(); renderDetails(); return; }
  if (e.target.closest('#addBookmark')) return openBookmark();
  const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; renderDetails(); return; }
  const th = e.target.closest('[data-thread]'); if (th) { thread = thread === th.dataset.thread ? null : th.dataset.thread; renderDetails(); return; }
  const edit = e.target.closest('[data-edit]'); if (edit) return openBookmark(edit.dataset.edit);
  const del = e.target.closest('[data-delete]'); if (del && confirm('Delete this bookmark and its comments?')) { state = await api('/api/bookmarks/' + del.dataset.delete, 'DELETE', {}); renderMarkers(); renderDetails(); }
}));
detail.addEventListener('submit', run(async e => {
  const form = e.target.closest('[data-reply]'); if (!form) return;
  e.preventDefault(); const input = form.querySelector('input');
  const text = input.value;
  const result = await api('/api/bookmarks/' + form.dataset.reply + '/comments', 'POST', { text });
  const current = detail.querySelector(`[data-reply="${form.dataset.reply}"] input`);
  if (current?.value === text) current.value = '';
  state = result; renderDetails();
}));
$('.tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); };
function selectTab(name) {
  tab = name;
  document.querySelectorAll('[data-tab]').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); b.tabIndex = b.dataset.tab === tab ? 0 : -1; });
  detail.setAttribute('aria-labelledby', 'tab-' + tab); renderDetails();
}
$('.tabs').onkeydown = e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); const tabs = ['bookmarks', 'items', 'stats', 'kills'];
  const i = e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 3)) % 4;
  selectTab(tabs[i]); $('#tab-' + tabs[i]).focus();
};
$('#closeDialog').onclick = () => $('#bookmarkDialog').close();
$('#bookmarkForm').onsubmit = run(async e => {
  e.preventDefault(); const id = $('#bookmarkId').value;
  const data = { ...modalContext, title: $('#bookmarkTitle').value, tag: $('#bookmarkTag').value };
  state = await api('/api/bookmarks' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', data);
  $('#bookmarkDialog').close(); filter = 'all'; selectTab('bookmarks'); renderMarkers();
});
document.addEventListener('keydown', run(e => {
  if (!match || e.target.closest('input,select,textarea,button,a,[role="tab"]') || $('#bookmarkDialog').open) return;
  if (e.target.closest('[data-player]') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); selected = Number(e.target.closest('[data-player]').dataset.player); renderDetails(); return; }
  if (e.key.toLowerCase() === 'b') openBookmark();
  if (e.key === ' ') { e.preventDefault(); return control({ playing: !clockState().playing }); }
  if (e.key === 'ArrowRight') { e.preventDefault(); return seek(now() + 10); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); return seek(now() - 10); }
}));

try {
  const client = await connect(next => {
    state = next;
    if (!match) return;
    renderActive();
    const signature = JSON.stringify(bookmarks());
    if (signature !== previousBookmarks) { previousBookmarks = signature; renderMarkers(); if (tab === 'bookmarks') renderDetails(); }
    if (displayedActive !== state.activeMatch) { displayedActive = state.activeMatch; previousSecond = -1; }
  }, online => { $('#connection').textContent = online ? 'Workspace connected' : 'Disconnected · reconnecting…'; $('#connection').classList.toggle('online', online); });
  api = client.api;
  try { await load(state.activeMatch || SAMPLE_ID); } catch (e) { await load(SAMPLE_ID); notice(`Saved match unavailable: ${e.message}`, true); }
  setInterval(renderTime, 100);
} catch (e) { notice(e.message, true); }
