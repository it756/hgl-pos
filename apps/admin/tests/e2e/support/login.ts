import type { Page } from "@playwright/test";

// Shared login helper for admin E2E specs (T085, T104, T124) — seeded
// accounts from supabase/seed/seed.sql. Local dev password per repo memory.
export const SEEDED_HQ_ADMIN_EMAIL = "hq.admin@hgl.local";
export const SEEDED_STORE_MANAGER_EMAIL = "store.manager@hgl.local";
export const SEEDED_SECOND_STORE_MANAGER_EMAIL = "kitwe.manager@hgl.local";
export const SEEDED_PASSWORD = "local-dev-password";

export async function loginAs(page: Page, email: string, password = SEEDED_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}
