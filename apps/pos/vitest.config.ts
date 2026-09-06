import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e/** runs via WebDriverIO + tauri-driver (`pnpm test:e2e`),
    // not Vitest — it uses wdio/mocha's injected globals (`browser`, `$`),
    // which don't exist under Vitest.
    exclude: ["**/node_modules/**", "**/tests/e2e/**"],
  },
});
