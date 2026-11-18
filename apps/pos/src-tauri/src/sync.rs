// Real (non-spike) PowerSync `.connect()` wiring — download/bucket sync only.
// Upload stays on the app's own SyncEngine/local_upload_queue (see repo scope-out
// notes: Option B), so `upload_data()` here is a defensive no-op drain, not the
// real ingest path. `fetch_credentials()` reads the JS-owned `local_device_session`
// table directly off the same SQLite file (DeviceSessionManager writes it) —
// no new IPC round-trip needed for that half, only for the initial connect() kick.

use async_trait::async_trait;
use powersync::error::PowerSyncError;
use powersync::{BackendConnector, PowerSyncCredentials, PowerSyncDatabase, SyncOptions};
use tauri_plugin_powersync::PowerSyncExt;

struct SupabaseConnector {
    database: PowerSyncDatabase,
    endpoint: String,
}

#[async_trait]
impl BackendConnector for SupabaseConnector {
    async fn fetch_credentials(&self) -> Result<PowerSyncCredentials, PowerSyncError> {
        let reader = self.database.reader().await?;
        let (token, _expires_at): (String, String) = reader.query_row(
            "SELECT access_token, expires_at FROM local_device_session ORDER BY minted_at DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        Ok(PowerSyncCredentials {
            endpoint: self.endpoint.clone(),
            token,
        })
    }

    async fn upload_data(&self) -> Result<(), PowerSyncError> {
        // See module doc comment — uploads are not wired through PowerSync yet.
        let Some(transaction) = self.database.next_crud_transaction().await? else {
            return Ok(());
        };
        transaction.complete().await
    }
}

/// Resolves the native `PowerSyncDatabase` from the JS-side `rustHandle` and
/// calls its real `.connect()` in the background, using the local
/// `local_device_session` table (written by `DeviceSessionManager`) for auth.
#[tauri::command]
pub async fn powersync_connect(
    app_handle: tauri::AppHandle,
    handle: usize,
    endpoint: String,
) -> Result<(), String> {
    let database = app_handle
        .powersync()
        .database_from_javascript_handle(handle)
        .map_err(|err| err.to_string())?;

    let options = SyncOptions::new(SupabaseConnector {
        database: database.clone(),
        endpoint,
    });
    tauri::async_runtime::spawn(async move {
        database.connect(options).await;
    });

    Ok(())
}
