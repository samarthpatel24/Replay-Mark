# Replay Mark — MVP Plan

Name: **Replay Mark** (desktop app) + **Replay Mark HUD** (in-game mod). Code prefix: `rm_` / `RM`.

Goal: bookmarks + notes while watching a Deadlock replay **in-game (3D)**, synced live with a
**local desktop app (2D map + full match data)**. Windows first.

UI reference: working local prototype in `mockup/`. Run `node mockup/server.mjs`, then open
`http://127.0.0.1:47800/`. See `mockup/README.md` for sample-data limits and HUD simulator;
`CHECKS.md` records design findings and unverified assumptions. This does not replace the Windows spike.

Primary 2D product reference: https://deadlocklabs.gg/matches/125682043/?tab=replay.
Use its map, time-aware scoreboard, economy, and replay navigation as interaction references.
The public replay feature page was accessible; the exact match view was blocked during inspection.
Drawing tools, heatmaps, fight detection, comparison, and export are reference ideas, not added MVP requirements.

Implementation has started in `app/`; `README.md` describes runnable server/demo modes and current gaps.

---

## 0. Facts already verified (do not re-research)

### How Deadlock UI mods work
- Mods are **VPK** files: `panorama/layout/*.vxml_c`, `panorama/scripts/*.vjs_c`, `panorama/styles/*.vcss_c`.
- Sources are XML / JS / CSS, compiled to `_c` with **Dota 2 Workshop Tools resourcecompiler** (Windows).
  Reference build scripts: https://github.com/Hantu-Raya/Deadlock-mods-collection (`build_*.ps1`). Copy their approach.
- Install: VPK named `pakNN_dir.vpk` in `<Deadlock>/game/citadel/addons/`, and `gameinfo.gi` has `Game citadel/addons`
  above the base game path (mod managers like deadlockmods.app do this).
- Mods override Valve files by same path. **Game patches can break overrides** → keep our override small.
- Valve's current Panorama sources (decompiled): https://github.com/SteamDatabase/GameTracking-Deadlock
  under `game/citadel/pak01_dir/panorama/`.

### Panorama JS (no game API — scrape + events)
- Works: `$.CreatePanel`, `$.Schedule`, `$.CancelScheduled`, `$.GetContextPanel()`, `$.RegisterEventHandler`,
  `$.DispatchEvent`, `panel.FindChildTraverse`, `FindChildrenWithClassTraverse`, `SetAttributeString/GetAttributeString`
  (session-only storage on a top panel), modern JS (const, arrows, template strings, optional chaining).
- No `fetch`, no DOM, no canvas. CSS is Panorama CSS (`flow-children: down|right`, `horizontal-align`, etc.).
- Run console commands: `$.DispatchEvent("CitadelConCommand", "cmd args")` (Valve UI passes args this way).
- **Game clock**: HUD root → `FindChildTraverse("TopBar")` → `FindChildrenWithClassTraverse("GameTime")[0].text`
  (`"m:ss"`). Defined in `citadel_hud_top_bar.xml`: `<Label class="GameTime" id="GameTime" text="{s:game_clock}"/>`.
  HUD root = walk `GetParent()` up from our panel.
- **Replay HUD file** (our override target): `panorama/layout/replay/citadel_hud_replay.xml` (67 lines).
  Root `<CitadelHudReplay class="Hidden">` — C++ un-hides it during replays. Contains `#PlaybackControls`,
  `#ReplayScrubber` (`CitadelHUDReplayScrubber`, has `#TimeScrubSlider`, `#MarkersContainer`).
- **Replay Panorama events** (from Valve XML): `CitadelReplaySkipByTime( <float seconds> )` (relative seek),
  `CitadelReplayIncrementSpeedStep( ±1 )`, `CitadelReplayNextMarker( true|false )`.
- Console commands present (release): `demo_gototick`, `demo_pause`, `demo_resume`, `demo_timescale`,
  `demo_marktick`, `demo_gotomark`, `spec_player`, `spec_mode`, `spec_next`, `spec_prev`,
  `spec_goto x y z [pitch yaw]`, `spec_setang`, `citadel_replay_toggle_pause`.

