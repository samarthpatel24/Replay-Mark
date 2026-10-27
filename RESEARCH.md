# Replay Mark — Research Notes

Everything found while checking feasibility (2026-10-27). `PLAN.md` = what to build; this file = evidence.
Legend: **[verified]** = checked directly (files opened / API called). **[reported]** = from docs/articles, not tested.
**[unverified]** = our assumption, must be tested in-game.

---

## 1. Verdict summary
- In-game mod (Panorama overlay in replay HUD): ~70% feasible. Building blocks exist; 3 things untested in replays.
- Local 2D companion app with full match data: ~95% feasible. Data API is public and CORS-open.
- Cannot fix Valve's replay engine (slow seeking, ability timing glitches). Web side can show *correct* timings from data.
- In-game = real 3D (third-person chase, first-person in-eye, free cam). Web/app = 2D top-down only
  (3D in browser would require extracting + redistributing Valve map/models → skip).

---

## 2. Modding ecosystem
- GameBanana Deadlock: https://gamebanana.com/games/20948 — ~10.2k mods, 25 tools, 11 tutorials. **[verified]**
- Mod categories (GameBanana API `apiv11/Mod/Categories?_idGameRow=20948`) **[verified]**:
  Skins 3592 · HUD 752 · Model Replacement 588 · Quality of Life/Fixes 157 · Other/Misc 142 · Maps 42 · Gameplay Mods 31 · Animations 24.
- Top HUD mods by downloads (id | name): 610813 DEADLOCK TOASTED · 603113 Health Color · 629803 HUDlock 2.0 ·
  606414 Mid and Bridge Buff Timer · 615669 FG Healthbar Revamp · 667277 MapList · 615358 Keyboard input overlay ·
  674856 Match History Cards Redesign · 664041 Enhanced QuickBuy · 605710 JILL'S DEADLOCK MOD [UI]. **[verified]**
- No existing replay/bookmark mod found on GameBanana.
- Useful API calls (no auth):
  - `https://gamebanana.com/apiv11/Mod/Index?_nPage=1&_nPerpage=30&_aFilters[Generic_Category]=31713&_sSort=Generic_MostDownloaded`
  - `https://gamebanana.com/apiv11/Mod/<id>?_csvProperties=_sName,_aFiles,_sText` (file list + download URLs)

### Mod file format **[verified by unpacking two mods]**
- Archive (7z/zip) → `pakNN_dir.vpk`. Python `vpk` package reads them.
- Buff Timer (606414, `pak98_dir.vpk`):
  `panorama/layout/{bt_timer_overlay,bt_minimap_settings,bt_linger_layer,hud_minimap,bt_minimap_glow}.vxml_c`,
  `panorama/scripts/{bt_minimap_settings,rejuvnbufftimer}.vjs_c`, `panorama/styles/*.vcss_c`.
  Overrides Valve's `hud_minimap`.
- Keyboard overlay (615358, `pak09_dir.vpk`): overrides `panorama/layout/hud.vxml_c` (whole HUD) + own script/styles.
- `.vjs_c` contains the JS source in plain text (after a binary header) → readable with a hex/latin1 dump.
- Compiled with **Dota 2 Workshop Tools** resourcecompiler; build scripts (PowerShell) in
  https://github.com/Hantu-Raya/Deadlock-mods-collection (same author as Buff Timer). **[reported]**
- Install: VPK into `game/citadel/addons/`, `gameinfo.gi` gets `Game citadel/addons` above base path. **[reported]**
  Mod manager: https://docs.deadlockmods.app/using-mod-manager/getting-started
- CSS "hijack" trick: a CSS file with the same name as Valve's overrides styles without touching XML. **[reported]**
- Client-side mods are local only; touching gameplay files risks kicks in ranked. No known VAC issue for UI mods. **[reported]**

---

