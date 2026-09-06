import path from "node:path";
import type { Options } from "@wdio/types";

// WebDriverIO + tauri-driver E2E harness (T063). Local prerequisites this
// repo does not (and should not) automate in CI-agnostic config:
//   1. `cargo install tauri-driver` once (the WebDriver → WebView2 bridge).
//   2. A debug build of the Tauri binary this config points at:
//      `pnpm --filter @hgl/pos tauri build --debug` (or `cargo build` inside
//      apps/pos/src-tauri), producing target/debug/hgl-pos.exe.
//   3. `tauri-driver --port 4444` running before `pnpm --filter @hgl/pos
//      test:e2e` starts — there is no published wdio "service" that manages
//      tauri-driver's lifecycle for Tauri 2 yet, so it must already be up.
// See specs/001-retail-pos-mvp/quickstart.md for the full local run recipe.

const APPLICATION_PATH = path.join(__dirname, "src-tauri", "target", "debug", "hgl-pos.exe");

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./tests/e2e/**/*.spec.ts"],
  maxInstances: 1,
  hostname: "localhost",
  port: 4444,
  path: "/",
  capabilities: [
    {
      // @ts-expect-error — tauri:options isn't in WebdriverIO's upstream capability types.
      "tauri:options": { application: APPLICATION_PATH },
    },
  ],
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
