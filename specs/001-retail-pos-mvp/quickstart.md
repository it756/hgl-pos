# Quickstart — Retail POS 001-retail-pos-mvp

Bring the whole system up locally for the first time.

## Prerequisites

- Node.js 20 LTS
- pnpm 9+
- Docker Desktop (for local Supabase)
- Supabase CLI (`npm i -g supabase`)
- PowerSync CLI (`npm i -g @powersync/cli`)
- **Rust toolchain** (stable, via `rustup`) — requires the MSVC C++ Build Tools (`winget install Microsoft.VisualStudio.2022.BuildTools` with the VCTools workload) for the linker
- **Tauri CLI** (`cargo install tauri-cli` or `pnpm add -g @tauri-apps/cli`)
- **LLVM/libclang** (`winget install LLVM.LLVM`) — required by `bindgen`, used transitively by the PowerSync Rust crates (`powersync_sqlite_nostd`) to generate SQLite bindings at build time. Set `LIBCLANG_PATH` to the LLVM `bin` directory (e.g. `C:\Program Files\LLVM\bin`) if `cargo build` can't find `libclang.dll`.
- **WebView2 runtime** (bundled on Windows 11; installer required on Windows 10 IoT if not present)
- Windows 10/11 dev machine for building Tauri targets — signed Windows installers cannot be cross-compiled from macOS/Linux

## 1. Clone and install

```powershell
git clone <repo-url> hgl-pos
cd hgl-pos
git checkout 001-retail-pos-mvp
pnpm install
```

## 2. Local Supabase

```powershell
supabase start
supabase db reset      # applies migrations under supabase/migrations
supabase db seed       # loads supabase/seed
```

Sanity check:

```powershell
supabase status        # should show local API + DB URLs
psql "$env:SUPABASE_DB_URL" -c "select count(*) from stores;"
```

## 3. Local PowerSync

The `powersync/sync-rules.yaml` in this repo (mirrored from
[contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml))
is the authoritative rules file.

```powershell
powersync service start --config powersync/local.yaml
```

`powersync/local.yaml` points at the local Supabase database URL and loads the
sync-rules file. Sanity check:

```powershell
powersync check-sync-rules powersync/sync-rules.yaml
```

## 4. Environment

Copy `.env.example` to `.env.local` at the workspace root, then run:

```powershell
pnpm run env:sync    # propagates .env.local into apps/pos and apps/admin
```

Required variables:

- `NEXT_PUBLIC_SUPABASE_URL` — from `supabase status`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from `supabase status`
- `NEXT_PUBLIC_POWERSYNC_URL` — `http://localhost:8080` (default)
- `SUPABASE_SERVICE_ROLE_KEY` — only for Edge Function testing, never in the till app

## 5. Run the admin app

```powershell
pnpm --filter @hgl/admin dev
```

Open http://localhost:3000. Sign in with the seeded HQ admin account (see
`supabase/seed/README.md` for credentials).

## 6. Run the POS app in a browser (dev loop)

```powershell
pnpm --filter @hgl/pos dev
```

Open http://localhost:3001. The PowerSync client will connect to the local
PowerSync service. This is the fastest inner loop for UI work; use the
Tauri target when touching native shell code, peripheral integration, or the
PowerSync Tauri SDK path.

Sign in as the seeded cashier for the pilot store. First-run does a full
catalog sync. Watch `/sync-health` in the till UI to see the queue depth
change as you record sales.

## 7. Run the POS app on a Windows terminal (Tauri build)

```powershell
pnpm --filter @hgl/pos build              # Next.js static export -> .next/out
pnpm --filter @hgl/pos tauri:dev          # native shell, hot-reload against the Next.js bundle
pnpm --filter @hgl/pos tauri:build        # signed installer under apps/pos/src-tauri/target/release/bundle
```

For Phase 0a spike work (feature spec 001 §11, [research.md §12](research.md)):
use `tauri:dev` with a network-shaping proxy in front of the PowerSync client
to simulate disconnects, then verify the local SQLite file at
`%APPDATA%\HGL POS\powersync.db` survives an app restart AND an installer
upgrade (not just a restart).

Kiosk mode is configured out-of-band via Intune / Windows Assigned Access —
not in this repo. Developer builds run without kiosk lockdown; production
terminals are enrolled by ops.

## 8. Run the offline drill locally

The offline drill test harness ships in `apps/pos/tests/e2e/offline-drill.spec.ts`:

```powershell
pnpm --filter @hgl/pos test:e2e -- offline-drill
```

This uses Playwright to drive the till in a browser, intercepts and blackholes
PowerSync/Supabase traffic to simulate a WAN outage, generates N sales +
shifts + count corrections, releases the network block, and asserts:

1. Every generated event lands server-side exactly once (per `event_id`
   upsert).
2. `current_stock_by_store_sku` reflects the exact sum of deltas (including
   the intentional oversell case).
3. `shifts.over_short` matches the expected computed value.

Passing this locally is the smoke test for Principle I / II / IV — the same
harness runs in CI and, in a longer-running form, is the Phase 5 3-day drill
(US6, SC-001, SC-011).

## 9. Run the RLS + sync-rule test suites

```powershell
pnpm run test:pgtap      # supabase/tests -- RLS policies, projection triggers, event idempotency
pnpm run test:sync-rules # powersync/tests -- role/store isolation
```

The isolation tests (research.md §3.4) are the concrete guard against a
sync-rule bug leaking cross-store data. They must pass before every merge to
`main`.

## 10. Handy runbooks

- Provision a new till: `pnpm run ops:provision-till -- --store <code> --label "Till 4"` — calls the `provision-till` Edge Function; requires an HQ or store-manager JWT in `OPS_JWT`.
- Force a sync-health alert (for testing the webhook): `pnpm run ops:simulate-stale-till -- --till <uuid>`.
- Rotate a device credential: `pnpm run ops:rotate-device-credential -- --till <uuid>`.

## Troubleshooting

**"Sync rules failed to compile"** — likely a JWT claim rename. Every sync
rule references JWT claims by name; a rename in
`public.access_token_hook` must be paired with an update in
[contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml).

**"Event rejected: duplicate key"** — this is the point of `event_id` dedup;
it means retry succeeded and the ingested-once property held.

**Till UI shows the sync badge red but device dashboard is green** — the
till's local view differs from server's absence-of-heartbeat view; usually
means WAN is up but the PowerSync sync-rule change hasn't propagated. Restart
the PowerSync service or bump its sync-rules version.
