// Phase 0a spike support commands (T016/T017) ONLY. Not production code —
// remove this module once spike-report.md (T018) is finalized.

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct DbCandidate {
    path: String,
    exists: bool,
    size_bytes: Option<u64>,
}

#[derive(Serialize)]
pub struct LocateDbResult {
    candidates: Vec<DbCandidate>,
}

#[tauri::command]
pub fn spike_prepare_db_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Dedicated subfolder so the spike's `users`/`shifts`/`sale_events` schema never
    // collides with the real app's raw-SQL tables sharing the same app_data_dir + filename.
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("spike");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Checks every plausible directory the PowerSync Tauri plugin might use for
/// its SQLite file. We don't actually know the plugin's internal path
/// resolution (alpha software) — this walks all of Tauri's own path()
/// resolvers plus common subfolders so the spike can report ground truth
/// instead of a single unverified guess.

#[tauri::command]
pub fn spike_locate_db(app_handle: tauri::AppHandle) -> Result<LocateDbResult, String> {
    let path_resolver = app_handle.path();
    let mut base_dirs: Vec<(&str, std::path::PathBuf)> = Vec::new();

    if let Ok(p) = path_resolver.app_data_dir() {
        base_dirs.push(("app_data_dir/spike", p.join("spike")));
        base_dirs.push(("app_data_dir", p));
    }
    if let Ok(p) = path_resolver.app_local_data_dir() {
        base_dirs.push(("app_local_data_dir", p));
    }
    if let Ok(p) = path_resolver.app_config_dir() {
        base_dirs.push(("app_config_dir", p));
    }
    if let Ok(p) = path_resolver.app_cache_dir() {
        base_dirs.push(("app_cache_dir", p));
    }
    if let Ok(p) = std::env::current_exe() {
        if let Some(dir) = p.parent() {
            base_dirs.push(("exe_dir", dir.to_path_buf()));
        }
    }
    if let Ok(p) = std::env::current_dir() {
        base_dirs.push(("current_dir", p));
    }

    let filenames = [
        "powersync.db",
        "powersync.db-wal",
        "powersync.db-shm",
        "powersync.sqlite",
        "powersync.sqlite-wal",
        "powersync.sqlite-shm",
    ];
    let mut candidates = Vec::new();

    for (label, dir) in &base_dirs {
        for filename in &filenames {
            let full = dir.join(filename);
            let exists = full.exists();
            let size_bytes = if exists {
                std::fs::metadata(&full).ok().map(|m| m.len())
            } else {
                None
            };
            candidates.push(DbCandidate {
                path: format!("[{label}] {}", full.to_string_lossy()),
                exists,
                size_bytes,
            });
        }
    }

    Ok(LocateDbResult { candidates })
}

#[tauri::command]
pub fn spike_simulate_crash() {
    // Windows has no SIGKILL; abort() skips destructors/flush the same way a
    // real power-loss would — this is the practical equivalent for T017(d).
    std::process::abort();
}

// ---------------------------------------------------------------------------
// De-risking spike for wiring a real PowerSync `.connect()` + backend
// connector (see repo memory / scope-out discussion). JS's own
// `PowerSyncTauriDatabase.connect()` throws by design ("call connect() in
// your Rust code") and the tauri-plugin-powersync 0.0.6 command surface has
// no `Connect` variant at all — so this reaches the underlying native
// `powersync` crate database directly via `PowerSyncExt::database_from_javascript_handle`
// (public API, no plugin fork needed) and calls its real `.connect()`.
//
// SCOPE: this only proves the raw-table CRUD-trigger -> ps_crud ->
// `BackendConnector::upload_data()` mechanism actually works on this alpha
// SDK. It deliberately does NOT solve the real till-auth-session design
// question (see scope-out notes) — `SpikeConnector::fetch_credentials`
// hand-signs a throwaway JWT with the LOCAL DEV `PS_SUPABASE_JWT_SECRET`
// (from powersync/docker/.env, hardcoded below — never do this for a real
// till credential) and `upload_data` only logs + completes the queue, it
// does not forward writes to Postgres.
use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use powersync::error::PowerSyncError;
use powersync::{BackendConnector, PowerSyncCredentials, PowerSyncDatabase, SyncOptions};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_powersync::PowerSyncExt;

