# Windows Dev-Machine Setup

Mirrors `specs/001-retail-pos-mvp/quickstart.md` (the authoritative
first-time setup guide) with additional environment gotchas found while
building this project.

## Required tooling

- Node.js 20 LTS, pnpm 9+
- Docker Desktop (local Supabase)
- Supabase CLI (`npm i -g supabase`)
- PowerSync CLI (`npm i -g @powersync/cli`)
- **Rust toolchain** (stable, via `rustup`) + MSVC C++ Build Tools
  (`winget install Microsoft.VisualStudio.2022.BuildTools`, VCTools workload)
- **Tauri CLI** (`cargo install tauri-cli` or `pnpm add -g @tauri-apps/cli`)
- **LLVM/libclang** (`winget install LLVM.LLVM`) — required by `bindgen` for
  the PowerSync Rust crates. Set `LIBCLANG_PATH` to the LLVM `bin` directory
  if `cargo build` can't find `libclang.dll`.
- WebView2 runtime (bundled on Windows 11)
- A Windows 10/11 machine — signed installers cannot be cross-compiled from
  macOS/Linux.

## First-time setup

Follow `specs/001-retail-pos-mvp/quickstart.md` steps 1-4 (clone/install,
local Supabase, local PowerSync, environment) verbatim.

## Environment gotchas found during development

- **PATH not picking up newly-installed CLIs in an already-open terminal**:
  refresh PATH in the current session rather than opening a new terminal:
  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine")
  ```
- **`supabase stop` + `supabase start` does NOT re-run migrations.** Only
  `supabase db reset` applies new/edited files under `supabase/migrations/`.
  If you edit a migration after an earlier `db reset`, run `db reset` again
  — a stop/start only restores the DB from its last backup.
- **`supabase functions serve <name>` can crash on hot-reload** with
  `failed to create docker container: ... Conflict ... container name already
  in use`. Fix: `docker rm -f supabase_edge_runtime_<project>` then re-run
  `serve`.
- **Local dev API keys**: `supabase status` prints NEW-format keys
  (`sb_publishable_...`, `sb_secret_...`) by default. Edge Functions reading
  `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` (service-role-gated internal
  functions) expect the LEGACY JWT-format key instead — get it via
  `supabase status -o env | Select-String SERVICE_ROLE`.
- **`config.toml` auth settings require a full restart to take effect**:
  editing `[auth.email]` (or similar) and restarting the Docker containers
  directly does NOT reload it — use `supabase stop` then `supabase start`.
- **PowerShell 5.1**: `Invoke-RestMethod`'s
  `$_.Exception.Response.GetResponseStream()` in a `catch` block can
  unreliably return empty on repeated calls in this environment — use
  `$_.ErrorDetails.Message` instead to reliably read an HTTP error body.

## IDE

VS Code with the Rust Analyzer and Tauri extensions is the reference setup;
no other IDE-specific configuration is required by this repo.
