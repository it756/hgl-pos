import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e/** runs via Playwright (`pnpm test:e2e`), not Vitest — its
    // test()/test.describe() come from @playwright/test, which Vitest's
    // default include glob (**/*.spec.ts) picks up and fails to import.
    exclude: ["**/node_modules/**", "**/tests/e2e/**"],
  },
});
