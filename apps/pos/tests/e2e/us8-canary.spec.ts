import { expect } from "@wdio/globals";

// T131 E2E (WebDriverIO + tauri-driver) for the US8 canary-cohort story
// (T126, apps/pos/src-tauri/src/cohort.rs).
//
// SCOPE NOTE — read this before extending: tasks.md's phrasing for this
// task ("deploy N+1 to one store while N stays on others, both sync
// concurrently, assert the migration linter would catch a breaking column
// drop") describes a MULTI-DEVICE fleet-deployment/ops scenario. A single
// WebDriverIO spec drives exactly one Tauri instance against one till's
// local build — it cannot stand up a second till on a different app
// version, cannot make two tills "sync concurrently", and cannot itself
// run a migration linter. Those two claims are already covered elsewhere,
// not re-tested (or faked) here:
//   - "both cohorts sync concurrently with no data loss" is covered
//     server-side by supabase/tests/backward_compat.spec.sql (T132), which
//     proves the CURRENT schema accepts both an old-shaped and a
//     new-shaped event payload for the same tables — the actual mechanism
//     that makes concurrent mixed-version sync safe.
//   - "the migration linter would catch a breaking column drop" is
//     verified directly by T127's own tool and its tests:
//     packages/db-shared/scripts/check-migration-compat.ts (see
//     `checkMigrationFile`/`checkMigrationsDirectory` there). Re-deriving
//     that logic from a WDIO spec against a running till would test
//     nothing new.
//
// What IS genuinely testable against one real build, and what this spec
// covers: a single till correctly reports the release channel
// (stable/canary) it was built for, via the `get_cohort_channel` Tauri
// command (registered in apps/pos/src-tauri/src/lib.rs, implemented in
// cohort.rs). This is the one per-till, single-instance-observable piece
// of the canary story — everything upstream of "which channel does THIS
// till think it's on" is a fleet/deployment concern, not an app-behavior
// one.
//
// This repo's dev fixture (src-tauri/resources/cohort.config.json) bundles
// `{ "channel": "stable", "store_id": null }`, and `cohort::load_cohort_config`
// falls back to that same "stable" default on any read error — so a debug
// build produced via `pnpm --filter @hgl/pos tauri build --debug` (see
// wdio.conf.ts header for the full local run recipe) always reports
// "stable" here. There is no canary-flavored build artifact checked into
// this repo to assert the other branch against; a real canary pilot would
// swap in a `cohort.config.json` with `"channel": "canary"` at build time
// (per cohort.rs's own header comment), not toggle it at runtime.
//
// Calls the Tauri command directly via the webview's always-present
// `window.__TAURI_INTERNALS__.invoke` bridge — the same bridge
// `@tauri-apps/api/core`'s `invoke()` wraps internally (see
// apps/pos/src/app/spike/page.tsx's `assertTauriIpcAvailable` for the same
// internals check) — rather than adding a new UI surface purpose-built for
// this test.

interface CohortConfig {
  channel: string;
  store_id: string | null;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<CohortConfig> };
  }
}

describe("US8 — till reports its assigned canary/stable cohort channel", () => {
  it("reads the bundled cohort config via the get_cohort_channel Tauri command", async () => {
    await browser.url("/login");

    const cohort = await browser.execute(async () => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        throw new Error("Tauri IPC is not available in this webview context.");
      }
      return internals.invoke("get_cohort_channel");
    });

    expect(cohort.channel).toBe("stable");
    expect(cohort.store_id).toBeNull();
  });
});
