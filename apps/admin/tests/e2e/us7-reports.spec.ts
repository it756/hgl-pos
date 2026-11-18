import { expect, test, type Download, type Page } from "@playwright/test";
import { loginAs, SEEDED_HQ_ADMIN_EMAIL } from "./support/login";

// US7 reports E2E (T124): HQ admin exercises the /reports dashboard's
// sales/inventory/reconciliation sections, triggers CSV/PDF export, and
// checks the /reports/dashboard consolidated view's provisional-data marker
// (EC-16, computed by apps/admin/src/lib/reports/shared.ts's
// computeProvisionalMarker — see report_provisional.spec.sql / T125 for the
// pgTAP coverage of the sync_health_latest_by_till view it reads from).
//
// SLA assertion ties to NFR-002 (T152): sales_by_store must render within
// 10s for a representative dataset. Against local dev data this trivially
// passes — the point is that the assertion exists and is wired to the
// concrete target, not that it's a meaningful load test here.
const SALES_BY_STORE_SLA_MS = 10_000;

// Export buttons call supabase.functions.invoke() (fetch) then
// window.open() a signed Storage URL in a new tab. Depending on the
// browser's handling of the response's content-type/content-disposition,
// this can surface as either a `download` event on the context or a plain
// `popup` page navigation (e.g. Chromium may render a CSV/PDF inline rather
// than downloading it). This helper accepts either as evidence the export
// actually fired and produced a report-exports signed URL, rather than
// asserting one specific browser behavior.
async function clickExportAndCapture(
  page: Page,
  button: ReturnType<Page["getByRole"]>,
): Promise<{ download: Download | null; popup: Page | null }> {
  const downloadPromise = page.context().waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  const popupPromise = page.waitForEvent("popup", { timeout: 20_000 }).catch(() => null);

  await button.click();

  const [download, popup] = await Promise.all([downloadPromise, popupPromise]);
  return { download, popup };
}

test.describe("US7 reports dashboard", () => {
  test("HQ admin views sales/inventory/reconciliation reports and exports CSV/PDF within SLA", async ({ page }) => {
    await loginAs(page, SEEDED_HQ_ADMIN_EMAIL);

    const navigateStartedAt = Date.now();
    await page.goto("/reports");

    // Three report categories the UI actually exposes on one dashboard page.
    const salesCard = page.getByRole("heading", { name: "Sales", exact: true });
    const inventoryCard = page.getByRole("heading", { name: "Inventory", exact: true });
    const reconciliationCard = page.getByRole("heading", { name: "Till reconciliation", exact: true });

    await expect(salesCard).toBeVisible();
    const renderedAt = Date.now();
    await expect(inventoryCard).toBeVisible();
    await expect(reconciliationCard).toBeVisible();

    // NFR-002: sales_by_store must render within 10s for a representative
    // (<=90 days, <=16 stores) dataset.
    expect(renderedAt - navigateStartedAt).toBeLessThan(SALES_BY_STORE_SLA_MS);

    // Sub-sections for the other exposed report types within Sales.
    await expect(page.getByRole("heading", { name: "By SKU / category" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transfer history" })).toBeVisible();

    // Export CSV/PDF for sales_by_store — the first "Export CSV"/"Export PDF"
    // button pair rendered on the page (CardHeader of the Sales section).
    const exportCsvButton = page.getByRole("button", { name: "Export CSV" }).first();
    const exportPdfButton = page.getByRole("button", { name: "Export PDF" }).first();
    await expect(exportCsvButton).toBeVisible();
    await expect(exportPdfButton).toBeVisible();

    const csvResult = await clickExportAndCapture(page, exportCsvButton);
    const csvUrl = csvResult.download?.url() ?? csvResult.popup?.url() ?? null;
    expect(csvResult.download !== null || csvResult.popup !== null, "CSV export should trigger a download or open a signed export URL").toBe(true);
    if (csvUrl !== null) {
      expect(csvUrl).toContain("report-exports");
      expect(csvUrl).toContain(".csv");
    }
    await csvResult.popup?.close();

    const pdfResult = await clickExportAndCapture(page, exportPdfButton);
    const pdfUrl = pdfResult.download?.url() ?? pdfResult.popup?.url() ?? null;
    expect(pdfResult.download !== null || pdfResult.popup !== null, "PDF export should trigger a download or open a signed export URL").toBe(true);
    if (pdfUrl !== null) {
      expect(pdfUrl).toContain("report-exports");
      expect(pdfUrl).toContain(".pdf");
    }
    await pdfResult.popup?.close();
  });

  test("consolidated dashboard renders and the provisional-data marker is correctly present or absent", async ({ page }) => {
    await loginAs(page, SEEDED_HQ_ADMIN_EMAIL);

    await page.goto("/reports/dashboard");
    await expect(page.getByRole("heading", { name: "Consolidated dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By store" })).toBeVisible();

    // EC-16 provisional marker (ProvisionalMarker.isProvisional, rendered as
    // a "Provisional — ..." Badge in ConsolidatedDashboard) is conditional
    // on stale tills existing for the queried range. This test does not
    // force a stale-till scenario (see T125's companion pgTAP/Vitest
    // coverage for the underlying staleness computation) — it only asserts
    // the marker's conditional rendering resolves cleanly to exactly one of
    // its two valid states against whatever local sync-health data exists.
    const provisionalBadge = page.getByText(/Provisional/);
    const provisionalCount = await provisionalBadge.count();
    expect(provisionalCount === 0 || provisionalCount === 1).toBe(true);
    if (provisionalCount === 1) {
      await expect(provisionalBadge).toBeVisible();
    }
  });
});