## 3. Panorama API — what mods actually use **[verified from mod JS]**
API call counts across 3 mod scripts:
`$.Schedule` 32 · `$.DispatchEvent` 17 · `$.RegisterEventHandler` 9 · `$.CreatePanel` 9 · `$.GetContextPanel` 8 ·
`$.CancelScheduled` 8 · `GameUI.GetCursorPosition` 3 · `$.Msg` 2.

There is **no game data API** (no `Game.GetGameTime`, no player API). Mods scrape HUD text:
```js
// Buff Timer: read clock from top bar
root.FindChildTraverse("TopBar").FindChildrenWithClassTraverse("GameTime")[0].text  // "23:41"
```
Events seen dispatched:
`CitadelConCommand` ("say_chat_team"), `CitadelChatInputSubmitted`, `CitadelChatInputBlur`, `SetInputFocus`, `DropInputFocus`,
`UIShowTextTooltip`, `UIHideTextTooltip`, `CopyStringToClipboard`, `TextEntryInsertFromClipboard`.
Events handled: `DragStart`, `DragEnd`, `HTMLTitle`.
Persistence: `panel.SetAttributeString/Int` on top panel (session only), or the HTML-panel trick below (permanent).
Other: `root.actuallayoutwidth/height`, classes like `AspectRatio16x9`, `gScoreboardOpen`, `gShopOpen`, `connectedToHideout`.

### HTML panel bridge (Keyboard overlay v4.2.0) **[verified]**
```js
const STORE_URL = "https://kbo-overlay.pages.dev/";
store.panel = $.CreatePanel("CitadelHTMLPanel", $.GetContextPanel(), "KBOStore");
p.hittest = false; p.style.width = "2px"; p.style.height = "2px"; p.style.opacity = "0.01";
$.RegisterEventHandler("HTMLTitle", p, onStoreTitle);   // receives document.title of the page
store.panel.SetURL(STORE_URL);                           // retried up to 3x, 10 s apart
store.panel.SetURL(STORE_URL + "#" + encodeURIComponent(raw)); // write
```
The page it loads (full source):
```html
<title>KBO-LOADING</title>
<script>
(function () {
  var KEY = "kbo_cfg";
  function sync() {
    try {
      var h = location.hash.slice(1);
      if (h) localStorage.setItem(KEY, decodeURIComponent(h));
      document.title = "KBO:" + (localStorage.getItem(KEY) || "");
    } catch (e) { document.title = "KBO!" + e; }
  }
  window.addEventListener("hashchange", sync);
  sync();
})();
</script>
```
Meaning: Panorama → web via URL hash; web → Panorama via `document.title`. Page has `localStorage` and `fetch`.
Valve itself uses `CitadelHTMLPanel` in `popups/popup_news_post.xml`.
Note: the in-game browser's storage is separate from the user's normal browser.
**[unverified]**: works in replay HUD; can load `http://127.0.0.1`.

---

## 4. Valve's replay HUD **[verified, from SteamDatabase/GameTracking-Deadlock]**
Repo: https://github.com/SteamDatabase/GameTracking-Deadlock (decompiled game files, updated each patch).
Files: `game/citadel/pak01_dir/panorama/layout/replay/citadel_hud_replay.xml` (67 lines),
`.../replay/citadel_hud_replay_scrubber.xml` (17 lines), matching CSS in `panorama/styles/replay/`,
`panorama/layout/match_details_replay_button.xml`.

`citadel_hud_replay.xml` structure:
```
CitadelHudReplay.Hidden (hittest=false)
 └ #SpectatorOptionsContainer
    └ #PlaybackControls
       └ #MainPlaybackControls
          ├ .SpeedControls: buttons CitadelReplayIncrementSpeedStep(-1/+1), #SpeedDropdown (0.25,0.5,1,1.5,2,4,8,16)
          ├ .PlayControls: CitadelReplaySkipByTime(-60/-10/+10/+60), #PlayButton
          ├ .MarkerControls: CitadelReplayNextMarker(false/true), #MarkerTypeDropdown
          └ CitadelHUDReplayScrubber#ReplayScrubber
       └ #ExpandedPlaybackControls (empty)
```
Scrubber: `#SliderAndMarkers > #scrubInfo > Label#scrubInfoTime text="{s:scrubTooltipTime}"`,
`#TimeScrubContainer > Slider#TimeScrubSlider + Panel#MarkersContainer`.
Top bar clock: `citadel_hud_top_bar.xml` → `<Label class="GameTime" id="GameTime" text="{s:game_clock}"/>`, `id="TopBar"`.
`ReplayEventType_t`: CANCEL 0, DEATH 1, GENERIC 2, STUCK_NEED_FULL_UPDATE 3, VICTORY 4.

