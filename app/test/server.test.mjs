import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createServer } from '../server.js';
import { transport } from './transport.mjs';
import { sampleMatch, normalizeMatch, position, playbackTime, snapshot, parseTimestamp, itemsAt } from '../model.mjs';
import { escapeHTML, safeImage } from '../viewer/client.js';

test('timestamp entry accepts exact boundaries and rejects invalid or out-of-match times', () => {
  assert.equal(parseTimestamp('12:40', 1520), 760);
  assert.equal(parseTimestamp(' 0:00 ', 1520), 0);
  assert.equal(parseTimestamp('25:20', 1520), 1520);
  for (const value of ['', '12:60', '12:4', '-1:00', '1:02:03', '25:21', 'Infinity:00']) assert.throws(() => parseTimestamp(value, 1520));
  assert.throws(() => parseTimestamp('12:40', undefined), /load/);
});

test('map decoding, missing data, snapshot boundaries, and playback', () => {
  const sample = sampleMatch();
  assert.equal(sample.players.length, 12);
  assert.equal(sample.duration, 1520);
  assert.equal(position(sample.players[0], 1521), null);
  const raw = { match_info: { duration_s: 10, players: [{ player_slot: 7, team: 1, hero_id: 4, account_id: 5, stats: [{ time_stamp_s: 5, net_worth: 42 }], items: [{ item_id: 10, game_time_s: 2 }, { item_id: 11, game_time_s: 1 }], death_details: [] }], match_paths: { interval_s: 1, x_resolution: 10, y_resolution: 10, paths: [{ player_slot: 7, x_min: -100, x_max: 100, y_min: -100, y_max: 100, x_pos: [0, 10], y_pos: [0, 10] }] } } };
  const match = normalizeMatch('42', raw, { heroes: [{ id: 4, name: 'Haze' }], items: [{ id: 10, type: 'upgrade', name: 'Boots' }, { id: 11, type: 'ability', name: 'Ability' }], profiles: [{ account_id: 5, personaname: 'Player five' }], map: { radius: 100 } });
  const p = match.players[0];
  assert.equal(p.person, 'Player five');
  assert.deepEqual(position(p, 0), { x: 0, y: 600 });
  assert.deepEqual(position(p, .5), { x: 300, y: 300 });
  assert.deepEqual(position(p, 1), { x: 600, y: 0 });
  assert.equal(p.items.length, 1);
  assert.equal(snapshot(p, 4).net_worth, null);
  assert.equal(snapshot(p, 5).net_worth, 42);
  assert.equal(playbackTime({ t: 5, playing: true, speed: 2, at: 1000 }, 10, 3000), 9);
  assert.equal(playbackTime({ t: 5, playing: true, speed: 2, at: 1000 }, 10, 9000), 10);
  assert.equal(escapeHTML('<img src=x onerror="bad">'), '&lt;img src=x onerror=&quot;bad&quot;&gt;');
  assert.equal(safeImage('javascript:alert(1)'), '');
  assert.equal(safeImage('https://example.com/icon.png'), 'https://example.com/icon.png');
  const buyer = { items: [{ name: 'Boots', t: 50, sold: 100 }, { name: 'Armor', t: 100, sold: 0 }] };
  assert.deepEqual(itemsAt(buyer, 49), []);
  assert.deepEqual(itemsAt(buyer, 50).map(i => i.name), ['Boots']);
  assert.deepEqual(itemsAt(buyer, 100).map(i => i.name), ['Armor']);
});

