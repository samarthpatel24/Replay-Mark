import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { once } from 'node:events';
import { SAMPLE_ID, TAGS, sampleMatch, normalizeMatch, playbackTime } from './model.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => Object.assign(new Error(message), { status });
const validId = id => id === SAMPLE_ID || /^[1-9]\d{0,15}$/.test(String(id));
export const defaultDataDir = () => process.env.REPLAY_MARK_DATA_DIR || join(process.platform === 'win32' ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')) : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : (process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')), 'replay-mark');

export async function createServer({ dataDir = defaultDataDir(), fetcher = fetch, demo = false } = {}) {
  await mkdir(join(dataDir, 'cache'), { recursive: true });
  const dbPath = join(dataDir, 'db.json');
  let db;
  try { db = JSON.parse(await readFile(dbPath, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Cannot read saved workspace: ${e.message}`);
    const activeMatch = demo ? SAMPLE_ID : null;
    db = { token: randomBytes(24).toString('hex'), activeMatch, playback: { match: activeMatch, t: demo ? 245 : 0, playing: false, speed: 1, at: Date.now() }, bookmarks: demo ? [
      { id: 'sample-1', match: SAMPLE_ID, t: 252, title: 'Late rotation to mid', tag: 'mistake', spec: 'Abrams', by: 'you', source: 'app', comments: [{ by: 'you', text: 'Watch the map at 4:05. Could rotate before the fight.', at: Date.now() }], created: Date.now() },
      { id: 'sample-2', match: SAMPLE_ID, t: 690, title: 'Good cover before the team fight', tag: 'good', spec: 'Haze', by: 'you', source: 'app', comments: [], created: Date.now() },
      { id: 'sample-3', match: SAMPLE_ID, t: 1380, title: 'Convert the pick into an objective', tag: 'objective', spec: 'Seven', by: 'you', source: 'app', comments: [], created: Date.now() }
    ] : [] };
    await writeFile(dbPath, JSON.stringify(db), { mode: 0o600 });
  }
  db.playback = { ...db.playback, playing: false, at: Date.now() };
  const clients = new Set(), matches = new Map([[SAMPLE_ID, sampleMatch()]]), inflight = new Map();
  let mutations = Promise.resolve();
  async function save(next) {
    const temp = dbPath + '.tmp';
    await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
    await rename(temp, dbPath);
    db = next;
  }
  const publicState = () => ({ activeMatch: db.activeMatch, playback: db.playback, bookmarks: db.bookmarks });
  const emit = () => { const event = `event: update\ndata: ${JSON.stringify(publicState())}\n\n`; for (const client of clients) client.write(event); };
  async function cached(path, key, ttl = Infinity) {
    if (inflight.has(key)) return inflight.get(key);
    const work = (async () => {
      const file = join(dataDir, 'cache', key + '.json');
      try { const saved = JSON.parse(await readFile(file, 'utf8')); if (Date.now() - saved.at < ttl) return saved.data; } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
      let response;
      try { response = await fetcher(`https://api.deadlock-api.com${path}`, { signal: AbortSignal.timeout(20000) }); }
      catch { throw fail(502, 'Deadlock API is unreachable. Check your connection or use Sample match.'); }
      if (!response.ok) throw fail(response.status === 429 ? 429 : 502, `Deadlock API returned ${response.status}. Try later or use Sample match.`);
      const data = await response.json();
      await writeFile(file + '.tmp', JSON.stringify({ at: Date.now(), data }));
      await rename(file + '.tmp', file);
      return data;
    })();
    inflight.set(key, work);
    try { return await work; } finally { inflight.delete(key); }
  }
  async function match(id) {
    if (!validId(id)) throw fail(400, 'Invalid match ID.');
    if (matches.has(id)) return matches.get(id);
    const raw = await cached(`/v1/matches/${id}/metadata?disable_steam=true`, `match_${id}`);
    const assets = {};
    await Promise.all(['heroes', 'items', 'map'].map(async kind => { try { assets[kind] = await cached(`/v1/assets/${kind}`, kind, 86400000); } catch { assets[kind] = null; } }));
    const ids = [...new Set((raw.match_info?.players || []).map(p => p.account_id).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b).join(',');
    if (ids) { try { assets.profiles = await cached(`/v1/players/steam?account_ids=${ids}`, `profiles_${ids}`, 86400000); } catch { assets.profiles = []; } }
    let result;
    try { result = normalizeMatch(id, raw, assets); } catch (e) { throw fail(502, e.message); }
    matches.set(id, result);
    return result;
  }
  function bookmark(data, source = 'app') {
    if (!validId(data.match) || !matches.has(data.match)) throw fail(400, 'Load the match before adding a bookmark.');
    if (typeof data.t !== 'number' || !Number.isFinite(data.t) || data.t < 0 || data.t > matches.get(data.match).duration) throw fail(400, 'Bookmark time is outside this match.');
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 160 || !TAGS.includes(data.tag)) throw fail(400, 'Provide a title (1–160 characters) and valid tag.');
    return { id: 'b_' + randomUUID(), match: data.match, t: Math.round(data.t), title: data.title.trim(), tag: data.tag, spec: typeof data.spec === 'string' ? data.spec.slice(0, 80) : '', by: 'you', source, created: Date.now(), comments: [] };
  }
  function bridgeState(session = '') {
    const state = { n: db.receipts?.[session]?.n || 0, match: db.activeMatch, playback: db.playback, bms: [], beat: Date.now(), total: 0 };
    const list = db.bookmarks.filter(b => b.match === db.activeMatch).sort((a, b) => b.created - a.created);
    state.total = list.length;
    for (const b of list) { const item = { id: b.id, t: b.t, title: b.title, tag: b.tag, by: b.by, c: b.comments.length }; state.bms.push(item); if (Buffer.byteLength('RM1:' + JSON.stringify(state)) >= 7900) { state.bms.pop(); break; } }
    return state;
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Expected application/json.');
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) throw fail(413, 'Request too large.'); }
    try { const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; } catch { throw fail(400, 'Expected a JSON object.'); }
  }
  async function mutate(req, url, data) {
    const next = structuredClone(db);
    const path = url.pathname;
    if (path === '/api/state' && req.method === 'PUT') {
      const m = await match(String(data.activeMatch));
      next.activeMatch = m.id;
      next.playback = { match: m.id, t: 0, playing: false, speed: 1, at: Date.now() };
    } else if (path === '/api/playback' && req.method === 'PUT') {
      if (data.match !== db.activeMatch) throw fail(409, 'Set this match active before controlling shared playback.');
      const m = await match(data.match), old = db.playback;
      const t = data.t ?? playbackTime(old, m.duration);
      if (!Number.isFinite(t) || t < 0 || t > m.duration || (data.speed !== undefined && ![1, 2, 4, 8, 16].includes(data.speed)) || (data.playing !== undefined && typeof data.playing !== 'boolean')) throw fail(400, 'Invalid playback state.');
      next.playback = { ...old, ...Object.fromEntries(['playing', 'speed'].filter(k => data[k] !== undefined).map(k => [k, data[k]])), t, at: Date.now() };
    } else if (path === '/api/bookmarks' && req.method === 'POST') {
      next.bookmarks.push(bookmark(data));
    } else if (path === '/api/bridge' && req.method === 'POST') {
      if (typeof data.session !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.session) || !Number.isSafeInteger(data.n) || data.n < 1) throw fail(400, 'Invalid bridge session or nonce.');
      const receipt = db.receipts?.[data.session];
      const fingerprint = JSON.stringify(data);
      if (receipt && data.n <= receipt.n) { if (data.n === receipt.n && fingerprint !== receipt.fingerprint) throw fail(409, 'Nonce reused with different contents.'); return bridgeState(data.session); }
      if (data.match !== db.activeMatch) throw fail(409, 'Active match changed. Reconnect before sending.');
      if (data.op === 'add') next.bookmarks.push(bookmark({ ...data, match: db.activeMatch }, 'game'));
      else if (data.op === 'del') {
        const b = next.bookmarks.find(b => b.id === data.id && b.match === db.activeMatch);
        if (!b) throw fail(404, 'Bookmark not found in active match.');
        next.bookmarks = next.bookmarks.filter(b => b.id !== data.id);
      } else if (data.op !== 'hello') throw fail(400, 'Unknown bridge operation.');
      next.receipts = { ...next.receipts, [data.session]: { n: data.n, fingerprint } };
      // shortcut: retain 1000 browser sessions, use expiring durable receipts before shipping the real mod.
      if (Object.keys(next.receipts).length > 1000) delete next.receipts[Object.keys(next.receipts)[0]];
      await save(next);
      emit();
      return bridgeState(data.session);
    } else {
      const route = path.match(/^\/api\/bookmarks\/([^/]+)(\/comments)?$/);
      if (!route) throw fail(404, 'Route not found.');
      const b = next.bookmarks.find(b => b.id === route[1]);
      if (!b) throw fail(404, 'Bookmark not found.');
      if (route[2] && req.method === 'POST') {
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 2000) throw fail(400, 'Comment must contain 1–2000 characters.');
        b.comments.push({ by: 'you', text: data.text.trim(), at: Date.now() });
      } else if (!route[2] && req.method === 'PATCH') {
        const validated = bookmark({ ...b, ...data, match: b.match, t: b.t });
        b.title = validated.title; b.tag = validated.tag;
      } else if (!route[2] && req.method === 'DELETE') next.bookmarks = next.bookmarks.filter(b => b.id !== route[1]);
      else throw fail(405, 'Method not allowed.');
    }
    await save(next);
    emit();
    return publicState();
  }
  const staticFiles = new Map([['/', 'viewer/index.html'], ['/hud', 'hud.html'], ['/bridge', 'bridge.html'], ...['viewer.css', 'viewer.js', 'client.js'].map(p => ['/' + p, 'viewer/' + p]), ...['hud.js', 'bridge.js', 'model.mjs'].map(p => ['/' + p, p])]);
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      if (![`127.0.0.1:${address.port}`, `localhost:${address.port}`].includes(req.headers.host)) throw fail(403, 'Invalid host.');
      const url = new URL(req.url, origin);
      if (req.headers.origin && ![origin, `http://localhost:${address.port}`].includes(req.headers.origin)) throw fail(403, 'Cross-origin request rejected.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-site request rejected.');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        if ((req.headers['x-rm-token'] || url.searchParams.get('token')) !== db.token) throw fail(403, 'Missing or invalid workspace token.');
        const data = await body(req);
        const result = mutations.then(() => mutate(req, url, data));
        mutations = result.catch(() => {});
        return send(200, await result);
      }
      if (req.method !== 'GET') throw fail(405, 'Method not allowed.');
      if (url.pathname === '/api/session') return send(200, { token: db.token });
      if (url.pathname === '/api/state') return send(200, publicState());
      if (url.pathname === '/api/bridge/state') {
        if (url.searchParams.get('token') !== db.token) throw fail(403, 'Invalid bridge token.');
        return send(200, bridgeState(url.searchParams.get('session')));
      }
      if (url.pathname === '/api/bookmarks') return send(200, db.bookmarks.filter(b => b.match === url.searchParams.get('match')));
      if (url.pathname.startsWith('/api/match/')) return send(200, await match(url.pathname.slice(11)));
      if (url.pathname.startsWith('/api/history/')) {
        const id = url.pathname.slice(13); if (!/^[1-9]\d{0,15}$/.test(id)) throw fail(400, 'Use a numeric Steam account ID.');
        return send(200, await cached(`/v1/players/${id}/match-history`, 'history_' + id, 60000));
      }
      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: update\ndata: ${JSON.stringify(publicState())}\n\n`);
        clients.add(res);
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        req.on('close', () => { clients.delete(res); clearInterval(timer); });
        return;
      }
      const file = staticFiles.get(url.pathname);
      if (!file) throw fail(404, 'Page not found.');
      const content = await readFile(join(ROOT, file));
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'" });
      res.end(content);
    } catch (e) { if (!res.headersSent) send(e.status || 500, { error: e.status ? e.message : 'Workspace operation failed. Saved data was preserved.' }); else res.end(); }
  });
  server.on('close', () => { for (const client of clients) client.end(); });
  server.flush = () => mutations;
  return server;
}

export async function startServer({ port = Number(process.env.PORT || 47800), ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  const server = await createServer(options);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const server = await startServer(); console.log(`Replay Mark: http://127.0.0.1:${server.address().port}`); }
  catch (e) { console.error(`Cannot start Replay Mark: ${e.message}`); process.exitCode = 1; }
}