### `CitadelConCommand` usage in Valve UI (args allowed) **[verified]**
`'host_timescale 1.0'`, `'healthpct 50'`, `'citadel_spawn_trooper melee enemy'`, `'toggle hud_damagemeter'`, `'noclip'`, `'bot_kick_all'` …
→ arbitrary command strings with arguments go through. **[unverified]** whether demo/spec commands are allowed from mods in replays.

### Console commands (from `DumpSource2/commands.txt` / `convars.txt`) **[verified exist]**
Release: `demo_goto`, `demo_gotomark`, `demo_gototick`, `demo_info`, `demo_marktick`, `demo_pause`, `demo_pauseatservertick`,
`demo_resume`, `demo_step_tick`, `demo_timescale`, `demo_togglepause`, `playdemo`,
`citadel_replay_toggle_pause`, `citadel_increase_replay_speed`, `citadel_decrease_replay_speed`,
`spec_goto x y z [pitch yaw]`, `spec_setpos x y [z]`, `spec_setang pitch yaw`, `spec_dolly_in/out`, `spec_target`,
`spec_mode`, `spec_next`, `spec_prev`, `spec_player` (clientcmd_can_execute).
Dev-only (not usable): `instant_replay_*`. Cheat: `replay_death`, `replay_start`.
Convars: `citadel_auto_highlight_seconds_before/after`, `citadel_camera_spectator_dist/fov/auto_target_view`,
`citadel_hud_visible`, `citadel_hide_replay_hud`.

### Replay controls (player-facing) **[reported]**
Next/prev target Space / Alt+Space · camera mode C · fly up/down Shift/Ctrl · in-eye wheel up · chase wheel down ·
speed = / - · pause P · console F7. Replays: Profile → Match history → match → Download Replay.

---

## 5. deadlock-api.com
Docs: https://api.deadlock-api.com/docs · OpenAPI: https://api.deadlock-api.com/openapi.json · CORS `access-control-allow-origin: *` **[verified]**
Free, sponsor-funded; optional API key raises limits. Old `assets.deadlock-api.com` host **does not resolve** — assets are now `/v1/assets/*` on the main host. **[verified]**

### Match endpoints
| Endpoint | Notes / rate limits |
|---|---|
| `GET /v1/matches/{id}/metadata` | JSON. IP: cache 100/s, S3 100/10s, **Steam 3/h** |
| `GET /v1/matches/{id}/metadata/raw` | protobuf (`CMsgMatchMetaData`, `CMsgMatchMetaDataContents`) |
| `GET /v1/matches/metadata` | bulk/search, e.g. `?limit=3&min_duration_s=1500&order_by=match_id&order_direction=desc&include_info=true` |
| `GET /v1/matches/{id}/salts` | `{cluster_id, metadata_salt, replay_salt, metadata_url, demo_url}`. DB 100/s, Steam 10/30min |
| `POST /v1/matches/demo/query` | SQL over parsed demo, async (~55 s), poll `/demo/query/{job_id}`, result Parquet/NDJSON. IP 200/h |
| `GET /v1/matches/demo/schema` | queryable demo tables/columns |
| `GET /v1/matches/demo/live/query` | SQL over **live** broadcast, SSE |
| `GET /v1/matches/live/urls`, `/v1/matches/{id}/live/url` | live broadcast URLs (for demofile-net / haste) |
| `GET /v1/matches/active` | live matches |
| `GET /v1/matches/recently-fetched` | recent match ids |
| `POST /v1/matches/custom/create` etc. | custom lobbies |
Demo-query tip from docs: when a hero is dead, `CCitadelPlayerController.m_hPawn` points at `CCitadelObserverPawn`; join by hero id / pawn index.