test('fresh app workspace has no seeded bookmarks or active match', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'replay-mark-clean-'));
  const server = await createServer({ dataDir });
  const connection = transport(server);
  try {
    const state = await (await connection.fetch('http://127.0.0.1:47800/api/state')).json();
    assert.equal(state.activeMatch, null);
    assert.deepEqual(state.bookmarks, []);
    assert.equal(state.playback.playing, false);
  } finally { connection.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('HTTP handlers: workspace, SSE, bridge, validation, cache, restart persistence', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'replay-mark-test-'));
  let calls = 0;
  const fetcher = async url => {
    calls++;
    if (url.includes('/metadata')) return Response.json({ match_info: { duration_s: 100, players: [{ player_slot: 0, team: 0, hero_id: 1, account_id: 7, stats: [], items: [], death_details: [] }] } });
    return Response.json(url.includes('/assets/map') ? { radius: 10752, images: {} } : []);
  };
  let server, base, token, connection, fetch;
  const start = async () => {
    server = await createServer({ dataDir, fetcher, demo: true }); connection = transport(server); fetch = connection.fetch; base = 'http://127.0.0.1:47800';
    token = (await (await fetch(base + '/api/session')).json()).token;
  };
  const stop = async () => connection.close();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  await start();
  const request = async (path, method = 'GET', data, headers = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-RM-Token': token, ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json() };
  };
  for (const path of ['/', '/hud', '/bridge', '/viewer.js', '/viewer.css', '/hud.js', '/bridge.js', '/model.mjs', '/client.js']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.equal((await request('/api/match/sample')).data.players.length, 12);
  assert.equal((await request('/api/state', 'PUT', { activeMatch: 'sample' }, { 'X-RM-Token': '' })).status, 403);
  assert.equal((await request('/api/state', 'PUT', { activeMatch: 'sample' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/session', 'GET', undefined, { Host: 'evil.example:47800' })).status, 403);
  assert.equal((await request('/api/state', 'PUT', null)).status, 400);
  assert.equal((await request('/api/bookmarks', 'POST', { match: 'sample', t: -1, title: 'bad', tag: 'note' })).status, 400);
  assert.equal((await request('/api/match/../secret')).status, 404);
  const controller = new AbortController();
  const stream = await fetch(base + '/events', { signal: controller.signal });
  const reader = stream.body.getReader(); await reader.read();
  const msg = { session: 'test', n: 1, op: 'add', match: 'sample', t: 300, title: 'Bridge regression <script> ☃', tag: 'mistake', spec: 'Haze' };
  assert.equal((await request('/api/bridge', 'POST', msg)).data.n, 1);
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /Bridge regression/);
  controller.abort();
  const onceResult = (await request('/api/bookmarks?match=sample')).data;
  const created = onceResult.find(b => b.title === msg.title);
  assert.equal(created.source, 'game');
  await request('/api/bridge', 'POST', msg);
  assert.equal((await request('/api/bookmarks?match=sample')).data.length, onceResult.length);
  assert.equal((await request('/api/bridge', 'POST', { ...msg, title: 'different' })).status, 409);
  assert.equal((await request('/api/bookmarks/' + created.id + '/comments', 'POST', { text: 'Rewatch 4:05' })).status, 200);
  assert.equal((await request('/api/bookmarks/' + created.id, 'PATCH', { title: 'Edited title', tag: 'good' })).status, 200);
  assert.equal((await request('/api/playback', 'PUT', { match: 'sample', t: 450, playing: true, speed: 4 })).data.playback.t, 450);
  assert.equal((await request('/api/playback', 'PUT', { match: 'sample', t: parseTimestamp('12:40', 1520), playing: false })).data.playback.t, 760);
  assert.equal((await request('/api/playback', 'PUT', { match: 'sample', t: null, speed: 3 })).status, 400);
  assert.equal((await request('/api/match/42')).data.sample, false);
  const fetched = calls;
  await request('/api/match/42'); assert.equal(calls, fetched);
  await request('/api/state', 'PUT', { activeMatch: '42' });
  assert.equal((await request('/api/bridge', 'POST', { ...msg, n: 2 })).status, 409);
  assert.equal((await request('/api/bridge', 'POST', { session: 'test', n: 2, op: 'del', match: '42', id: created.id })).status, 404);
  await request('/api/state', 'PUT', { activeMatch: 'sample' });
  await stop(); await start();
  await request('/api/bridge', 'POST', msg);
  const saved = (await request('/api/bookmarks?match=sample')).data.find(b => b.id === created.id);
  assert.equal(saved.title, 'Edited title'); assert.equal(saved.comments[0].text, 'Rewatch 4:05');
  assert.equal((await request('/api/state')).data.playback.playing, false);
  await request('/api/match/42'); assert.equal(calls, fetched);
  assert.equal((await request('/api/bookmarks/' + created.id, 'DELETE', {})).status, 200);
  assert.equal((await request('/api/bookmarks?match=sample')).data.some(b => b.id === created.id), false);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'db.json'), 'utf8')).bookmarks.some(b => b.id === created.id), false);
  await Promise.all(Array.from({ length: 50 }, (_, i) => request('/api/bookmarks', 'POST', { match: 'sample', t: i, title: 'Unicode ☃ '.repeat(14) + i, tag: 'note' })));
  const bounded = (await request('/api/bridge/state?token=' + token + '&session=test')).data;
  assert.equal(bounded.total, 53);
  assert.ok(bounded.bms.length < bounded.total);
  assert.ok(Buffer.byteLength('RM1:' + JSON.stringify(bounded)) < 8000);
  assert.ok(bounded.beat > 0);
});

