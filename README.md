# Replay Mark

Local Deadlock replay companion: 2D match playback, bookmarks, comments, item history, stats, and kill feed. Windows desktop app source and dependency-free browser/server mode.

## Run

- Browser mode, Node 22.12+: `node app/server.js`
- Open http://127.0.0.1:47800/
- Desktop, after installing dependencies: `npm --prefix app install && npm --prefix app start`
- Seeded demo with the existing mockup workspace: `node mockup/server.mjs`
- Tests, no installation required: `node --test app/test/*.test.mjs`
- Windows package, after installing dependencies: `npm --prefix app run dist`

Close browser-mode server before starting desktop app; both use port 47800.

## Current behavior

- Fresh app storage starts without bookmarks or an active match. Sample data is available to explore; select **Set active** to connect it to the HUD simulator.
- Load match ID, or numeric Steam account ID → recent match. Actual metadata, hero/item/map assets, and player names are fetched by Node and cached.
- Replay controls, timestamp entry, timeline events, selected-player trail, and inventory all use the current replay time. Team souls and K/D/A use recorded stats snapshots; unavailable values stay unknown.
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

- Seven automated checks pass: desktop startup/navigation/shutdown policy with Electron doubles, time parsing, map decoding and item boundaries, fresh storage, HTTP handlers/SSE/validation/cache/persistence, corrupt-file preservation, and the actual hash/title bridge script.
- HTTP tests use an in-memory stream transport because this sandbox blocks listening ports. Browser layout and actual socket behavior remain unverified here.
- npm registry DNS is blocked in this environment, so dependency installation, Electron launch, and Windows builds have not run. No lockfile was generated.
- Real map calibration, patch-compatible assets, objective ID names, and live API data still need verification. API cache misses use `disable_steam=true` and report errors rather than spending Steam fallback requests or substituting sample data.
- Phase 0 Windows spike is still required before the real Panorama mod. No VPK or working in-game integration is claimed.
- See [PLAN.md](PLAN.md), [RESEARCH.md](RESEARCH.md), and [CHECKS.md](CHECKS.md).
