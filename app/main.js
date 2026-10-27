import { app, BrowserWindow, dialog } from 'electron';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startServer, defaultDataDir } from './server.js';

let server, mainWindow, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else launch().catch(async e => {
  await app.whenReady();
  dialog.showErrorBox('Cannot start Replay Mark', e.code === 'EADDRINUSE' ? 'Port 47800 is already in use. Close the standalone server or other app using it, then restart Replay Mark.' : e.message);
  app.quit();
});

async function launch() {
    app.setName('Replay Mark');
    const dataDir = resolve(defaultDataDir());
    mkdirSync(dataDir, { recursive: true });
    app.setPath('userData', dataDir);
    app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', event => {
      if (!server || quitting) return;
      event.preventDefault(); quitting = true;
      server.flush().finally(() => { server.closeAllConnections(); server.close(); app.quit(); });
    });
    await app.whenReady();
    server = await startServer({ dataDir: app.getPath('userData'), port: 47800 });
    const origin = 'http://127.0.0.1:47800';
    function openWindow(path = '/') {
      const win = new BrowserWindow({ width: 1460, height: 1000, minWidth: 720, minHeight: 600, backgroundColor: '#101514', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
      win.webContents.setWindowOpenHandler(({ url }) => {
        const target = new URL(url);
        if (target.origin === origin && ['/', '/hud'].includes(target.pathname)) openWindow(target.pathname);
        return { action: 'deny' };
      });
      win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      win.loadURL(origin + path).catch(e => dialog.showErrorBox('Cannot open Replay Mark', e.message));
      return win;
    }
    mainWindow = openWindow();
}
