import { expect, test } from "@playwright/test";
import { loginAs, SEEDED_HQ_ADMIN_EMAIL } from "./support/login";

// T085: US2 price-change flow — HQ admin submits a price change on
// /prices, then confirms it surfaces in the /audit/prices table.

test("HQ admin submits a price change and it appears in the price audit log", async ({ page }) => {
  await loginAs(page, SEEDED_HQ_ADMIN_EMAIL);

  await page.goto("/prices");
  await expect(page.locator("#sku_id")).toBeVisible();

  const skuLabel = await page.locator("#sku_id option").first().textContent();
  await page.locator("#sku_id").selectOption({ index: 0 });

  const reason = `E2E price change ${Date.now()}`;
  await page.fill("#new_unit_price", "77.77");
  await page.fill("#reason", reason);

  await page.click('button[type="submit"]');
  await expect(page.getByText("Price change committed.")).toBeVisible({ timeout: 10_000 });

  await page.goto("/audit/prices");
  await page.getByPlaceholder("Search actor, SKU, reason…").fill(reason);

  const row = page.locator("table tbody tr").first();
  await expect(row).toContainText(reason);
  await expect(row).toContainText("77.77");
  if (skuLabel !== null) {
    await expect(row).toContainText(skuLabel.split(" — ")[0] ?? "");
  }
});
