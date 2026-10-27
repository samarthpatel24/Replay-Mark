import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../server.js';

const live = process.argv.includes('--live');
const timeout = setTimeout(() => { console.error('UI test timed out.'); app.exit(1); }, live ? 90000 : 45000);
app.on('window-all-closed', () => {});
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let server, dataDir;
const js = (win, source) => win.webContents.executeJavaScript(source, true);
async function screenshot(win, name) {
  await js(win, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await writeFile(join(root, '.data', name), (await win.webContents.capturePage()).toPNG());
}
async function waitFor(win, expression, milliseconds = 12000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await js(win, expression)) return; await delay(100); }
  throw new Error('Timed out: ' + expression);
}

async function run() {
try {
  console.log('UI: waiting for Electron');
  await app.whenReady();
  dataDir = await mkdtemp(join(tmpdir(), 'replay-mark-ui-'));
  console.log('UI: starting isolated server');
  server = await startServer({ dataDir, port: 0, demo: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const viewer = new BrowserWindow({ show: false, width: 1460, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const hud = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await viewer.loadURL(origin);
  console.log('UI: companion loaded');
  await waitFor(viewer, 'document.querySelectorAll(".player-row").length === 12');
  await hud.loadURL(origin + '/hud');
  console.log('UI: HUD loaded');
  await waitFor(hud, 'document.querySelector("#hudStatus").textContent.includes("connected")');
  await js(viewer, 'document.querySelector("#seekTime").value="12:40";document.querySelector("#seekForm").requestSubmit()');
  await waitFor(viewer, 'document.querySelector("#clock").textContent === "12:40"');
  await waitFor(hud, 'document.querySelector("#hudClock").textContent === "12:40"');
  await js(viewer, 'document.querySelector("#addBookmark").click();document.querySelector("#bookmarkTitle").value="UI smoke <script> ☃";document.querySelector("#bookmarkForm").requestSubmit()');
  await waitFor(viewer, 'document.querySelector("#bookmarkCount").textContent === "4"');
  await waitFor(hud, 'document.querySelector("#hudList").textContent.includes("UI smoke <script> ☃")');
  assert.equal(await js(viewer, 'document.querySelectorAll("#details script").length'), 0);
  await js(hud, 'document.querySelector("#hudTitle").value="From HUD smoke";document.querySelector("#hudForm").requestSubmit()');
  await waitFor(viewer, 'document.querySelector("#details").textContent.includes("From HUD smoke")');
  await js(viewer, 'const card=[...document.querySelectorAll(".bookmark-card")].find(c=>c.textContent.includes("From HUD smoke"));card.querySelector("[data-thread]").click();document.querySelector(".reply input").value="Watch 12:30";document.querySelector(".reply").requestSubmit()');
  await waitFor(viewer, 'document.querySelector(".comment")?.textContent.includes("Watch 12:30") && document.querySelector(".reply input").value === ""');
  await js(viewer, 'document.querySelector(".comment [data-seek]").click()');
  await waitFor(viewer, 'document.querySelector("#clock").textContent === "12:30"');
  await js(viewer, 'const layer=document.querySelector("[data-layer=trails]");layer.checked=false;layer.dispatchEvent(new Event("change"))');
  await waitFor(viewer, 'document.querySelector("#trails").children.length === 0');
  await js(viewer, 'document.querySelector("#tab-items").click()');
  assert.ok((await js(viewer, 'document.querySelector("#details").textContent')).includes('Inventory at 12:30'));
  await js(viewer, 'document.querySelector("#tab-stats").click()');
  assert.equal(await js(viewer, 'document.querySelectorAll("#networth polyline").length'), 12);
  await js(viewer, 'document.querySelector("#tab-kills").click()');
  assert.equal(await js(viewer, 'document.querySelectorAll(".event-row").length'), 30);
  await js(viewer, 'document.querySelector("#tab-bookmarks").click()');
  await mkdir(join(root, '.data'), { recursive: true });
  await screenshot(viewer, 'ui-desktop.png');
  viewer.setSize(390, 844);
  await delay(200);
  assert.equal(await js(viewer, 'document.documentElement.scrollWidth <= innerWidth'), true, 'Mobile layout overflows');
  await screenshot(viewer, 'ui-mobile.png');
  console.log('UI passed: viewer ↔ HUD, timestamp seek, bookmark writes, comments, map layers, tabs, mobile width.');
  if (live) {
    viewer.setSize(1460, 1000);
    await js(viewer, 'document.querySelector("#lookup").value="125682043";document.querySelector("#loadForm").requestSubmit()');
    await waitFor(viewer, 'document.querySelector("#matchTitle").textContent === "Match #125682043"', 30000);
    await js(viewer, 'document.querySelector("#setActive").click()');
    await waitFor(viewer, 'document.querySelector("#setActive").disabled');
    await js(viewer, 'document.querySelector("#seekTime").value="5:00";document.querySelector("#seekForm").requestSubmit()');
    await waitFor(viewer, 'document.querySelector("#clock").textContent === "5:00"');
    await waitFor(viewer, 'document.querySelector("#schematic").style.display === "none"');
    assert.equal(await js(viewer, 'document.querySelectorAll(".health-bar").length'), 12);
    assert.equal(await js(viewer, 'document.querySelector("#duration").textContent'), '/ 15:52');
    await screenshot(viewer, 'ui-live.png');
    console.log('Live match passed: 125682043, 15:52, 12 players, map image loaded, recorded health visible.');
  }
  process.exitCode = 0;
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  clearTimeout(timeout);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  await server?.flush(); server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
}
}
run();
