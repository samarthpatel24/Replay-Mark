# Replay Mark demo

Shared implementation now lives in `app/`; this launcher keeps existing demo notes and the original command working.

- Run: `node mockup/server.mjs`
- Companion: http://127.0.0.1:47800/
- HUD simulator: http://127.0.0.1:47800/hud
- Tests: `node --test app/test/*.test.mjs`
- Storage: `mockup/.data/` (unchanged).

## Walkthrough

1. Open companion and HUD simulator. Play, seek, change speed, or type `12:40` in **Go to**. Active playback updates in both windows.
2. Select player; inspect trail, current inventory, buy/sell history, and stats. Toggle map layers.
3. Add bookmark in HUD; it appears in companion. Edit it in companion, then add a comment with a timestamp. Click comment time to seek.
4. Delete bookmark; both windows update. Restart server to check persistence.
5. Load a real match or player history. Click **Set active** to switch HUD and shared playback.

Generated sample data is not actual match 125686736. The HUD is a browser simulation, not an in-game mod. Original screenshot assets remain here as local references and are excluded from app packaging.

See [project README](../README.md) for app setup, limitations, and verification status.
