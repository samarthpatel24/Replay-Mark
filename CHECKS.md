# Plan, research, and mockup checks

Checked 2026-10-27. Read PLAN.md, RESEARCH.md, and original mockup completely. Findings below concern the written design unless explicitly marked as prototype behavior. No in-game claim was independently verified.

## Design findings

| Priority | Evidence | Concrete failure | Smallest correction |
| --- | --- | --- | --- |
| High | PLAN.md:128–129, 199 | Title changes only when state changes, but connection expires after six seconds without a title event. An idle healthy connection turns red. | Include heartbeat in title or use a separate liveness signal. Prototype includes heartbeat. |
| High | PLAN.md:122, 198 | Retransmitted add can create duplicates after lost acknowledgement. A nonce alone does not define deduplication, ordering, or reset behavior across HUD reloads. | Session ID, monotonic sequence, queued delivery, persisted deduplication receipt. Prototype handles one outstanding HUD operation. |
| High | PLAN.md:124–137 | Pending add retried after active-match switch can land in a different match; delete by ID can also cross match boundaries. | Bind every operation to expected active match and reject mismatch; verify delete ownership. Prototype rejects these cases. |
| High | PLAN.md:93, 133–134 | Auth is both mandatory and deferred. Loopback binding alone is not authorization. | Choose one policy; protect local writes from first usable build. Prototype uses token, Host, Origin, and cross-site checks. |
| High | PLAN.md:134, 207–209 | A token is to be baked into mod URL, but installer only copies an already compiled VPK. Copying cannot change its compiled script. | Specify a supported runtime token source or an actual compile/repack step; verify it on Windows. Still unresolved for real mod. |
| Medium | PLAN.md:5–6, 121–130, 179 | Protocol carries bookmarks but no replay clock/playback state. App map will not automatically follow in-game pause, seek, or speed. | Clarify bookmark-only sync or add explicit game clock telemetry and seek ownership. Prototype shares simulator playback only; this does not verify real game sync. |
| Medium | PLAN.md:196 | Retrying a relative seek after 0.6s can duplicate a successful seek whose HUD clock has not updated yet. Switching signature at runtime also hides the actual API contract. | Resolve signature in spike. Observe seek completion; do not blindly repeat original relative delta. |
| Medium | PLAN.md:174 | Temp + rename reduces partial-file risk but does not guarantee zero data loss on crash, serialize concurrent writes, or handle malformed existing data. | Serialize writes, fail without overwriting corruption, define durability needs. Prototype serializes and preserves corruption; no power-loss durability claim. |
| Medium | PLAN.md:68–69, 178 | Latest map/assets may not match historical match patch. Radius alone does not establish image alignment or vertical layer. | Verify map transform visually and select patch-compatible assets where possible. Prototype labels real transform uncalibrated. |
| Medium | PLAN.md:184–187 | First test run depends on live fixture fetch and upstream availability/rate limits. A cache on one machine does not make tests reproducible. | Check in a scrubbed fixture or use deterministic injected responses; keep live integration check separate. Prototype uses generated data and injected API responses, explicitly labeled. |
| Medium | PLAN.md:91, 205; RESEARCH.md:224 | Node 18+ is broad and Windows toolchain/build assumptions are not validated by the packaging command. | Pin supported runtime/tool versions and test actual Windows build. Prototype requires Node 22+; packaging remains untested. |

## External source checks

- [Deadlock API OpenAPI](https://api.deadlock-api.com/openapi.json) was accessible. It confirms metadata, salts, assets, profiles, history, and demo-query routes. Documented metadata Steam fallback remains 3 requests/hour per IP. Metadata supports `disable_steam`; map assets support `client_version`. This verifies the contract, not the sample response or CORS headers.
- [Deadlock mods collection](https://github.com/Hantu-Raya/Deadlock-mods-collection) was accessible and lists PowerShell build scripts. Their compiler invocation was not retrieved, so tool compatibility is not independently confirmed.
- [Keyboard input overlay listing](https://gamebanana.com/mods/615358) exists. Downloaded compiled mod and hosted bridge page were not available for inspection; the research's JS extraction remains prior reported evidence.
- [Deadem upstream](https://github.com/Igor-Losev/deadem) confirms JavaScript demo parsing and MIT license. Exact version-2.0.0 benchmarks and assumed tick rate were not reproduced. Do not turn those estimates into performance guarantees.
- [electron-builder documentation](https://www.electron.build/docs/features/multi-platform-build/) confirms Windows cross-build tooling has platform constraints. Packaging and installer behavior still require real builds.
- Direct metadata/assets calls, Valve replay XML retrieval, and several linked source pages failed through available network tools. Shell DNS was unavailable. Current match contents, asset counts, command flags, CORS, and source line counts remain unverified.
- Feasibility percentages in RESEARCH.md are estimates without measured basis. Mod safety/VAC claims and screenshot publication rights were not established by this check.

## Original mockup findings

- Generated ability timings, team/public visibility, share codes, camera presets, and in-game comments exceeded the written MVP. None represented a connected backend.
- `btoa()` fails for non-Latin-1 titles (for example emoji). Truncating encoded JSON also prevented a usable round-trip share code.
- Death assignment used index *after* filtering recent deaths, so displayed dead hero could change as prior deaths expired.
- Match 116416788 and mock duration 34:20 contradicted research's 820-second odd-mode fixture and the selected test match.
- Notes lived only in memory; reload discarded them. Sync indicator was a timer, with no server connection.

These mockup behaviors were replaced with the local prototype described in mockup/README.md. Deferred features were removed, sample data is explicit, and connection status comes from real transports.

## Remaining acceptance gates

1. Run browser walkthrough from mockup/README.md on an unrestricted machine; check desktop/mobile layout and keyboard behavior.
2. Fetch a real match and visually calibrate positions against the correct map version. Check gaps, deaths, pause semantics, and player/hero changes.
3. Execute all Phase 0 checks on Windows, especially localhost HTML loading and relative seek behavior.
4. Resolve production token provisioning and replay telemetry before implementing the real mod.
5. Build and install VPK and Electron artifacts on Windows; check game patches, update behavior, port conflicts, and writable storage paths.
