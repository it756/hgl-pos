import { defineConfig, devices } from "@playwright/test";

// Shared Playwright harness for apps/admin E2E specs (T085, T104, T124).
// Requires local Supabase running (`supabase start`) with the seeded
// accounts from supabase/seed/seed.sql — these specs do not seed data
// themselves. Starts its own `next dev` server against port 3000; reuses
// an already-running one locally to avoid double-starting during dev.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
