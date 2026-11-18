# Local Seed Credentials

Development-only credentials for the local Supabase seed.

## Admin and Manager Sign-In

All seeded email users use password `local-dev-password`.

| Role | Email | Store |
| --- | --- | --- |
| HQ admin | `hq.admin@hgl.local` | (all) |
| Store manager | `store.manager@hgl.local` | PILOT-001 |
| Store manager | `kitwe.manager@hgl.local` | PILOT-002 |
| Cashier 1 | `cashier.one@hgl.local` | PILOT-001 |
| Cashier 2 | `cashier.two@hgl.local` | PILOT-001 |
| Cashier 3 | `cashier.three@hgl.local` | PILOT-002 |
| Cashier 4 | `cashier.four@hgl.local` | PILOT-002 |

## POS Offline PINs

| Cashier | PIN | Default till | Store |
| --- | --- | --- | --- |
| Pilot Store Manager | `9999` | — | PILOT-001 |
| Cashier One | `1234` | Till 1 | PILOT-001 |
| Cashier Two | `5678` | Till 2 | PILOT-001 |
| Kitwe Store Manager | `8888` | — | PILOT-002 |
| Cashier Three | `1111` | Till 1 | PILOT-002 |
| Cashier Four | `2222` | Till 2 | PILOT-002 |

Seeded PIN hashes are Argon2id PHC strings (m=19456, t=3, p=1, v=19) matching
`apps/pos/src-tauri/src/pin.rs::verify_pin`'s hardcoded params exactly —
use `node scripts/gen-argon2-hash.mjs <pin>` (repo root) to mint any new ones
with the same params. HQ Admin's local `pin_hash` is a non-functional
placeholder: `hq_admin` is intentionally excluded from the till's local
cashier-login roster query, so it's never verified.

## Seed data overview

Beyond master data (2 stores, 4 tills, roster, 50 SKUs/prices/promotions),
`seed.sql` also seeds ~1 week of event history so every admin-app flow has
data on first login:

- An initial on-hand stock count for every store/SKU pair.
- 5 shifts (3 closed, 2 open) across both stores, with 10 sales spanning
  `completed`/`voided`/`refunded` statuses (including one deliberately
  left completed + untouched, for manual cross-till refund testing).
- SKU 012 (PILOT-001) is deliberately understocked (triggers a low-stock
  alert); SKU 013 (PILOT-001) is deliberately oversold (negative on-hand).
- One approved + one still-pending stock adjustment.
- A full inter-store transfer (PILOT-001 → PILOT-002) ending in
  `received_with_variance` (short-picked by 2 units).
- Two price changes (one global, one store-scoped override).
- Sync-health snapshots covering all three alert reasons: one healthy till,
  one stale (`stale_sync`), one with a queue backlog (`queue_backlog`).

