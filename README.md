# Replay Mark

Local Deadlock replay companion: 2D match playback, bookmarks, comments, item history, stats, and kill feed. Windows desktop app source and dependency-free browser/server mode.

## Run

- Browser mode, Node 22.12+: `node app/server.js`
- Open http://127.0.0.1:47800/
- Desktop, after installing dependencies: `npm --prefix app install && npm --prefix app start`
- Seeded demo with the existing mockup workspace: `node mockup/server.mjs`
- Tests, no installation required: `node --test app/test/*.test.mjs`
- Electron UI check: `npm --prefix app run test:ui`
- Live match UI check (network required): `npm --prefix app run test:ui -- --live`
- Windows package, after installing dependencies: `npm --prefix app run dist`

Close browser-mode server before starting desktop app; both use port 47800.

## Current behavior

- Fresh app storage starts without bookmarks or an active match. Sample data is available to explore; select **Set active** to connect it to the HUD simulator.
- Load match ID, or numeric Steam account ID → recent match. Actual metadata, hero/item/map assets, and player names are fetched by Node and cached.
- Replay controls, timestamp entry, timeline events, selected-player trail, and inventory all use the current replay time. Team souls, levels, and K/D/A use recorded stats snapshots; health uses movement samples. Unavailable values stay unknown, and positions are hidden after an incomplete path ends.
- Map has trails/deaths/objectives toggles. Bookmarks support tags, edits, deletion, comments, clickable comment timestamps, and SSE updates.
- HUD simulator at `/hud` exercises the URL/title bridge and shared playback. It does not control Deadlock.
- Desktop startup uses an isolated, sandboxed renderer, one app instance, and waits for pending storage writes before quitting.

## Storage

- Windows: `%APPDATA%/replay-mark/`
- macOS: `~/Library/Application Support/replay-mark/`
- Linux: `$XDG_DATA_HOME/replay-mark/`, or `~/.local/share/replay-mark/`
- Override standalone storage: `REPLAY_MARK_DATA_DIR=./app/.data node app/server.js`
- Demo storage remains `mockup/.data/`; moving code did not move or delete saved demo notes.

One server process per data directory. Bookmark writes serialize and use temp-file replacement. Invalid saved JSON stops startup without overwriting it. Bridge acknowledgements persist with writes. Restart pauses playback at the last saved control position.

## UI reference

[Deadlock Labs match replay](https://deadlocklabs.gg/matches/125682043/?tab=replay) is the primary reference for the 2D companion. Its [public replay feature page](https://deadlocklabs.gg/matches/replays/) informed map/scoreboard/timeline interactions. Exact match view could not be inspected here. Drawing tools, heatmaps, fight detection, comparison, and export are possible later additions, outside the current implementation.

## Verification and remaining work

- Eight automated checks pass, including a scrubbed real-data fixture for match 125686736. They cover non-contiguous player slots, incomplete paths, health, stats gaps, objective names, and buy/sell boundaries, alongside desktop policy, storage, HTTP/SSE, and bridge checks.
- Unit HTTP tests use an in-memory stream transport. The Electron UI check also runs a real loopback server and exercises companion/HUD sync, timestamp seeking, bookmarks, comments, map layers, tabs, and mobile width. Screenshots are saved under `app/.data/`.
- Desktop dependencies are installed and pinned by `app/package-lock.json`. The native UI check passes; Windows packaging and installation are still unverified.
- Live UI loading passed for match 125682043: 15:52 duration, 12 players, loaded minimap, health, and levels. Real map calibration and patch-compatible assets still need verification. Objective names come from the protobuf enum; real objective map positions remain unmapped. API cache misses use `disable_steam=true` and report errors rather than substituting sample data.
- Phase 0 Windows spike is still required before the real Panorama mod. No VPK or working in-game integration is claimed.
