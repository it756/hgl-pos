# Phase 0a Spike Report

**Status**: PROVISIONAL PASS - proceed with the primary PowerSync Tauri SDK path for Phase 3.

This report records the Phase 0a runtime spike executed on the Windows Tauri POS
shell. The spike validated local-first SQLite writes, read-backs, DB file
placement outside watched source paths, PowerSync internal queue visibility, and
crash/restart persistence. App-update installer persistence is not yet directly
executable because the production installer/update flow is not available at this
stage; it remains a packaging validation before pilot release.

## Test environment

- Windows build/SKU: Windows development machine running the Tauri POS shell
- PowerSync Tauri package: `@powersync/tauri-plugin` 0.0.6 with `tauri-plugin-powersync` 0.0.6
- Date executed: 2026-09-04
- Tester: David Okuku

## Pass criteria (research.md §12)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| a | SDK does not crash under normal write load | PASS | Seed cashier, open shift, complete sale, and count rows all succeeded using the Tauri WebView and PowerSync Tauri database. Row counts after writes: users 1, shifts 1, sale_events 1. |
| b | Local SQLite file survives an app-update install (not just restart) | DEFERRED FOLLOW-UP | The DB is now created under `C:\Users\David Okuku\AppData\Roaming\com.harvestgroup.hglpos\powersync.db`, outside `apps/pos/src-tauri` and outside the app binary directory. Restart persistence was observed. Installer/update persistence must be checked when MSI/NSIS updater packaging is exercised. |
| c | IPC between Tauri Rust shell and WebView JS stable under repeat cycles | PASS | Tauri `invoke` commands worked for `spike_prepare_db_dir` and `spike_locate_db`; PowerSync plugin IPC initialized successfully after adding the app-data directory preparation command. |
| d | No data loss under `kill -9`-equivalent mid-write (spike page "Simulate crash" button) | PASS | The observed Tauri process exit `0xc0000409` was caused by the deliberate crash test. After restart, DB initialization succeeded and persisted rows remained readable. |

## Outcome

PASS - proceed to Phase 3 on the primary Tauri SDK path.

The sidecar fallback is not activated. The spike exposed alpha-SDK caveats that
Phase 3 should account for:

- `dbFilename` alone resolves relative to `apps/pos/src-tauri` in dev and causes SQLite WAL/SHM files to trigger Tauri rebuild loops. The app must use an app-data directory and create it before opening PowerSync.
- `getUploadQueueStats()` currently fails on this Tauri alpha path with `SQLite: attempt to write a readonly database` because it uses the shared JS `readTransaction()` path. Direct reads from `ps_crud` work; the spike returned `upload queue rows from ps_crud: 4`.
- The app-update persistence criterion remains a packaging follow-up before pilot rollout, not a reason to switch SDK paths now.

## Raw evidence

Selected raw log excerpts:

```text
2026-09-04T10:13:54.563Z DB init: SUCCESS - instance ready.
2026-09-04T10:13:54.610Z Verified row: {"id":"spike-cashier-1","full_name":"Spike Cashier"}
2026-09-04T10:14:05.421Z Verified row: {"id":"spike-shift-1","status":"open"} (offline - no network call)
2026-09-04T10:14:12.806Z Verified row: {"event_id":"2269b709-742b-407d-ae35-46c09ec9dfc8","grand_total":42.5} (offline)
2026-09-04T10:14:25.353Z Row counts - users: 1, shifts: 1, sale_events: 1
2026-09-04T10:14:28.545Z FOUND [app_data_dir] C:\Users\David Okuku\AppData\Roaming\com.harvestgroup.hglpos\powersync.db (4096 bytes)
upload queue rows from ps_crud: 4
```
