// Argon2id PIN hashing lives here (T041). Exposed to the WebView via
// tauri::command; the plaintext PIN never crosses the FS boundary.

use tauri::Manager;

pub mod cohort;
pub mod db;
pub mod pin;
pub mod spike;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            pin::hash_pin,
            pin::verify_pin,
            spike::spike_prepare_db_dir,
            spike::spike_locate_db,
            spike::spike_simulate_crash,
            cohort::get_cohort_channel,
            db::get_or_create_db_encryption_key,
        ])
        .plugin(tauri_plugin_powersync::init())
        .setup(|app| {
            // Read once at startup (T126) and keep in managed state — a
            // future update-check command builds its updater with
            // `cohort::channel_endpoint(&cohort_config.channel)` instead of
            // the static tauri.conf.json default whenever this install's
            // channel is "canary".
            let cohort_config = cohort::load_cohort_config(app.handle());
            app.manage(cohort_config);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

