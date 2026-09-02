// Argon2id PIN hashing lives here (T041). Exposed to the WebView via
// tauri::command; the plaintext PIN never crosses the FS boundary.

pub mod pin;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            pin::hash_pin,
            pin::verify_pin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