test('corrupt saved workspace fails without overwriting data', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'replay-mark-corrupt-'));
  try { await writeFile(join(dataDir, 'db.json'), '{broken'); await assert.rejects(createServer({ dataDir }), /Cannot read saved workspace/); assert.equal(await readFile(join(dataDir, 'db.json'), 'utf8'), '{broken'); }
  finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('actual bridge script: URL hash → API → title, retry, and match rejection', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'replay-mark-bridge-'));
  const server = await createServer({ dataDir, demo: true });
  const connection = transport(server);
  const base = 'http://127.0.0.1:47800';
  const fetch = (path, options) => connection.fetch(new URL(path, base).href, options);
  try {
    const { token } = await (await fetch('/api/session')).json();
    const document = { title: '' }, location = { search: `?token=${token}&session=script-test`, hash: '' };
    const callbacks = {};
    const script = await readFile(new URL('../bridge.js', import.meta.url), 'utf8');
    await vm.runInNewContext(`(async () => { ${script} })()`, { document, location, fetch, URLSearchParams, encodeURIComponent, decodeURIComponent, Date, window: { addEventListener: (name, callback) => { callbacks[name] = callback; } }, setInterval: callback => { callbacks.poll = callback; } });
    assert.equal(JSON.parse(document.title.slice(4)).match, 'sample');
    location.hash = '#' + encodeURIComponent(JSON.stringify({ n: 1, op: 'add', match: 'sample', t: 610, title: 'Through actual bridge script', tag: 'good' }));
    await callbacks.hashchange();
    let title = JSON.parse(document.title.slice(4));
    assert.equal(title.n, 1);
    assert.ok(title.bms.some(b => b.title === 'Through actual bridge script'));
    await callbacks.hashchange(); await callbacks.poll();
    const bookmarks = await (await fetch('/api/bookmarks?match=sample')).json();
    assert.equal(bookmarks.filter(b => b.title === 'Through actual bridge script').length, 1);
    location.hash = '#' + encodeURIComponent(JSON.stringify({ n: 2, op: 'add', match: 'wrong-match', t: 610, title: 'Wrong destination', tag: 'note' }));
    await callbacks.hashchange();
    title = JSON.parse(document.title.slice(4));
    assert.equal(title.n, 1);
    assert.equal(title.failedNonce, 2);
    assert.match(title.error, /Active match changed/);
    location.hash = '#not-json'; await callbacks.hashchange();
    assert.match(JSON.parse(document.title.slice(4)).error, /Malformed/);
  } finally { connection.close(); await rm(dataDir, { recursive: true, force: true }); }
});