### Web bridge from Panorama (proven by the "Keyboard input overlay" mod, gamebanana 615358)
```js
const p = $.CreatePanel("CitadelHTMLPanel", $.GetContextPanel(), "RMBridge");
p.hittest = false; p.style.width = "2px"; p.style.height = "2px"; p.style.opacity = "0.01";
$.RegisterEventHandler("HTMLTitle", p, (panel, title) => { /* web -> game */ });
p.SetURL(URL + "#" + encodeURIComponent(json));           // game -> web (page listens to hashchange)
```
Web page answers by setting `document.title = "PREFIX:" + data`. That mod used an **https** URL and a few KB of data.

### Data (deadlock-api.com, CORS `*`, no key needed)
Base `https://api.deadlock-api.com`
- `GET /v1/matches/{id}/metadata` → `{ match_info: {...} }`. Fields used:
  - `duration_s`, `winning_team` (0/1), `match_pauses`, `objectives[] {team_objective_id, team, destroyed_time_s}`
  - `players[] {account_id, player_slot, team, hero_id, kills, deaths, assists, net_worth, level, items[], stats[], death_details[], pings[]}`
  - `items[] {game_time_s, item_id, upgrade_id, sold_time_s, flags, imbued_ability_id}` — includes shop items **and**
    ability unlocks/upgrades; split them by looking up `item_id` in assets (`type === "upgrade"` = shop item, `"ability"` = ability).
  - `stats[]` snapshots (every ~180 s): `time_stamp_s, net_worth, kills, deaths, player_damage, player_damage_taken, player_healing, creep_kills, denies, shots_hit, shots_missed, gold_*` …
  - `death_details[] {game_time_s, killer_player_slot, death_pos{x,y,z}, killer_pos{x,y,z}, time_to_kill_s, death_duration_s}`
  - `match_paths {interval_s (1.0), x_resolution, y_resolution (16383), paths[] {player_slot, x_min, x_max, y_min, y_max, x_pos[], y_pos[], health[], combat_type[], move_type[]}}`
    → world x = `x_min + x_pos[i] / x_resolution * (x_max - x_min)` (same for y). One sample per second.
  - `damage_matrix` (who damaged whom).
- `GET /v1/players/{account_id}/match-history` → recent matches for a player.
- `GET /v1/players/steam?account_ids=1,2,3` → `[{account_id, personaname, avatar, ...}]`.
- `GET /v1/matches/{id}/salts` → `{demo_url, metadata_url}` (demo = `.dem.bz2` on `http://replayNNN.valve.net`, **no CORS** → must be fetched from Node, not the browser).
- Assets: `GET /v1/assets/heroes` (id, name, images.minimap_image / icon_image_small, colors.ui),
  `GET /v1/assets/items` (id, name, type, item_slot_type, cost, image, item_tier),
  `GET /v1/assets/map` → `{radius: 10752, images.minimap: <png url>, objective_positions, ...}`.
  Assumption to verify visually: minimap image spans world `[-radius, +radius]` on both axes, y flipped for screen.
- Test match: **125686736** (normal mode, 1520 s, 12 players). Use it as the fixture.
- Objective IDs (`team_objective_id`): look up enum `ECitadelTeamObjective` in https://github.com/SteamDatabase/Protobufs (deadlock folder).

---

## 1. Architecture

```
Deadlock (replay) ── mod panel (Panorama) ── hidden CitadelHTMLPanel
                                                  │  http://127.0.0.1:47800/bridge#<json>
                                                  ▼
                         Replay Mark app (Electron) — Node http server on 127.0.0.1:47800
                           ├─ /bridge         tiny page: relays hash → API, API state → document.title
                           ├─ /api/*          bookmarks, active match, metadata proxy+cache
                           ├─ /events         SSE → viewer live updates
                           └─ /  (viewer)     2D map, timeline, item log, stats, bookmarks
                         Storage: %APPDATA%/replay-mark/{db.json, cache/}
```

Decisions:
- **Electron** (JS everywhere, demo parser `deadem` is JS, easy Windows build). Server = `node:http`, no Express.
- Runtime deps: none for MVP (Node 18+ `fetch`). Dev deps: `electron`, `electron-builder`.
- Server lives in `app/server.js` and runs **standalone with `node app/server.js`** (for testing without Electron).
- Bind to `127.0.0.1` only. Accept bridge writes only with a per-install token (see §3) — any local web page could otherwise hit the API.

---

## 2. Repo layout

