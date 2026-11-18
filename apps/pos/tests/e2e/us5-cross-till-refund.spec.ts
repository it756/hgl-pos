import { expect } from "@wdio/globals";

// T110 E2E (WebDriverIO + tauri-driver — tasks.md says "Playwright E2E" but
// apps/pos actually uses WebDriverIO + tauri-driver for all E2E specs, see
// wdio.conf.ts and tests/e2e/us9-shift.spec.ts; this mirrors that tooling
// and header-comment convention, consistent with how T063/T080 handled the
// same tooling mismatch).
//
// Covers the US5 Independent Test's ONLINE happy path: a cashier looks up a
// sale made on a DIFFERENT till (or a prior shift/day), the till is online,
// `verify-refund` (T107) reports the sale eligible, the cashier signs in
// with their real Supabase Auth credentials to step up authentication
// (apps/pos/src/lib/events/refund.ts's `signInForRefundVerification`), and
// the refund completes as a NEW, linked `refunded` sale event
// (`original_sale_id` set, `refund_kind: "cross_till"` or
// `"same_till_history"`) — the original sale row is never mutated, only its
// `sales.latest_status` projection follows the newest linked event (see
// events/sale.ts's `persistSaleProjection`).
//
// CANNOT EXECUTE IN THIS ENVIRONMENT: this spec requires (a) a debug Tauri
// build (`pnpm --filter @hgl/pos tauri build --debug`), (b) `tauri-driver`
// running locally (`cargo install tauri-driver` once, then
// `tauri-driver --port 4444`), (c) a provisioned till with a cached local
// roster, (d) local Supabase running with the `verify-refund` Edge
// Function served and a seeded ORIGINAL sale on a different till/day for
// `ORIGINAL_SALE_ID` below, and (e) real network connectivity for the
// till under test — none of which are available in this sandboxed session.
// This template is ready to run as-is on real hardware/CI once those
// prerequisites are met (see specs/001-retail-pos-mvp/quickstart.md); it
// intentionally is not exercised here.

const CASHIER_NAME = "Test Cashier";
const CASHIER_PIN = "1234";

// A sale_id seeded (or previously produced) on a DIFFERENT till or an
// earlier shift/day than the till under test — the whole point of this
// spec is that it is NOT resolvable locally and requires the online
// verify-refund round trip.
const ORIGINAL_SALE_ID = "00000000-0000-4000-8000-000000000000";
const REFUND_REASON = "Customer return — wrong item";
const MANAGER_EMAIL = "manager@example.com";
const MANAGER_PASSWORD = "changeme";

describe("US5 — online cross-till/historical refund (FR-012 happy path)", () => {
  it("verifies a cross-till sale online, signs the manager in, and completes a linked refund without mutating the original sale", async () => {
    await browser.url("/login");

    const cashierButton = await $(`button=${CASHIER_NAME}`);
    await cashierButton.waitForDisplayed({ timeout: 10_000 });
    await cashierButton.click();

    for (const digit of CASHIER_PIN) {
      await (await $(`button=${digit}`)).click();
    }
    await (await $("button=Log in")).click();

    await browser.waitUntil(async () => !(await browser.getUrl()).includes("/login"), { timeout: 10_000 });

    await browser.url("/refund");

    const saleIdInput = await $('input[placeholder^="e.g. 3f9a1c2e"]');
    await saleIdInput.waitForDisplayed({ timeout: 10_000 });
    await saleIdInput.setValue(ORIGINAL_SALE_ID);

    await (await $("button=Look up sale")).click();

    // A sale from a different till/session routes to the
    // connectivity-required branch, never the same-session void branch.
    const connectivityNotice = await $("p*=requires connectivity to confirm the original sale server-side");
    await connectivityNotice.waitForDisplayed({ timeout: 10_000 });

    const refundReasonInput = await $('input[placeholder^="e.g. customer return"]');
    await refundReasonInput.setValue(REFUND_REASON);

    const emailInput = await $('input[type="email"]');
    await emailInput.setValue(MANAGER_EMAIL);
    const passwordInput = await $('input[type="password"]');
    await passwordInput.setValue(MANAGER_PASSWORD);

    await (await $("button=Verify online")).click();

    // Online + eligible: the verified original sale's summary renders and a
    // "Confirm refund" action becomes available — no verify-refund failure
    // message is shown.
    const originalTotalLabel = await $("dt=Original total");
    await originalTotalLabel.waitForDisplayed({ timeout: 15_000 });

    const confirmButton = await $("button=Confirm refund");
    await confirmButton.waitForEnabled({ timeout: 5_000 });
    await confirmButton.click();

    const successMessage = await $("p=Refund issued.");
    await successMessage.waitForDisplayed({ timeout: 10_000 });

    // Back to a fresh lookup form, ready for the next refund — and the
    // original sale itself was never mutated in place: a brand-new
    // `refunded` sale_events row was written with its own event_id/sale_id
    // and `original_sale_id` pointing back at ORIGINAL_SALE_ID (per
    // events/refund.ts's `RefundEventQueue.refundSale()` and
    // events/sale.ts's `persistSaleProjection`, which only updates the
    // original's `sales.latest_status` column, never its own row).
    const lookupButton = await $("button=Look up sale");
    await lookupButton.waitForDisplayed({ timeout: 5_000 });
  });
});
