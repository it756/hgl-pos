# Phase 0a Spike Report — TEMPLATE (fill in from real hardware testing)

**Status**: ⚠️ NOT YET EXECUTED — this is a template, not a result.

**Instructions**: Run `pnpm --filter @hgl/pos tauri:dev`, navigate to `/spike`,
work through the numbered steps, and record actual observations below. Do not
mark T017/T018 complete in [tasks.md](tasks.md) until this file reflects real
evidence gathered on the actual target Windows POS hardware.

## Test environment

- Windows build/SKU: _fill in_
- `@powersync/tauri` version installed: _fill in (check `pnpm ls @powersync/tauri`)_
- Date executed: _fill in_
- Tester: _fill in_

## Pass criteria (research.md §12)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| a | SDK does not crash under normal write load | ☐ PASS / ☐ FAIL | _link to log / screenshot_ |
| b | Local SQLite file survives an app-update install (not just restart) | ☐ PASS / ☐ FAIL | _file timestamp before/after installer run_ |
| c | IPC between Tauri Rust shell and WebView JS stable under repeat cycles | ☐ PASS / ☐ FAIL | _describe cycle count and any errors_ |
| d | No data loss under `kill -9`-equivalent mid-write (spike page "Simulate crash" button) | ☐ PASS / ☐ FAIL | _row count in sale_events before/after restart_ |

## Outcome

☐ **PASS** — proceed to Phase 3 on the primary Tauri SDK path.
☐ **FAIL** — apply the Tauri sidecar fallback per [research.md §12.1](research.md). Sidecar transport chosen: ☐ loopback HTTP ☐ Tauri `invoke` forwarding. Justification: _fill in_.

## Raw evidence

Link or paste screenshots / logs / file listings under `spike-evidence/` (git-ignored — do not commit raw evidence containing device identifiers).