### Player endpoints
`/v1/players/{account_id}/match-history` · `/v1/players/steam?account_ids=` (→ personaname, avatar, profileurl) ·
`/v1/players/steam-search?search_query=` · rank/mmr/hero-stats/enemy-stats/mate-stats.

### Assets
`/v1/assets/heroes` (65 entries; `id, name, class_name, images{icon_hero_card, icon_image_small, minimap_image, ...}, colors{ui, style_hex}`)
· `/v1/assets/items` (781; `id, name, type (upgrade|ability|...), item_slot_type (weapon|vitality|spirit), cost, image, item_tier, shopable`)
· `/v1/assets/map` → `radius: 10752`, `images{minimap, plain, frame, mid, mid_tunnels, rat_tunnels}`
(e.g. `https://assets-bucket.deadlock-api.com/assets-api-res/images/maps/minimap_midtown_mid.png`),
`objective_positions` (16), `zipline_paths` (3), `neutral_camps` (51), `entities` (16)
· also ranks, sounds, icons, modifiers, npc-units, convars, steam-info, client-versions.

### Metadata shape (match 125686736, 1520 s) **[verified]**
`match_info` keys: `duration_s, match_outcome, winning_team, players, start_time, match_id, game_mode, match_mode,
objectives, match_paths, damage_matrix, match_pauses, mid_boss, team_score, teams, average_badge_team0/1, ...`
Player keys: `account_id, player_slot, team, hero_id, kills, deaths, assists, net_worth, last_hits, denies, level,
items, stats, death_details, pings, ability_stats, assigned_lane, accolades, mvp_rank, power_up_buffs, ...`
- `items[]`: `{game_time_s:15, item_id:968099481, upgrade_id:1, sold_time_s:0, flags:0, imbued_ability_id:0, upgrade_info:65536}` (28 entries for one player; mix of shop items and ability unlocks/upgrades)
- `stats[]`: snapshots at 180, 360, 540 … s. Keys include `net_worth, gold_player, gold_lane_creep, gold_neutral_creep, gold_boss, gold_treasure, gold_denied, gold_death_loss, kills, deaths, assists, creep_kills, neutral_kills, player_damage, player_damage_taken, player_healing, self_healing, boss_damage, creep_damage, shots_hit, shots_missed, hero_bullets_hit(_crit), weapon_power, tech_power, max_health, heal_prevented, damage_absorbed, gold_sources`
- `death_details[]`: `{game_time_s:449, time_to_kill_s:9.63, killer_player_slot:2, death_pos{x,y,z}, killer_pos{x,y,z}, death_duration_s:50}`
- `pings[]`: `{ping_type, ping_data, game_time_s}`
- `objectives[]`: `{team_objective_id, team, destroyed_time_s, first_damage_time_s, player_damage, creep_damage, ...}` (destroyed_time_s 0 = not destroyed)
- `match_paths`: `{version, interval_s:1.0, x_resolution:16383, y_resolution:16383, paths[12]}`;
  path `{player_slot, x_min, x_max, y_min, y_max, x_pos[1521], y_pos[], health[], combat_type[], move_type[]}`
  → world = `min + pos/resolution*(max-min)`.
- Match 116416788 was a short odd mode (820 s, mostly empty) — don't use as a fixture.

### Demo files **[verified]**
`demo_url` e.g. `http://replay122.valve.net/1422450/116416788_2139165945.dem.bz2` → HTTP 200, 52.7 MB, `application/octet-stream`,
**no CORS headers, HTTP only** → browsers can't fetch it; Node can.
Metadata file: `..._<metadata_salt>.meta.bz2`.

