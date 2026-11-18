import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_STORE_MANAGER_EMAIL, SEEDED_SECOND_STORE_MANAGER_EMAIL, SEEDED_PASSWORD } from "./support/login";

// US4 stock transfer E2E (T104): request -> dispatch -> receive-with-variance.
// `transfer_events_insert_by_manager` (0009_rls_policies.sql) scopes a
// store_manager's inserts to owning source_store_id (request/dispatch) or
// destination_store_id (receive/variance), so this drives the source store's
// manager and the destination (Kitwe) store's manager as two separate
// sessions — both seeded directly in supabase/seed/seed.sql.

const SECOND_STORE_ID = "35000000-0000-4000-8000-000000000002";
const SECOND_STORE_NAME = "Harvest Group Kitwe Store";
const SOURCE_SKU_CODE = "PILOT-SKU-001";

test.describe("US4 stock transfer: request -> dispatch -> receive with variance", () => {
  test("50-unit transfer receives 48 units and records a distinct 2-unit variance line", async ({ page, browser }) => {
    // Request + dispatch as the seeded source-store manager.
    await loginAs(page, SEEDED_STORE_MANAGER_EMAIL);
    await page.goto("/transfers");

    await page.getByRole("button", { name: "New transfer request" }).click();
    await page.selectOption("#destination-store", SECOND_STORE_ID);
    const skuValue = await page.locator("#line-sku-0 option", { hasText: SOURCE_SKU_CODE }).first().getAttribute("value");
    await page.selectOption("#line-sku-0", skuValue ?? "");
    await page.fill("#line-qty-0", "50");
    await page.getByRole("button", { name: "Submit request" }).click();

    const sourceTransferRow = page.locator("tbody tr", { hasText: SECOND_STORE_NAME }).first();
    await expect(sourceTransferRow.getByText("Requested")).toBeVisible();

    await sourceTransferRow.getByRole("button", { name: "Dispatch" }).click();
    await page.getByRole("button", { name: "Confirm dispatch" }).click();
    await expect(sourceTransferRow.getByText(/In transit|Dispatched/)).toBeVisible();

    // Receive (short by 2 units) as the destination store's manager, in an
    // independent browser context/session.
    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    await loginAs(managerPage, SEEDED_SECOND_STORE_MANAGER_EMAIL, SEEDED_PASSWORD);
    await managerPage.goto("/transfers");

    const destTransferRow = managerPage.locator("tbody tr", { hasText: SECOND_STORE_NAME }).first();
    await destTransferRow.getByRole("button", { name: "Receive" }).click();
    await managerPage.fill("#line-qty-0", "48");
    await managerPage.getByRole("button", { name: "Confirm receipt" }).click();

    // The variance must be its own distinct -2 line, never silently folded
    // into the received quantity (US4 acceptance scenario 1 / FR-014).
    await expect(destTransferRow.getByText("Received (variance)")).toBeVisible();
    await expect(destTransferRow.getByText(/-2\b/)).toBeVisible();

    await managerContext.close();
  });
});
