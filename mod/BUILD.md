# Windows spike

Source and protocol tests run on Mac. Compilation, installation, and in-game behavior are **not yet verified**.

1. Start the companion and set an active match.
2. Obtain the compiler wrapper and `vpkeditcli.exe` used by [Deadlock mods collection](https://github.com/Hantu-Raya/Deadlock-mods-collection). The wrapper takes a source directory and writes `<source>_compiled`; this is **not** Valve resourcecompiler's command-line interface. No tool binaries are bundled.
3. Build on Windows: `node mod/build.mjs "C:\tools\compiler.exe" "C:\tools\vpkeditcli.exe"`
4. Copy the printed VPK to Deadlock's `game/citadel/addons/`, choosing an unused `pakNN_dir.vpk` name. Ensure `Game citadel/addons` precedes the base game path in `gameinfo.gi`; the build does not edit game files.
5. Open a real replay. Use the right-side spike panel to check the clock, bookmark delivery, each seek signature separately, and the two spectator commands. Add a bookmark in the companion and check the game's bookmark count updates.

Mac source preparation only: `node mod/build.mjs --prepare-only`

Pass the companion data directory as the last argument to use a non-default workspace. Generated source and VPKs include the local bridge token and stay in ignored `mod/build/`. Keep these generated files local.

The spike does not synchronize game playback time to the map yet. It exists to establish the actual replay/bridge APIs before implementing that contract. Save manual results in ignored `mod/SPIKE_RESULTS.md`.

Valve replay layout source: [GameTracking-Deadlock](https://github.com/SteamTracking/GameTracking-Deadlock/blob/master/game/citadel/pak01_dir/panorama/layout/replay/citadel_hud_replay.xml), retrieved 2026-10-27. Recheck the override after game patches.
