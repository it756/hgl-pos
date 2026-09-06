# Cashier Training Notes

Three behaviours in this system are intentional design decisions, not bugs —
cashiers and store managers must be trained on them explicitly so a support
call doesn't turn into a false "the till is broken" escalation.

## 1. Same-till voids work offline; cross-till/day refunds do not

- **Same-till-session void** (`apps/pos/src/app/refund/page.tsx` routes this
  to `apps/pos/src/lib/events/void.ts`): voiding a sale made earlier in the
  *same shift, on the same till* works completely offline — no network call,
  no delay (FR-011).
- **Cross-till or cross-day refund**: refunding a sale made on a *different
  till*, or from an *earlier shift/day*, requires the till to be online
  (FR-012). The till will show an explicit "connectivity required" message
  and will refuse to record the refund locally — this is deliberate, not a
  missing feature. Train cashiers to recognise this message and either wait
  for connectivity or escalate to a manager rather than trying to work
  around it with a same-till void (which the till will also refuse once it
  detects the original sale wasn't made in the current till/shift).

## 2. Overselling is an expected business flow, not a bug

Stock is event-sourced and additive (Constitution Principle II) — the system
does **not** block a sale because local stock looks low or zero. Two tills
can independently sell the last unit of the same SKU while both are offline;
once both reconnect, stock correctly converges to a negative number and the
SKU is flagged **"Oversold"** on the manager's inventory dashboard
(`apps/admin/src/app/(app)/inventory/page.tsx`) for follow-up (e.g. physical
recount, supplier reorder, or customer contact if unable to fulfil).

Train store managers to treat "Oversold" as a normal, expected reconciliation
item to action — not an error state, and not something to try to "fix" by
editing stock numbers directly (there is no such feature; a physical count
correction is the only sanctioned path, via `apps/pos/src/app/count/page.tsx`).

## 3. Cashier roster changes take effect at a till only after that till syncs

If HQ or a store manager creates a new cashier, changes a PIN, or
deactivates/off-boards someone, that change is **not** instant at a till
that's currently offline (EC-14). A brand-new hire cannot log in at an
offline till until it reconnects; conversely, an off-boarded cashier remains
able to log in at an offline till until it syncs the deactivation.

This is why the admin sync-health dashboard shows a per-till roster
freshness indicator (FR-042) — if a store reports "the new cashier can't log
in," the first troubleshooting step is checking whether that till has synced
since the account was created, not assuming the account setup is broken.

## Quick reference for store managers

| Symptom | Expected? | Action |
|---|---|---|
| Cross-till refund refused while offline | Yes | Wait for connectivity, or note it for later online processing |
| A SKU shows "Oversold" | Yes | Physical count + reconcile, not an error |
| New cashier can't log in at one till | Possibly | Check that till's last sync time before escalating |
| Sale/void/shift-open ever blocked by "no network" | **No** | This should never happen — escalate as a real bug |