```
PLAN.md
mockup/                      # working local MVP prototype + HUD simulator (generated sample data)
app/
  package.json               # main: main.js; scripts: start, server, test, dist
  main.js                    # Electron: start server, open BrowserWindow(http://127.0.0.1:47800/)
  server.js                  # http server, routes, storage, API proxy/cache
  bridge.html                # page loaded by in-game CitadelHTMLPanel
  viewer/index.html, viewer.js, viewer.css
  test/server.test.js        # node:test + assert, hits a running server, simulates the bridge
mod/
  src/panorama/layout/replay/citadel_hud_replay.xml   # Valve's file + our include + our panel
  src/panorama/scripts/rm_bookmarks.js
  src/panorama/styles/rm_bookmarks.css
  build.ps1                  # compile with resourcecompiler, pack VPK
  README.md                  # install steps
```

---

## 3. Bridge protocol (game ⇄ app)

Game → app: `SetURL("http://127.0.0.1:47800/bridge?token=<T>#" + encodeURIComponent(JSON.stringify(msg)))`
- `msg = { n: <nonce, increments>, op: "add"|"del"|"hello", ... }`
  - `hello`: `{op:"hello"}` on load
  - `add`: `{op:"add", t:<game seconds>, title, tag, spec:<spectated hero name or "">}`
  - `del`: `{op:"del", id}`
- `bridge.html` on `load` + `hashchange`: parse hash → `POST /api/bridge` (with token) → write state to title.

App → game: bridge page polls `GET /api/bridge/state?token=` every 2 s and sets
`document.title = "RM1:" + JSON.stringify(state)` only when changed.
- `state = { n:<last processed nonce>, match:<active match id or 0>, bms:[{id, t, title, tag, by, c:<comment count>}] }`
- Keep title **< 8 KB** (truncate list, newest first). Panorama parses it in the `HTMLTitle` handler.

