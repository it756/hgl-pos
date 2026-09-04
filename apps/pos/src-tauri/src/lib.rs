// Argon2id PIN hashing lives here (T041). Exposed to the WebView via
// tauri::command; the plaintext PIN never crosses the FS boundary.

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
        ])
        .plugin(tauri_plugin_powersync::init())
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
