import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

test('desktop startup creates storage, isolates windows, blocks external navigation, and drains writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replay-mark-main-'));
  try {
    const app = new EventEmitter(), windows = [], errors = [];
    let storage, quit = 0, closed = false, finishWrites;
    const pendingWrites = new Promise(resolve => { finishWrites = resolve; });
    Object.assign(app, { requestSingleInstanceLock: () => true, setName() {}, setPath: (_name, path) => { assert.ok(existsSync(path)); storage = path; }, getPath: () => storage, whenReady: async () => {}, quit: () => { quit++; } });
    class BrowserWindow {
      constructor(options) { this.options = options; this.webContents = new EventEmitter(); this.webContents.session = { setPermissionRequestHandler: callback => { this.permission = callback; } }; this.webContents.setWindowOpenHandler = callback => { this.open = callback; }; windows.push(this); }
      async loadURL(url) { this.url = url; }
    }
    const script = (await readFile(new URL('../main.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
    await vm.runInNewContext(`(async () => { ${script} })()`, { app, BrowserWindow, dialog: { showErrorBox: (...args) => errors.push(args) }, resolve, mkdirSync, defaultDataDir: () => join(root, 'new-storage'), startServer: async () => ({ flush: () => pendingWrites, closeAllConnections: () => { closed = true; }, close() {} }), URL });
    assert.deepEqual(errors, []);
    assert.equal(windows[0].url, 'http://127.0.0.1:47800/');
    assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
    assert.equal(windows[0].options.webPreferences.sandbox, true);
    windows[0].open({ url: 'https://evil.example/' });
    assert.equal(windows.length, 1);
    windows[0].open({ url: 'http://127.0.0.1:47800/hud' });
    assert.equal(windows.length, 2);
    let blocked = false;
    windows[0].webContents.emit('will-navigate', { preventDefault: () => { blocked = true; } }, 'https://evil.example/');
    assert.ok(blocked);
    let prevented = false;
    app.emit('before-quit', { preventDefault: () => { prevented = true; } });
    assert.ok(prevented); assert.equal(quit, 0); assert.equal(closed, false);
    finishWrites(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(quit, 1); assert.equal(closed, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