Auth (MVP): **no token**. Server binds 127.0.0.1 only. Add a per-install token in Phase 3
(generated on first run, stored in `db.json`, baked into the mod's bridge URL by the "Install mod" step).

Active match: user picks the match in the app ("Set as active / watching in game"). The game side does not know the
match ID (unverified whether the replay HUD exposes it). All bridge writes go to the active match.

---

## 4. Phases (each ends with a check)

### Phase 0 — In-game spike (Windows, ~1 day) — DO FIRST, it can change the design
Build a throwaway mod that overrides `citadel_hud_replay.xml` with one button + one label. Verify in a real replay:
1. Our panel shows during replay and is clickable.
2. Clock scrape works (TopBar/GameTime text changes while replay plays).
3. `$.DispatchEvent("CitadelReplaySkipByTime", 30)` jumps +30 s. If not, try `$.DispatchEvent("CitadelReplaySkipByTime", $.GetContextPanel(), 30)`.
   If neither, try `CitadelConCommand "demo_gototick <tick>"`.
4. `CitadelHTMLPanel` loads **`http://127.0.0.1:47800/bridge`** in the replay HUD and `HTMLTitle` fires.
   If localhost is blocked → fall back to an https relay (hosted) — stop and re-plan.
5. `CitadelConCommand "spec_player 3"` / `"spec_mode 5"` change the camera.
6. Bonus: does any HUD panel expose the match ID? (search the live panel tree with `$.Msg`).
Record results in `mod/SPIKE_RESULTS.md`.

### Phase 1 — Companion server + viewer (can be built/tested on Mac)
Server routes:
- `GET  /api/match/:id` → metadata (cache to `cache/match_<id>.json`; serve cache if present)
- `GET  /api/assets/:kind` (`heroes|items|map`) → cached 24 h
- `GET  /api/players/steam?ids=` → proxy + cache names
- `GET  /api/history/:accountId` → proxy match-history
- `GET  /api/state` / `PUT /api/state {activeMatch}`
- `GET  /api/bookmarks?match=` / `POST` / `PATCH /:id` / `DELETE /:id`
- `POST /api/bookmarks/:id/comments {text}`
- `POST /api/bridge` / `GET /api/bridge/state` (§3)
- `GET  /events` (SSE: `bookmarks`, `state` events)
- `GET  /bridge` → `bridge.html`; `GET /` → viewer static files

Bookmark model:
```json
{ "id": "b_<time36>", "match": 125686736, "t": 1366, "title": "Patron push", "tag": "mistake|good|objective|note",
  "spec": "Abrams", "cam": "", "by": "you", "source": "game|app", "created": 1730000000000,
  "comments": [{ "by": "you", "text": "...", "at": 1730000000000 }] }
```
Storage: one `db.json` `{ state:{activeMatch}, bookmarks:[] }`, write via temp file + rename (no data loss on crash).

Viewer (match mockup styling):
- Top: match picker (paste match ID, or Steam account ID → recent matches list), "Set active" button.
- Left: **2D map** (minimap image + 12 player dots, hero icon, team colour), path trail last 20 s, death X markers.
- Bottom: **timeline** scrubber (0…duration) with bookmark ★, deaths, objective markers; play/pause, speed 1/2/4/8/16.
- Right tabs: **Bookmarks** (add at current time, edit, delete, comments; live via SSE),
  **Items** (per-player buy/sell log with time + icon; click time → seek), **Stats** (net worth over time per player, simple SVG line chart), **Kills** (death feed).
- Clicking any time anywhere seeks the timeline.

Check: `npm test` — start server on a random port, load fixture match 125686736 (from network once, then cache),
POST a bridge `add` message, assert it appears in `/api/bookmarks` and in `/api/bridge/state`, assert SSE receives it,
assert `db.json` survives restart. Manual: open viewer, see dots move along lanes (validates map transform).

### Phase 2 — Real mod
`citadel_hud_replay.xml` = Valve's current file (copy from GameTracking-Deadlock) + inside root:
```xml
<scripts><include src="s2r://panorama/scripts/rm_bookmarks.vjs" /></scripts>
<!-- styles include rm_bookmarks.vcss next to Valve's -->
<Panel id="RMRoot" hittest="false"> ... bookmark panel ... </Panel>
```
`rm_bookmarks.js`:
- `now()` scrape clock; `jump(t)` = SkipByTime(t - now()), re-check after 0.6 s, retry once with the other dispatch form.
- Panel: "+ Bookmark" (TextEntry for title, 4 tag buttons), list of bookmarks (time, title, tag, 💬count), click → jump.
- Bridge: create hidden `CitadelHTMLPanel` on load; `hello` on start; parse `RM1:` titles; re-send unacked message every 3 s (match `n`).
- Status dot: green = app connected (title received < 6 s ago), red otherwise, with text "Open Replay Mark".
- Session cache via `SetAttributeString` so list survives HUD reloads.
`build.ps1`: compile `src/` with Workshop Tools resourcecompiler, pack `pak77_dir.vpk (Replay Mark HUD)`, copy to `citadel/addons/` (path param).

Check: in a replay, add bookmark in game → appears in app within 2 s; add in app → appears in game within 3 s; click → jumps.

### Phase 3 — Packaging
- `electron-builder --win portable nsis`. App starts minimized-to-tray optional (skip for MVP).
- Ship mod VPK inside app; Settings → "Install mod" copies VPK into the Deadlock addons folder (detect via Steam
  `libraryfolders.vdf`, fallback manual path picker). Do not edit `gameinfo.gi` automatically in MVP — document it.
- Add bridge token.

### Later (not MVP)
- Demo parsing with `deadem` (MIT, JS, ~13 s / 30 min match) for exact ability casts/cooldowns + per-tick positions.
  Download `demo_url` in Node, bz2-decompress (`unbzip2-stream` or `seek-bzip`), cache parsed output.
- Sharing: hosted server, share links, team comments, Steam login (pair device with 6-digit code).
- Camera presets per bookmark (`spec_player`, `spec_goto`) once Phase 0 confirms they work from Panorama.
- Pins drawn on Valve's scrubber (`#MarkersContainer`).

---

## 5. Risks / unknowns
| Risk | Impact | Mitigation |
|---|---|---|
| CitadelHTMLPanel can't load localhost in replay | No in-game sync | Hosted https relay |
| SkipByTime dispatch form wrong | No jump | Try both forms, then `demo_gototick` |
| Valve patch changes replay HUD XML / TopBar | Mod breaks | Small override, re-copy Valve file each patch |
| Clock drift with pauses | Bookmark off by pause length | Use `match_pauses` to correct |
| Map transform assumption wrong | Dots off-map | Verify visually in Phase 1; tweak scale/offset constants |
| deadlock-api rate limits (metadata from Steam 3 req/h per IP if uncached) | Fetch fails for fresh matches | Cache aggressively; show clear error |
