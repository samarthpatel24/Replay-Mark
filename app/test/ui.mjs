import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../server.js';

const live = process.argv.includes('--live');
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
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
  assert.equal(await js(viewer, 'document.querySelectorAll("#amberPlayers .player-row").length'), 6);
  assert.equal(await js(viewer, 'document.querySelectorAll("#sapphirePlayers .player-row").length'), 6);
  assert.equal(await js(viewer, 'document.querySelector("#amberPlayers").closest("aside").getBoundingClientRect().right < document.querySelector(".map-frame").getBoundingClientRect().left && document.querySelector(".map-frame").getBoundingClientRect().right < document.querySelector("#sapphirePlayers").closest("aside").getBoundingClientRect().left'), true, 'Map must sit between team rosters');
  await hud.loadURL(origin + '/hud');
  console.log('UI: HUD loaded');
  await waitFor(hud, 'document.querySelector("#hudStatus").textContent.includes("connected")');
  await js(viewer, 'document.querySelector("#zoomIn").click()');
  assert.ok(await js(viewer, 'document.querySelector("#map").viewBox.baseVal.width < 600'));
  const panPoint = await js(viewer, '(()=>{const r=document.querySelector("#map").getBoundingClientRect();return {x:Math.round(r.left+r.width*.1),y:Math.round(r.top+r.height*.1)}})()');
  const beforePan = await js(viewer, 'document.querySelector("#map").getAttribute("viewBox")');
  viewer.webContents.debugger.attach();
  await viewer.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...panPoint, button: 'left', buttons: 1, clickCount: 1 });
  await viewer.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panPoint.x + 40, y: panPoint.y + 30, button: 'left', buttons: 1 });
  await viewer.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panPoint.x + 40, y: panPoint.y + 30, button: 'left', buttons: 0, clickCount: 1 });
  viewer.webContents.debugger.detach();
  await waitFor(viewer, `document.querySelector("#map").getAttribute("viewBox") !== ${JSON.stringify(beforePan)}`);
  await js(viewer, 'document.querySelectorAll(".player-row")[1].click()');
  assert.equal(await js(viewer, 'document.querySelector("#followPlayer").getAttribute("aria-pressed")'), 'true');
  assert.ok((await js(viewer, 'document.querySelector("#mapCameraStatus").textContent')).includes('Following Haze'));
  const beforeFollowSeek = await js(viewer, 'document.querySelector("#map").getAttribute("viewBox")');
  await js(viewer, 'document.querySelector("#seekTime").value="5:05";document.querySelector("#seekForm").requestSubmit()');
  await waitFor(viewer, 'document.querySelector("#clock").textContent === "5:05"');
  assert.notEqual(await js(viewer, 'document.querySelector("#map").getAttribute("viewBox")'), beforeFollowSeek, 'Follow camera must move when replay time changes');
  await js(viewer, 'for(let i=0;i<10;i++)document.querySelector("#zoomIn").click()');
  assert.equal(await js(viewer, 'document.querySelector("#map").viewBox.baseVal.width'), 150);
  assert.equal(await js(viewer, '(()=>{const v=document.querySelector("#map").viewBox.baseVal;return v.x>=0 && v.y>=0 && v.x+v.width<=600 && v.y+v.height<=600})()'), true);
  await js(viewer, 'document.querySelector("#resetMap").click()');
  assert.equal(await js(viewer, 'document.querySelector("#map").getAttribute("viewBox")'), '0 0 600 600');
  await js(viewer, 'document.querySelector("#play").click();document.querySelector(".player-row").focus()');
  await delay(1300);
  assert.equal(await js(viewer, 'document.activeElement?.dataset.player'), '0', 'Roster refresh must preserve keyboard focus');
  await js(viewer, 'document.querySelector("#play").click()');
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
  await js(viewer, '[...document.querySelectorAll(".bookmark-card")].find(c=>c.textContent.includes("From HUD smoke")).querySelector("[data-edit]").click();document.querySelector("#bookmarkTitle").value="Edited HUD note";document.querySelector("#bookmarkTag").value="objective";document.querySelector("#bookmarkForm").requestSubmit()');
  await waitFor(hud, 'document.querySelector("#hudList").textContent.includes("Edited HUD note")');
  await js(viewer, 'window.confirm=()=>true;[...document.querySelectorAll(".bookmark-card")].find(c=>c.textContent.includes("Edited HUD note")).querySelector("[data-delete]").click()');
  await waitFor(viewer, 'document.querySelector("#bookmarkCount").textContent === "4"');
  await waitFor(hud, '!document.querySelector("#hudList").textContent.includes("Edited HUD note")');
  const reloaded = new Promise(resolve => viewer.webContents.once('did-finish-load', resolve));
  viewer.reload(); await reloaded;
  await waitFor(viewer, 'document.querySelector("#bookmarkCount").textContent === "4"');
  assert.ok((await js(viewer, 'document.querySelector("#details").textContent')).includes('UI smoke <script> ☃'));
  assert.equal(await js(viewer, 'document.querySelectorAll("#objectives [data-destroyed=true]").length'), 2);
  await js(viewer, 'document.querySelector("#seekTime").value="5:19";document.querySelector("#seekForm").requestSubmit()');
  await waitFor(viewer, 'document.querySelector("#clock").textContent === "5:19"');
  assert.equal(await js(viewer, 'document.querySelectorAll("#objectives [data-destroyed=true]").length'), 0);
  await js(viewer, 'document.querySelector("#seekTime").value="5:20";document.querySelector("#seekForm").requestSubmit()');
  await waitFor(viewer, 'document.querySelector("#clock").textContent === "5:20"');
  assert.equal(await js(viewer, 'document.querySelectorAll("#objectives [data-destroyed=true]").length'), 1);
  await js(viewer, 'document.querySelector("#seekTime").value="12:30";document.querySelector("#seekForm").requestSubmit()');
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
  console.log('UI passed: viewer ↔ HUD, seek, bookmark CRUD/reload, comments, map layers/camera, tabs, keyboard focus, mobile width.');
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
    assert.equal(await js(viewer, 'document.querySelectorAll("#dots .player-dot image").length'), 12);
    assert.equal(await js(viewer, 'document.querySelectorAll("#lanes path").length'), 3);
    assert.equal(await js(viewer, 'document.querySelectorAll("#camps g").length'), 51);
    assert.equal(await js(viewer, 'document.querySelectorAll("#objectives g").length'), 16);
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
