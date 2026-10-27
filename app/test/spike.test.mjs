import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createServer } from '../server.js';
import { transport } from './transport.mjs';

test('actual Panorama spike → web bridge → server, reload retry, match isolation, clock and event dispatch', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rm-spike-test-'));
  const server = await createServer({ dataDir, demo: true, fetcher: async url => Response.json(url.includes('/metadata') ? { match_info: { duration_s: 1000, players: [{ player_slot: 3, team: 0, hero_id: 1, account_id: 7, items: [], stats: [], death_details: [] }] } } : url.includes('/assets/map') ? { radius: 10752, images: {} } : []) });
  const connection = transport(server), origin = 'http://127.0.0.1:47800';
  try {
    const fetch = (path, options) => connection.fetch(new URL(path, origin).href, options);
    const { token } = await (await fetch('/api/session')).json();
    const request = async (path, method, data) => {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-RM-Token': token }, ...(data ? { body: JSON.stringify(data) } : {}) });
      assert.equal(response.status, 200); return response.json();
    };
    const attributes = {}, clock = { text: '4:05', at: 1000000 };
    const script = await readFile(new URL('../../mod/src/panorama/scripts/rm_spike.js', import.meta.url), 'utf8');
    function game() {
      const labels = Object.fromEntries(['RMClock', 'RMConnection', 'RMMatch', 'RMCount', 'RMResult', 'RMTitle'].map(id => [id, { text: id === 'RMTitle' ? 'Spike note' : '' }]));
      const urls = [], scheduled = [], events = [];
      const root = { GetParent: () => null, FindChildTraverse: id => id === 'TopBar' ? { FindChildrenWithClassTraverse: () => [clock] } : null, GetAttributeString: (key, fallback) => attributes[key] || fallback, SetAttributeString: (key, value) => { attributes[key] = value; } };
      const context = { GetParent: () => root, FindChildTraverse: id => labels[id], IsValid: () => true };
      let receiver;
      const bridge = { style: {}, SetURL: url => urls.push(url) };
      const env = { RMConfig: { bridgeUrl: origin + '/bridge?token=' + token }, Date: { now: () => clock.at }, $: { GetContextPanel: () => context, Schedule: (_delay, callback) => scheduled.push(callback), CreatePanel: () => bridge, RegisterEventHandler: (_event, _panel, callback) => { receiver = callback; }, DispatchEvent: (...args) => events.push(args), Msg: () => {} } };
      vm.createContext(env); vm.runInContext(script, env); scheduled.shift()();
      return { api: env.RMSpike, context, labels, urls, scheduled, events, title: value => receiver(bridge, value) };
    }
    let panorama = game();
    const location = { search: new URL(panorama.urls.at(-1)).search, hash: '' }, callbacks = {};
    const document = {};
    Object.defineProperty(document, 'title', { set: title => panorama.title(title) });
    const bridgeScript = await readFile(new URL('../bridge.js', import.meta.url), 'utf8');
    await vm.runInNewContext(`(async () => { ${bridgeScript} })()`, { document, location, fetch, URLSearchParams, encodeURIComponent, decodeURIComponent, Date, window: { addEventListener: (name, callback) => { callbacks[name] = callback; } }, setInterval: callback => { callbacks.poll = callback; } });
    const deliver = async () => { location.hash = new URL(panorama.urls.at(-1)).hash; await callbacks.hashchange(); };
    assert.equal(panorama.labels.RMClock.text, 'Replay clock: 4:05');
    assert.equal(panorama.labels.RMConnection.text, 'Companion connected');
    assert.equal(panorama.labels.RMCount.text, 'Bookmarks in active match: 3');
    panorama.api.addBookmark();
    const sent = panorama.urls.length;
    panorama.api.addBookmark();
    assert.equal(panorama.urls.length, sent, 'Only one operation may be outstanding');
    assert.equal(panorama.labels.RMResult.text, 'Waiting for the previous bookmark');
    await deliver();
    const first = (await request('/api/bookmarks?match=sample')).filter(b => b.title === 'Spike note');
    assert.equal(first.length, 1); assert.equal(first[0].t, 245); assert.equal(first[0].source, 'game');
    assert.equal(panorama.labels.RMResult.text, 'Bookmark saved in companion');
    panorama.labels.RMTitle.text = 'Survives HUD reload';
    panorama.api.addBookmark();
    const pending = JSON.parse(attributes.rm_spike_cache).pending;
    panorama = game();
    assert.equal(JSON.parse(decodeURIComponent(new URL(panorama.urls.at(-1)).hash.slice(1))).n, pending.n);
    await deliver(); await deliver();
    assert.equal((await request('/api/bookmarks?match=sample')).filter(b => b.title === 'Survives HUD reload').length, 1);
    await request('/api/bookmarks', 'POST', { match: 'sample', t: 77, title: 'Companion note', tag: 'note' });
    await callbacks.poll();
    assert.equal(panorama.labels.RMCount.text, 'Bookmarks in active match: 6');
    clock.text = 'Paused'; panorama.api.addBookmark();
    assert.equal(panorama.labels.RMResult.text, 'Replay clock is unavailable');
    clock.text = '4:05';
    await request('/api/state', 'PUT', { activeMatch: '42' });
    panorama.api.addBookmark(); await deliver();
    assert.match(panorama.labels.RMResult.text, /Active match changed/);
    assert.deepEqual(await request('/api/bookmarks?match=42'), []);
    assert.equal(JSON.parse(attributes.rm_spike_cache).pending, null);
    panorama.api.seekDirect(); panorama.api.seekContext(); panorama.api.spectate(); panorama.api.camera();
    assert.deepEqual(panorama.events[0], ['CitadelReplaySkipByTime', 30]);
    assert.deepEqual(panorama.events[1], ['CitadelReplaySkipByTime', panorama.context, 30]);
    assert.deepEqual(panorama.events[2], ['CitadelConCommand', 'spec_player 3']);
    assert.deepEqual(panorama.events[3], ['CitadelConCommand', 'spec_mode 5']);
    clock.at += 7000; panorama.scheduled.at(-1)();
    assert.match(panorama.labels.RMConnection.text, /Disconnected/);
  } finally { connection.close(); await rm(dataDir, { recursive: true, force: true }); }
});