---

## 6. Demo parsers
- **deadem** (JS, MIT): Node 18+ and browsers; ~8,500 ticks/s on M3 (30-min match ≈ 13.5 s), 3 workers +32%;
  entities, positions, chat, kill feed, ability usage, objectives, live broadcast parsing, seek-to-tick.
  https://cdn.jsdelivr.net/npm/deadem@2.0.0/README.md
- **haste** (Rust): https://github.com/blukai/haste/ — supports broadcasts.
- **boon** (Rust + Python bindings → Polars DataFrames): https://boon.readthedocs.io/en/latest/
- **demofile-net** (C#): https://github.com/saul/demofile-net
- Tick rate assumed 64/s (from deadem docs).

---

## 7. Related projects / competition
- **deadlocklabs.gg** replay viewer — primary 2D reference requested by user: https://deadlocklabs.gg/matches/125682043/?tab=replay. Exact match page was inaccessible; https://deadlocklabs.gg/matches/replays/ was readable during the follow-up check. **[verified: page content, not interactive behavior]** The site's own descriptions list a time-aware scoreboard, map layers, drawing tools, heatmaps, fight detection, comparison, screenshot export, bookmarks, and auto-highlights. Proposed differentiator: local bookmarks/comments synced with actual in-game replay. Accurate ability casts are deferred, not an MVP advantage already implemented.
- **Deadworks** — server-side C# plugin framework (like SourceMod). Ships UI by encoding ops into closed captions
  (6 captions × ~4 KB → ~16 KB/s per player), bootstrap interprets `build/set/style/destroy`. Avoids DLL injection (VAC risk).
  Server-only, not useful for local replays. https://deadworks.net/blog/we-ship-our-ui-through-a-subtitle-system
- deadlock-api.com has its own kill heatmap, stream kit, data dumps.

---

## 8. Platform notes
- Deadlock + Workshop Tools are Windows-only → the mod must be built and tested on Windows.
- Companion app (Electron) can be developed/tested on Mac; ship Windows build.
- Steam store screenshots used in `mockup/assets/` are Valve's: fine locally, don't publish.

---

## 9. Open questions (test in Phase 0, see PLAN.md)
1. Mod panel visible and clickable in replay HUD.
2. Clock scrape works during replay.
3. Correct `CitadelReplaySkipByTime` dispatch form from JS.
4. `CitadelHTMLPanel` in replay HUD + loading `http://127.0.0.1`.
5. `spec_player` / `spec_mode` via `CitadelConCommand`.
6. Match ID visible anywhere in the replay HUD.
7. Does the in-game clock pause during `match_pauses`?
8. Minimap image ↔ world coordinates (assume `[-10752, 10752]`, y flipped).

---

## 10. Sources
- https://gamebanana.com/games/20948 · https://gamebanana.com/mods/606414 · https://gamebanana.com/mods/615358
- https://github.com/SteamDatabase/GameTracking-Deadlock · https://github.com/SteamDatabase/Protobufs
- https://github.com/Hantu-Raya/Deadlock-mods-collection
- https://api.deadlock-api.com/docs · https://deadlock-api.com/
- https://deadworks.net/blog/we-ship-our-ui-through-a-subtitle-system · https://docs.deadworks.net/api-reference/ui
- https://docs.deadlockmods.app/using-mod-manager/getting-started · https://www.esports.net/wiki/guides/deadlock-mod-install
- https://esports.gg/news/deadlock/how-to-watch-and-download-your-match-replay-in-deadlock
- https://developer.valvesoftware.com/wiki/List_of_Deadlock_console_commands_and_variables · https://s2v.app/SchemaExplorer/deadlock/convars
- https://cdn.jsdelivr.net/npm/deadem@2.0.0/README.md · https://boon.readthedocs.io/en/latest/ · https://github.com/blukai/haste/
- https://store.steampowered.com/api/appdetails?appids=1422450 (screenshots)