const DEV_ONLY_PS_SUPABASE_JWT_SECRET: &str = "super-secret-jwt-token-with-at-least-32-characters-long";
const DEV_ONLY_PS_ENDPOINT: &str = "http://localhost:8080";
// Real seeded pilot-store/till ids from supabase/seed/seed.sql — reused here only so
// the crafted JWT's claims are meaningful, not because this device actually owns them.
const DEV_ONLY_STORE_ID: &str = "35000000-0000-4000-8000-000000000001";
const DEV_ONLY_TILL_ID: &str = "35000000-0000-4000-8000-000000000011";

fn craft_dev_jwt() -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_secs();
    let header = serde_json::json!({ "alg": "HS256", "typ": "JWT" });
    let payload = serde_json::json!({
        "aud": "authenticated",
        "role": "authenticated",
        "sub": "00000000-0000-4000-8000-000000000099",
        "pos_role": "device",
        "store_id": DEV_ONLY_STORE_ID,
        "till_id": DEV_ONLY_TILL_ID,
        "device_id": "00000000-0000-4000-8000-000000000098",
        "iat": now,
        "exp": now + 3600,
    });

    let encoded_header = URL_SAFE_NO_PAD.encode(header.to_string());
    let encoded_payload = URL_SAFE_NO_PAD.encode(payload.to_string());
    let signing_input = format!("{encoded_header}.{encoded_payload}");

    let mut mac = Hmac::<Sha256>::new_from_slice(DEV_ONLY_PS_SUPABASE_JWT_SECRET.as_bytes())
        .map_err(|err| err.to_string())?;
    mac.update(signing_input.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    Ok(format!("{signing_input}.{signature}"))
}

struct SpikeConnector {
    // The trait method has no db parameter (confirmed by reading upload.rs's
    // CrudUpload::upload_step: `self.connector.upload_data().await?`) — a
    // connector is expected to hold its own database handle to drain ps_crud.
    database: PowerSyncDatabase,
}

#[async_trait]
impl BackendConnector for SpikeConnector {
    async fn fetch_credentials(&self) -> Result<PowerSyncCredentials, PowerSyncError> {
        let token = craft_dev_jwt().map_err(|err| {
            PowerSyncError::upload_error(std::io::Error::other(format!(
                "failed to craft dev JWT: {err}"
            )))
        })?;
        Ok(PowerSyncCredentials {
            endpoint: DEV_ONLY_PS_ENDPOINT.to_string(),
            token,
        })
    }

    async fn upload_data(&self) -> Result<(), PowerSyncError> {
        // Real connector would forward each crud entry to Postgres here before
        // completing. This spike only proves the queue actually drains, so it
        // just logs + completes — that alone confirms raw-table CRUD triggers
        // -> ps_crud -> this connector is wired end to end on this alpha SDK.
        let Some(transaction) = self.database.next_crud_transaction().await? else {
            return Ok(());
        };
        println!(
            "spike_connect: uploading {} crud entr(y/ies), last_item_id={}",
            transaction.crud.len(),
            transaction.last_item_id
        );
        for entry in &transaction.crud {
            println!(
                "spike_connect:   table={} id={} data={:?}",
                entry.table,
                entry.id,
                entry.data
            );
        }
        transaction.complete().await
    }
}

/// Resolves the native `PowerSyncDatabase` from the JS-side `rustHandle`
/// (`PowerSyncTauriDatabase.rustHandle`) and calls its real `.connect()`,
/// spawned in the background — this never returns to JS while syncing.
#[tauri::command]
pub async fn spike_connect(app_handle: tauri::AppHandle, handle: usize) -> Result<(), String> {
    let database = app_handle
        .powersync()
        .database_from_javascript_handle(handle)
        .map_err(|err| err.to_string())?;

    let options = SyncOptions::new(SpikeConnector {
        database: database.clone(),
    });
    tauri::async_runtime::spawn(async move {
        database.connect(options).await;
    });

    Ok(())
}

