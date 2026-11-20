import { expect, test, type Page } from "@playwright/test";
import { loginAs, SEEDED_HQ_ADMIN_EMAIL, SEEDED_STORE_MANAGER_EMAIL } from "./support/login";

// Phase 14 (admin completion) — every console route renders for the roles
// that can see it, and the main write flows work end-to-end against local
// Supabase. Writes use unique suffixes so the spec can be re-run.

const HQ_ROUTES = [
  "/",
  "/sales",
  "/shifts",
  "/customers",
  "/customers?tab=tiers",
  "/catalog",
  "/catalog?tab=categories",
  "/catalog?tab=availability",
  "/catalog?tab=import",
  "/prices",
  "/promotions",
  "/audit/prices",
  "/inventory",
  "/counts",
  "/adjustments",
  "/reports/schedules",
  "/stores",
  "/tills",
  "/users",
  "/settings",
];

const MANAGER_ROUTES = ["/", "/sales", "/shifts", "/customers", "/catalog?tab=availability", "/counts", "/adjustments", "/reports/schedules", "/tills", "/users"];

// Dev-server compiles on first hit can be slow; wait for the sheet to close
// (which only happens on a successful save) before asserting on the list.
async function expectSheetClosed(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
}

async function expectRendered(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBeLessThan(400);
  await expect(page.locator("main :is(h1, h2, h3)").first(), `${path} heading`).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Unhandled Runtime Error|Application error|Failed to load/i)).toHaveCount(0);
}

test.describe("admin completion", () => {
  test.setTimeout(180_000);

  test("HQ admin can open every console route", async ({ page }) => {
    await loginAs(page, SEEDED_HQ_ADMIN_EMAIL);
    for (const path of HQ_ROUTES) await expectRendered(page, path);
  });

  test("store manager sees their routes and is bounced from HQ-only ones", async ({ page }) => {
    await loginAs(page, SEEDED_STORE_MANAGER_EMAIL);
    for (const path of MANAGER_ROUTES) await expectRendered(page, path);
    await expect(page.locator("nav").getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/$/);
  });

  test("HQ admin manages master data", async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);
    await loginAs(page, SEEDED_HQ_ADMIN_EMAIL);

    await page.goto("/stores");
    await page.getByRole("button", { name: "Add store" }).click();
    await page.fill("#store-code", `E2E-${suffix}`);
    await page.fill("#store-name", `E2E Store ${suffix}`);
    await page.getByRole("button", { name: "Save store" }).click();
    await expectSheetClosed(page);
    await expect(page.getByRole("cell", { name: `E2E-${suffix}` })).toBeVisible();

    await page.goto("/tills");
    await page.getByRole("button", { name: "Provision till" }).click();
    await page.locator("#till-store").selectOption({ label: `E2E Store ${suffix} (E2E-${suffix})` });
    await page.fill("#till-label", `T-${suffix}`);
    await page.fill("#till-device", `e2e-device-${suffix}`);
    await page.getByRole("button", { name: "Provision", exact: true }).click();
    await expect(page.getByTestId("till-credential")).not.toBeEmpty({ timeout: 30_000 });
    await page.getByRole("button", { name: "I've saved it" }).click();
    await expect(page.getByRole("cell", { name: `T-${suffix}` })).toBeVisible();

    await page.goto("/catalog");
    await page.getByRole("button", { name: "Add SKU" }).click();
    await page.fill("#sku-code", `E2E-SKU-${suffix}`);
    await page.fill("#sku-name", `E2E Product ${suffix}`);
    await page.getByRole("button", { name: "Save SKU" }).click();
    await expectSheetClosed(page);
    await page.fill("#sku-search", `E2E-SKU-${suffix}`);
    await expect(page.getByRole("cell", { name: `E2E-SKU-${suffix}` })).toBeVisible();

    await page.goto("/customers?tab=tiers");
    await page.getByRole("button", { name: "Add tier" }).click();
    await page.fill("#tier-code", `gold${suffix}`);
    await page.fill("#tier-name", `Gold ${suffix}`);
    await page.getByRole("button", { name: "Save tier" }).click();
    await expectSheetClosed(page);
    await expect(page.getByRole("cell", { name: `gold${suffix}` })).toBeVisible();

    await page.goto("/customers");
    await page.getByRole("button", { name: "Add customer" }).click();
    await page.fill("#customer-name", `E2E Customer ${suffix}`);
    await page.fill("#customer-phone", `+260 97 0${suffix}`);
    await page.locator("#customer-tier").selectOption({ label: `Gold ${suffix}` });
    await page.getByRole("button", { name: "Save customer" }).click();
    await expectSheetClosed(page);
    await expect(page.getByRole("cell", { name: `E2E Customer ${suffix}` })).toBeVisible();

    await page.goto("/settings");
    await page.fill("#expiry_warning_days", "21");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status")).toContainText(/Saved|No changes/, { timeout: 30_000 });
    await page.goto("/audit");
    await expect(page.getByText("system_settings.update").first()).toBeVisible();
  });

  test("HQ admin imports products from CSV with an audited price", async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);
    await loginAs(page, SEEDED_HQ_ADMIN_EMAIL);
    await page.goto("/catalog?tab=import");
    const csv = `code,name,unit_type,barcode,price\nCSV-${suffix},CSV Product ${suffix},quantity,99${suffix},12.34\nBAD-${suffix},,quantity,,\n`;
    await page.locator("#catalog-csv").setInputFiles({ name: "import.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByText("1 valid, 1 with errors")).toBeVisible();
    await page.getByRole("button", { name: "Import 1 row(s)" }).click();
    await expect(page.getByRole("status")).toContainText("1 created", { timeout: 60_000 });
    await expect(page.getByText("price set to 12.34")).toBeVisible();

    await page.goto("/audit/prices");
    await expect(page.getByText("Catalog CSV import").first()).toBeVisible({ timeout: 30_000 });
  });

  test("store manager runs a stock count and raises a small adjustment", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await loginAs(page, SEEDED_STORE_MANAGER_EMAIL);

    await page.goto("/counts");
    await page.getByRole("button", { name: "Start count" }).click();
    await page.getByRole("button", { name: "Start count" }).last().click();
    await expect(page).toHaveURL(/\/counts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const firstInput = page.locator("input[aria-label^='Counted quantity']").first();
    await firstInput.fill("3");
    await page.getByRole("button", { name: "Submit count" }).click();
    await expect(page.getByText(/Submitted — \d+ correction/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main h1")).toContainText("submitted");

    await page.goto("/adjustments");
    await page.getByRole("button", { name: "New adjustment" }).click();
    await page.locator("#adjustment-sku").selectOption({ index: 1 });
    await page.fill("#adjustment-qty", "-1");
    await page.locator("#adjustment-reason").selectOption("damaged");
    await page.getByRole("button", { name: "Submit adjustment" }).click();
    await expect(page.getByText("Applied to stock.")).toBeVisible({ timeout: 30_000 });
  });
});
